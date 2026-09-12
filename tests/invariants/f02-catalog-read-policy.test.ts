import { describe, expect, it } from "vitest";
import { sql } from "@/tests/invariants/psql-transporte";

const A = "f0290011-0000-4000-8000-000000000001";
const B = "f0290011-0000-4000-8000-000000000002";
const VIEWER = "f0290011-1000-4000-8000-000000000001";
const AGENT = "f0290011-1000-4000-8000-000000000002";
const MANAGER = "f0290011-1000-4000-8000-000000000003";
const SUPPORT = "f0290011-1000-4000-8000-000000000004";
const SESSION = "f0290011-2000-4000-8000-000000000001";
const fixture = `
  insert into auth.users(id,email) values
    ('${VIEWER}','catalog-viewer@invariant.test'),
    ('${AGENT}','catalog-agent@invariant.test'),
    ('${MANAGER}','catalog-manager@invariant.test'),
    ('${SUPPORT}','catalog-support@invariant.test');
  insert into organizations(id,slug,display_name,legal_name) values
    ('${A}','catalog-9011-a','Catálogo sintético A','Catálogo sintético A'),
    ('${B}','catalog-9011-b','Catálogo sintético B','Catálogo sintético B');
  insert into user_organizations(organization_id,user_id,role,accepted_at) values
    ('${A}','${VIEWER}','viewer',now()),
    ('${A}','${AGENT}','agent',now()),
    ('${A}','${MANAGER}','manager',now());
  insert into catalog_products(organization_id,codigo,nome,preco_cents,sale_unit) values
    ('${A}','PROBE-A','Produto A',100,'un'),('${B}','PROBE-B','Produto B',200,'un');
`;
function transaction(body: string): string {
  return sql(`begin;\n${fixture}\n${body}\nrollback;`);
}
function asUser(id: string, body: string): string {
  return `set local role authenticated;
    select set_config('request.jwt.claims','{"sub":"${id}","session_id":"${SESSION}","aal":"aal1"}',true);
    ${body}`;
}
function deniedInsert(org: string): string {
  return `do $$ begin
    begin
      insert into catalog_products(organization_id,codigo,nome,preco_cents) values
        ('${org}','FORBIDDEN','Não deve ser gravado',1);
      raise exception 'catalog insert escaped';
    exception when insufficient_privilege then null; end;
  end $$;`;
}
function changed(command: string): string {
  return `with changed as (${command} returning 1) select count(*) from changed;`;
}
function support(mode: "full" | "support_readonly"): string {
  return `insert into auth.sessions(id,user_id,aal) values('${SESSION}','${SUPPORT}','aal1');
    insert into platform_admins(user_id,granted_by,scope,mfa_required,reason)
      values('${SUPPORT}','${SUPPORT}','full',false,'Fixture local catálogo');
    insert into platform_support_sessions(organization_id,actor_user_id,auth_session_id,access_mode,expires_at)
      values('${A}','${SUPPORT}','${SESSION}','${mode}',now()+interval '30 minutes');`;
}

