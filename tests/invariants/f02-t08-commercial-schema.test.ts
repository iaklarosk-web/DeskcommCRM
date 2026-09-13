import { describe, expect, it } from "vitest";

import { lastLine, sql } from "@/tests/invariants/gov-helpers";
import { motivoDoErro } from "@/tests/invariants/psql-transporte";

const ARCHIVE = "private.tenant_setting_alias_archive";
const ARCHIVE_FN =
  "private.fn_archive_tenant_setting_alias(uuid,uuid,text,text)";
const DIAGNOSTIC_FN = "public.fn_commercial_alias_resolutions(uuid)";

function erroSob(role: string, statement: string): string | null {
  try {
    sql(`set role ${role};\n${statement};\nreset role;`);
    return null;
  } catch (error) {
    return motivoDoErro(error);
  }
}

describe("9010: histórico privado e aliases canônicos", () => {
  it("instala uma tabela privada tenant-bound com constraints e índice exatos", () => {
    expect(lastLine(sql(`select to_regclass('${ARCHIVE}') is not null;`))).toBe(
      "t",
    );
    expect(
      lastLine(
        sql(`select c.relrowsecurity::text||'|'||count(p.policyname)::text
          from pg_class c join pg_namespace n on n.oid=c.relnamespace
          left join pg_policies p on p.schemaname=n.nspname and p.tablename=c.relname
         where n.nspname='private' and c.relname='tenant_setting_alias_archive'
         group by c.relrowsecurity;`),
      ),
    ).toBe("true|0");
    expect(
      lastLine(
        sql(`select count(*) from pg_constraint
          where conrelid='${ARCHIVE}'::regclass
            and contype in('p','f','c');`),
      ),
    ).toBe("4");
    expect(
      lastLine(
        sql(`select confdeltype from pg_constraint
          where conrelid='${ARCHIVE}'::regclass and contype='f';`),
      ),
    ).toBe("c");
    expect(
      lastLine(
        sql(`select indexdef like '%(organization_id, alias_key, resolved_at DESC, id DESC)%'
          from pg_indexes where schemaname='private'
            and indexname='tenant_setting_alias_archive_latest_idx';`),
      ),
    ).toBe("t");
  });

  it("nenhum papel cliente nem service_role lê/escreve/apaga o arquivo", () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const privilege of ["select", "insert", "update", "delete"]) {
        expect(
          lastLine(
            sql(
              `select has_table_privilege('${role}','${ARCHIVE}','${privilege}');`,
            ),
          ),
          `arquivo privado exposto: ${role} pode ${privilege}`,
        ).toBe("f");
      }
      expect(
        erroSob(role, `select count(*) from ${ARCHIVE}`),
        `${role} não pode observar nem contagem do arquivo`,
      ).toMatch(/permission denied|permissão negada/i);
    }
  });

  it("helper bruto é privado; diagnóstico service-only não retorna value/chave", () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(
        lastLine(
          sql(
            `select has_function_privilege('${role}','${ARCHIVE_FN}','execute');`,
          ),
        ),
      ).toBe("f");
    }
    expect(
      lastLine(
        sql(
          `select has_function_privilege('service_role','${DIAGNOSTIC_FN}','execute');`,
        ),
      ),
    ).toBe("t");
    for (const role of ["anon", "authenticated"]) {
      expect(
        lastLine(
          sql(
            `select has_function_privilege('${role}','${DIAGNOSTIC_FN}','execute');`,
          ),
        ),
      ).toBe("f");
    }
    expect(
      lastLine(
        sql(`select string_agg(parameter_name,',' order by ordinal_position)
          from information_schema.parameters
         where specific_schema='public'
           and specific_name like 'fn_commercial_alias_resolutions_%'
           and parameter_mode='OUT';`),
      ),
    ).toBe("alias_key,source,legacy_updated_at,destination,resolved_at");
  });

  it("arquivo só é escrito pelas três funções canônicas e todas têm ACL fechada", () => {
    for (const signature of [
      "public.fn_definir_logo_da_organizacao(uuid,uuid,text)",
      "public.fn_definir_marca_da_organizacao(uuid,uuid,jsonb)",
      "public.fn_update_organization_profile(uuid,uuid,jsonb)",
    ]) {
      const definition = sql(
        `select pg_get_functiondef('${signature}'::regprocedure);`,
      );
      expect(definition).toContain("fn_archive_tenant_setting_alias");
      for (const role of ["anon", "authenticated"]) {
        expect(
          lastLine(
            sql(
              `select has_function_privilege('${role}','${signature}','execute');`,
            ),
          ),
        ).toBe("f");
      }
      expect(
        lastLine(
          sql(
            `select has_function_privilege('service_role','${signature}','execute');`,
          ),
        ),
      ).toBe("t");
    }
  });

  it("funções definer pertencem a postgres e têm search_path fixo", () => {
    for (const signature of [
      ARCHIVE_FN,
      DIAGNOSTIC_FN,
      "public.fn_update_organization_profile(uuid,uuid,jsonb)",
    ]) {
      expect(
        lastLine(
          sql(`select r.rolname||'|'||p.prosecdef::text||'|'||
                  array_to_string(p.proconfig,',')
             from pg_proc p join pg_roles r on r.oid=p.proowner
            where p.oid='${signature}'::regprocedure;`),
        ),
      ).toMatch(/^postgres\|true\|search_path=/);
    }
  });
});
