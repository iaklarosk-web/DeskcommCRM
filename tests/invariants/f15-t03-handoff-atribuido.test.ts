/**
 * F15-T03 — o handoff pode nascer atribuído (migration 9029, ADR-036 §2 T03).
 *
 * Medido no banco: as colunas existem, a coerência (as duas nulas ou as duas
 * preenchidas) é do CHECK, o índice do "último atribuído" existe, e apagar
 * a pessoa NÃO apaga nem quebra o histórico (sem FK, como `claimed_by`).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

if (!process.env.TEST_DB_CONTAINER) throw new Error("Rode via pnpm test:db");
const pool = new Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT}/postgres` });

const org = randomUUID();
const usuario = randomUUID();
const contato = randomUUID();
const sessao = randomUUID();
const conversa = randomUUID();

const RESUMO = `'customer_request','Cliente','duvida','resumo do episodio','[null,null,null,null,null]'::jsonb,null,'assumir','ai'`;

beforeAll(async () => {
  await pool.query("insert into auth.users(id,email) values($1,$2)", [usuario, `f15-t03-${usuario}@invariant.test`]);
  await pool.query("insert into organizations(id,slug,legal_name,display_name) values($1,$2,'Handoff 9029','Handoff 9029')", [org, org]);
  await pool.query("insert into channel_sessions(id,organization_id,waha_session_name,webhook_secret_encrypted) values($1,$2,$3,'\\x00'::bytea)", [sessao, org, `s-${sessao.slice(0, 8)}`]);
  await pool.query("insert into contacts(id,organization_id,display_name) values($1,$2,'Contato')", [contato, org]);
  await pool.query(
    "insert into conversations(id,organization_id,contact_id,channel_session_id,channel,status,is_group,saas_state) values($1,$2,$3,$4,'whatsapp','pending',false,'waiting_human')",
    [conversa, org, contato, sessao],
  );
});
afterAll(() => pool.end());

async function tenta(sql: string, params: unknown[]): Promise<string | null> {
  try {
    await pool.query(sql, params);
    return null;
  } catch (error) {
    return (error as { constraint?: string; code?: string }).constraint ?? (error as { code?: string }).code ?? "erro";
  }
}

describe("F15-T03 — handoffs.assigned_to/assigned_at (9029)", () => {
  it("colunas, CHECK de coerência e índice existem", async () => {
    const colunas = await pool.query(
      "select column_name from information_schema.columns where table_schema='public' and table_name='handoffs' and column_name in ('assigned_to','assigned_at') order by 1",
    );
    const idx = await pool.query("select 1 from pg_indexes where schemaname='public' and tablename='handoffs' and indexname='handoffs_org_atribuido_idx'");
    expect(colunas.rows.map((r) => r.column_name)).toEqual(["assigned_at", "assigned_to"]);
    expect(idx.rows).toHaveLength(1);
  });

  it("atribuição pela metade é recusada pelo CHECK; atribuído inteiro é aceito; apagar a pessoa mantém o histórico", async () => {
    // Act
    const metade = await tenta(
      `insert into handoffs(organization_id,conversation_id,reason,customer,intent,summary,last_messages,pending_action,suggested_next_step,created_by,assigned_to)
       values($1,$2,${RESUMO},$3)`,
      [org, conversa, usuario],
    );
    const inteiro = await tenta(
      `insert into handoffs(organization_id,conversation_id,reason,customer,intent,summary,last_messages,pending_action,suggested_next_step,created_by,assigned_to,assigned_at)
       values($1,$2,${RESUMO},$3,now())`,
      [org, conversa, usuario],
    );
    // Assert
    expect(metade).toBe("handoffs_atribuicao_coerente");
    expect(inteiro).toBeNull();
    // Sem FK (como `claimed_by`): apagar a pessoa passa e o histórico fica
    // inteiro — quem recebeu o quê não some com o cadastro.
    const apagar = await tenta("delete from auth.users where id=$1", [usuario]);
    const linha = await pool.query<{ assigned_to: string | null; assigned_at: Date | null }>(
      "select assigned_to, assigned_at from handoffs where organization_id=$1 and conversation_id=$2",
      [org, conversa],
    );
    expect(apagar).toBeNull();
    expect(linha.rows).toHaveLength(1);
    expect(linha.rows[0]?.assigned_to).toBe(usuario);
    expect(linha.rows[0]?.assigned_at).not.toBeNull();
    console.info(`f15-t03-handoff-atribuido: half_rejected=1/1 full_accepted=1/1 delete_user_ok=1/1 history_kept=1/1`);
  });
});
