/**
 * F13-T01 (ADR-034 §2) — migration 9026 no banco: a coluna
 * `crm_companies.custom_fields` existe, nasce `{}`, só aceita objeto, é
 * preservada quando a definição some (a definição mora em `tenant_settings`,
 * o banco não a conhece — de propósito) e a RLS da 9005 a cobre: membro de A
 * não lê nem escreve o valor de B. `fn_crm_report` existe, recusa `anon` e
 * devolve as seis chaves para uma organização vazia (zeros com denominador).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

if (!process.env.TEST_DB_CONTAINER) throw new Error("Rode via pnpm test:db");
const pool = new Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT}/postgres` });

const orgA = randomUUID();
const orgB = randomUUID();
const userA = randomUUID();
const userB = randomUUID();
let empresaB = "";

beforeAll(async () => {
  await pool.query("insert into auth.users(id,email) values($1,$2),($3,$4)", [userA, `f13-a-${userA}@invariant.test`, userB, `f13-b-${userB}@invariant.test`]);
  await pool.query("insert into organizations(id,slug,legal_name,display_name) values($1,$2,'F13 A','F13 A'),($3,$4,'F13 B','F13 B')", [orgA, `f13-a-${orgA.slice(0, 8)}`, orgB, `f13-b-${orgB.slice(0, 8)}`]);
  await pool.query("insert into user_organizations(organization_id,user_id,role,accepted_at) values($1,$2,'admin',now()),($3,$4,'admin',now())", [orgA, userA, orgB, userB]);
  const r = await pool.query<{ id: string }>("insert into crm_companies(organization_id,legal_name,custom_fields) values($1,'Empresa B','{\"segmento\":\"varejo\"}') returning id", [orgB]);
  empresaB = r.rows[0].id;
});
afterAll(() => pool.end());

async function como(user: string, papel: "authenticated" | "anon", comando: string, params: unknown[] = []) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${papel}`);
    if (papel === "authenticated") await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user, aal: "aal1", role: "authenticated" })]);
    const r = await client.query(comando, params);
    await client.query("rollback");
    return { ok: true as const, rows: r.rows, rowCount: r.rowCount ?? 0 };
  } catch (error) {
    await client.query("rollback");
    return { ok: false as const, erro: String((error as Error).message) };
  } finally {
    client.release();
  }
}

describe("F13-T01 — crm_companies.custom_fields (9026)", () => {
  it("a coluna existe, nasce {} e só aceita objeto (CHECK)", async () => {
    const col = await pool.query("select data_type, column_default, is_nullable from information_schema.columns where table_schema='public' and table_name='crm_companies' and column_name='custom_fields'");
    expect(col.rows).toHaveLength(1);
    expect(col.rows[0]).toMatchObject({ data_type: "jsonb", is_nullable: "NO" });
    const nova = await pool.query<{ custom_fields: unknown }>("insert into crm_companies(organization_id,legal_name) values($1,'Sem campos') returning custom_fields", [orgA]);
    expect(nova.rows[0].custom_fields).toEqual({});
    await expect(pool.query("insert into crm_companies(organization_id,legal_name,custom_fields) values($1,'Lista','[1,2]')", [orgA])).rejects.toThrow(/crm_companies_custom_fields_object/);
  });

  it("valor gravado sobrevive sem definição: o banco não conhece a definição, só o objeto", async () => {
    const r = await pool.query<{ custom_fields: Record<string, unknown> }>("select custom_fields from crm_companies where id=$1", [empresaB]);
    expect(r.rows[0].custom_fields).toEqual({ segmento: "varejo" });
    const setting = await pool.query("select count(*)::int as n from tenant_settings where organization_id=$1 and key='crm.fields.companies'", [orgB]);
    expect(setting.rows[0].n).toBe(0);
  });

  it("RLS (9005) cobre a coluna: A não lê nem escreve o valor de B (2/2 negadas), B lê o próprio (1/1)", async () => {
    const leituraA = await como(userA, "authenticated", "select custom_fields from crm_companies where id=$1", [empresaB]);
    expect(leituraA.ok && leituraA.rowCount).toBe(0);
    const escritaA = await como(userA, "authenticated", "update crm_companies set custom_fields='{\"segmento\":\"atacado\"}' where id=$1", [empresaB]);
    expect(escritaA.ok && escritaA.rowCount).toBe(0);
    const leituraB = await como(userB, "authenticated", "select custom_fields from crm_companies where id=$1", [empresaB]);
    expect(leituraB.ok && leituraB.rowCount).toBe(1);
    const anon = await como(userA, "anon", "select custom_fields from crm_companies where id=$1", [empresaB]);
    expect(anon.ok ? anon.rowCount : 0).toBe(0);
  });
});

describe("F13-T05 — fn_crm_report (9026)", () => {
  it("existe, é stable/security invoker, anon não executa, authenticated e service_role executam", async () => {
    const fn = await pool.query<{ provolatile: string; prosecdef: boolean }>("select provolatile, prosecdef from pg_proc where proname='fn_crm_report' and pronamespace='public'::regnamespace");
    expect(fn.rows).toHaveLength(1);
    expect(fn.rows[0]).toEqual({ provolatile: "s", prosecdef: false });
    const grants = await pool.query<{ grantee: string }>("select grantee from information_schema.routine_privileges where specific_schema='public' and routine_name='fn_crm_report' and privilege_type='EXECUTE'");
    const quem = grants.rows.map((r) => r.grantee).sort();
    expect(quem).not.toContain("anon");
    expect(quem).not.toContain("PUBLIC");
    expect(quem).toEqual(expect.arrayContaining(["authenticated", "service_role"]));
    const comoAnon = await como(userA, "anon", "select fn_crm_report($1, now() - interval '1 day', now())", [orgA]);
    expect(comoAnon.ok).toBe(false);
  });

  it("organização com o funil do seed e nada mais: 8 etapas com 0 abertas, closed zerado, fila 0, tarefas 0, pedidos []", async () => {
    const r = await como(userA, "authenticated", "select fn_crm_report($1, now() - interval '30 days', now()) as rel", [orgA]);
    expect(r.ok, r.ok ? "" : r.erro).toBe(true);
    if (!r.ok) return;
    const rel = r.rows[0].rel as Record<string, unknown>;
    expect(Object.keys(rel).sort()).toEqual(["by_owner", "closed", "from", "funnel", "orders", "queue_size", "tasks", "to"]);
    const funil = rel.funnel as Array<{ open: number; value_cents: number }>;
    expect(funil).toHaveLength(8);
    expect(funil.every((e) => e.open === 0 && e.value_cents === 0)).toBe(true);
    expect(rel.closed).toEqual({ won: 0, won_value_cents: 0, lost: 0, lost_value_cents: 0 });
    expect(rel.by_owner).toEqual([]);
    expect(rel.queue_size).toBe(0);
    expect(rel.tasks).toEqual({ open: 0, overdue: 0, done: 0 });
    expect(rel.orders).toEqual([]);
  });
});
