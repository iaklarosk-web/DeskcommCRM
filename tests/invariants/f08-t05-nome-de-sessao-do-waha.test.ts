/**
 * F08-T05 — o nome da sessão do WAHA cabe no limite do WAHA (migration 9025).
 *
 * O WAHA 2026.7.2 recusa nomes com mais de 54 caracteres; a reserva herdada
 * gerava 69. Aqui a reserva REAL (`fn_reserve_channel_connection`, mesmo
 * harness de pre-go-live-reservation) tem de devolver um nome ≤ 54 no formato
 * `org_<32 hex>_<16 hex>`, e a tabela não pode carregar nome longo nenhum —
 * o rename da migration é medido, não presumido.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

if (!process.env.TEST_DB_CONTAINER) throw new Error("Rode via pnpm test:db");
const pool = new Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT}/postgres` });
const actor = randomUUID();
beforeAll(async () => {
  await pool.query("insert into auth.users(id,email) values($1,$2)", [actor, `waha-nome-${actor}@invariant.test`]);
});
afterAll(() => pool.end());

async function reserve(org: string, key: string) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: actor, aal: "aal1" })]);
    const result = await client.query("select fn_reserve_channel_connection($1,$2,$3,null,true) result", [org, key, "a".repeat(64)]);
    await client.query("commit");
    return result.rows[0].result;
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

describe("F08-T05 — o nome da sessão do WAHA cabe no limite (≤ 54)", () => {
  it("a reserva devolve org_<32 hex>_<16 hex> (53 chars) e nenhuma linha da tabela passa de 54", async () => {
    // Arrange
    const org = randomUUID();
    await pool.query("insert into organizations(id,slug,legal_name,display_name) values($1,$2,'Nome WAHA','Nome WAHA')", [org, org]);
    await pool.query("insert into user_organizations(organization_id,user_id,role,accepted_at) values($1,$2,'admin',now())", [org, actor]);

    // Act
    const reserva = await reserve(org, randomUUID());
    const nome: string = reserva.channel.waha_session_name;
    const longas = await pool.query("select count(*)::int as n from channel_sessions where length(waha_session_name) > 54");

    // Assert — medido: formato, tamanho, e o limite do WAHA vale para a tabela inteira.
    expect(nome).toMatch(/^org_[0-9a-f]{32}_[0-9a-f]{16}$/);
    expect(nome.length).toBe(53);
    expect(nome.length).toBeLessThanOrEqual(54);
    expect(longas.rows[0].n).toBe(0);
    console.info(`f08-t05-nome-waha: length=${nome.length}/54 long_rows=${longas.rows[0].n}/0`);
  });
});
