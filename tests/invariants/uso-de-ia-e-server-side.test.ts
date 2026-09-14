/**
 * F01-T08 — ai_usage_events (migration 0222) é server-side only, provado por
 * PRIVILÉGIO, não por policy: RLS ligada, ZERO policies, e `permission denied`
 * MEDIDO sob `set role` para anon e authenticated. Mesmo desenho (e mesma
 * razão de não entrar em TABLES do rls-isolation) das tabelas do eixo de
 * anúncios — ver o comentário longo em
 * credencial-de-anuncios-e-server-side.test.ts: com privilégio NENHUM o
 * countAs devolveria `permission denied` em vez de `0`, e a "correção" natural
 * seria criar policy — isto é, servir pelo PostgREST o livro-razão de custo de
 * IA de todos os tenants.
 */
import { describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "./psql-transporte";

const TABELA = "ai_usage_events";

function erroSob(papel: string, comando: string): string | null {
  try {
    sql(`set role ${papel};\n${comando};\nreset role;`);
    return null;
  } catch (err) {
    return motivoDoErro(err);
  }
}

function esperaBarrado(papel: string, comando: string): void {
  const erro = erroSob(papel, comando);
  expect(erro, `\`${papel}\` executou "${comando}" SEM erro — a tabela está exposta`).not.toBeNull();
  expect(erro).toContain("permission denied");
}

describe(`${TABELA} — uso de IA é server-side (deny-all por grant)`, () => {
  it("RLS está ligada e não há NENHUMA policy", () => {
    expect(
      sql(`select rowsecurity from pg_tables where schemaname='public' and tablename='${TABELA}';`).trim(),
    ).toBe("t");
    expect(
      sql(`select count(*) from pg_policies where schemaname='public' and tablename='${TABELA}';`).trim(),
    ).toBe("0");
  });

  it.each(["anon", "authenticated"])("privilégio de `%s` na tabela é NENHUM", (papel) => {
    const privilegios = sql(`
      select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), 'NENHUM')
        from information_schema.role_table_grants
       where table_schema = 'public' and table_name = '${TABELA}' and grantee = '${papel}';
    `).trim();
    expect(privilegios).toBe("NENHUM");
  });

  it.each(["anon", "authenticated"])("`%s` leva permission denied em select/insert/update/delete", (papel) => {
    esperaBarrado(papel, `select count(*) from public.${TABELA}`);
    esperaBarrado(papel, `insert into public.${TABELA} (organization_id, model, operation) values (gen_random_uuid(), 'x', 'chat')`);
    esperaBarrado(papel, `update public.${TABELA} set model = 'y'`);
    esperaBarrado(papel, `delete from public.${TABELA}`);
  });

  it("service_role alcança (é quem o recordUsage usa)", () => {
    const erro = erroSob("service_role", `select count(*) from public.${TABELA}`);
    expect(erro).toBeNull();
  });
});