describe("F02 — leitura e ACL do catálogo sem política de escrita por linha", () => {
  it("SELECT do catálogo não executa verificação de papel de escrita por linha", () => {
    // Sem ANALYZE/limite temporal: prova o plano executável e não um tempo de CI.
    const plan = transaction(
      asUser(
        MANAGER,
        `explain (format json)
      select id from catalog_products where organization_id='${A}' order by ativo desc,nome,id limit 500;`,
      ),
    );
    expect(
      plan,
      "SELECT do catálogo voltou a avaliar fn_role_at_least por linha",
    ).not.toContain("fn_role_at_least");
    const posture = transaction(`select count(*) filter(where cmd='ALL'),
      count(*) filter(where cmd='SELECT' and permissive='PERMISSIVE'),
      count(*) filter(where cmd in ('INSERT','UPDATE','DELETE') and permissive='PERMISSIVE'),
      count(*) filter(where cmd in ('INSERT','UPDATE','DELETE') and permissive='RESTRICTIVE')
      from pg_policies where schemaname='public' and tablename='catalog_products';`);
    expect(
      posture,
      "SELECT do catálogo recebeu novamente uma policy FOR ALL",
    ).toContain("0|1|3|3");
  });

  it("mantém ACL de anon fechada e DML de authenticated/service_role", () => {
    const result = transaction(`select
      (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='catalog_products' and grantee='anon'),
      (select count(*) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p where has_table_privilege('authenticated','public.catalog_products',p)),
      (select count(*) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p where has_table_privilege('service_role','public.catalog_products',p));`);
    expect(result).toContain("0|4|4");
  });

  for (const [role, user] of [
    ["viewer", VIEWER],
    ["agent", AGENT],
    ["manager", MANAGER],
  ] as const) {
    it(`${role} lê A e não lê B`, () => {
      expect(
        transaction(
          asUser(
            user,
            `select
        (select count(*) from catalog_products where organization_id='${A}'),
        (select count(*) from catalog_products where organization_id='${B}');`,
          ),
        ),
      ).toContain("1|0");
    });
  }
  for (const [role, user] of [
    ["viewer", VIEWER],
    ["agent", AGENT],
  ] as const) {
    it(`${role} não insere, altera ou remove produtos de A/B`, () => {
      const result = transaction(
        asUser(
          user,
          `${deniedInsert(A)} ${deniedInsert(B)}
        ${changed("update catalog_products set preco_cents=1")}
        ${changed("delete from catalog_products")}
        reset role;
        select count(*) filter(where preco_cents=1),count(*) from catalog_products
          where organization_id in ('${A}','${B}');`,
        ),
      );
      expect(result).toContain("0|2");
    });
  }
  it("manager escreve A e não insere, altera ou remove B", () => {
    const result = transaction(
      asUser(
        MANAGER,
        `
      insert into catalog_products(organization_id,codigo,nome,preco_cents) values('${A}','NEW-A','Novo A',300);
      ${changed(`update catalog_products set preco_cents=400 where organization_id='${A}' and codigo='PROBE-A'`)}
      ${changed(`delete from catalog_products where organization_id='${A}' and codigo='NEW-A'`)}
      ${deniedInsert(B)}
      ${changed(`update catalog_products set preco_cents=1 where organization_id='${B}'`)}
      ${changed(`delete from catalog_products where organization_id='${B}'`)}
      reset role;
      select (select preco_cents from catalog_products where organization_id='${A}' and codigo='PROBE-A'),
        (select preco_cents from catalog_products where organization_id='${B}' and codigo='PROBE-B'),
        (select count(*) from catalog_products where organization_id='${A}' and codigo='NEW-A');`,
      ),
    );
    expect(result).toContain("400|200|0");
  });
  it("suporte readonly conserva leitura e bloqueia os três comandos no tenant acompanhado", () => {
    const result = transaction(`${support("support_readonly")}
      ${asUser(
        SUPPORT,
        `select fn_support_context()->>'status',fn_support_context()->>'access_mode';
        ${deniedInsert(A)}
        ${changed(`update catalog_products set preco_cents=1 where organization_id='${A}'`)}
        ${changed(`delete from catalog_products where organization_id='${A}'`)}
        select preco_cents from catalog_products where organization_id='${A}' and codigo='PROBE-A';`,
      )}
    `);
    expect(result).toContain("active|support_readonly");
    expect(result.split("\n").filter((line) => /^\d+$/.test(line))).toEqual([
      "0",
      "0",
      "100",
    ]);
  });
  it("suporte full conserva DML no tenant acompanhado", () => {
    const result = transaction(`${support("full")}
      ${asUser(
        SUPPORT,
        `select fn_support_context()->>'status',fn_support_context()->>'access_mode';
        insert into catalog_products(organization_id,codigo,nome,preco_cents) values('${A}','SUPPORT-A','Novo suporte',300);
        ${changed(`update catalog_products set preco_cents=400 where organization_id='${A}' and codigo='PROBE-A'`)}
        ${changed(`delete from catalog_products where organization_id='${A}' and codigo='SUPPORT-A'`)}
        select preco_cents from catalog_products where organization_id='${A}' and codigo='PROBE-A';`,
      )}
    `);
    expect(result).toContain("active|full");
    expect(result.split("\n").filter((line) => /^\d+$/.test(line))).toEqual([
      "1",
      "1",
      "400",
    ]);
  });
  it("contagem exata inclui o produto além dos primeiros500", () => {
    const result =
      transaction(`insert into catalog_products(organization_id,codigo,nome,preco_cents)
      select '${A}','FILL-'||g,'Produto '||g,100 from generate_series(1,500) g;
      ${asUser(
        VIEWER,
        `select (select count(*) from catalog_products where organization_id='${A}'),
        (select count(*) from (select id from catalog_products where organization_id='${A}' order by ativo desc,nome,id limit 500) page);`,
      )}
    `);
    expect(result).toContain("501|500");
  });
});
