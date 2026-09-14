/**
 * F15-T00 — idempotência das execuções de regra de automação NO BANCO
 * (migration 9027, ADR-036 §2 T00).
 *
 * O motor herdado só deduplicava em memória. Aqui o índice único parcial é
 * medido, não presumido: a segunda run FINAL de um par (regra, evento) é
 * recusada pelo Postgres; uma linha `adiado` (espera pela janela, 0175)
 * convive com a run final do mesmo evento; e `event_id` nulo fica fora do
 * índice (duas runs manuais aceitas).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

if (!process.env.TEST_DB_CONTAINER) throw new Error("Rode via pnpm test:db");
const pool = new Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT}/postgres` });

const org = randomUUID();
let ruleId = "";
let eventId = "";

beforeAll(async () => {
  await pool.query("insert into organizations(id,slug,legal_name,display_name) values($1,$2,'Runs 9027','Runs 9027')", [org, org]);
  const rule = await pool.query(
    "insert into automation_rules(organization_id,name,trigger_event,is_active) values($1,'f15-t00','lead.stage_changed',true) returning id",
    [org],
  );
  ruleId = rule.rows[0].id;
  const event = await pool.query(
    "insert into event_log(organization_id,event_type,entity_kind,entity_id,payload) values($1,'lead.stage_changed','crm_lead',$2,'{}'::jsonb) returning id",
    [org, randomUUID()],
  );
  eventId = event.rows[0].id;
});
afterAll(() => pool.end());

async function run(status: string, event: string | null): Promise<{ ok: boolean; code: string | null }> {
  try {
    await pool.query(
      "insert into automation_rule_runs(organization_id,rule_id,event_id,status,actions_result) values($1,$2,$3,$4,'[]'::jsonb)",
      [org, ruleId, event, status],
    );
    return { ok: true, code: null };
  } catch (error) {
    return { ok: false, code: (error as { code?: string }).code ?? null };
  }
}

describe("F15-T00 — uma execução por (regra, evento) no banco", () => {
  it("o índice existe com o predicado da 9027", async () => {
    const idx = await pool.query(
      "select indexdef from pg_indexes where schemaname='public' and tablename='automation_rule_runs' and indexname='uniq_automation_rule_runs_rule_event'",
    );
    expect(idx.rows).toHaveLength(1);
    expect(idx.rows[0].indexdef).toMatch(/UNIQUE INDEX/);
    expect(idx.rows[0].indexdef).toMatch(/event_id IS NOT NULL/);
    expect(idx.rows[0].indexdef).toMatch(/status <> 'adiado'/);
  });

  it("a segunda run final do mesmo par é recusada (23505); adiado convive; event_id nulo aceito duas vezes", async () => {
    // Arrange — uma espera pela janela antes da execução (0175)
    const adiado = await run("adiado", eventId);
    // Act
    const primeira = await run("success", eventId);
    const segunda = await run("failed", eventId);
    const manual1 = await run("success", null);
    const manual2 = await run("success", null);
    const linhas = await pool.query(
      "select status from automation_rule_runs where rule_id=$1 and event_id=$2 order by created_at",
      [ruleId, eventId],
    );
    // Assert — medido
    expect(adiado.ok).toBe(true);
    expect(primeira.ok).toBe(true);
    expect(segunda.ok).toBe(false);
    expect(segunda.code).toBe("23505");
    expect(manual1.ok && manual2.ok).toBe(true);
    expect(linhas.rows.map((r) => r.status)).toEqual(["adiado", "success"]);
    console.info(
      `f15-t00-idempotencia-das-runs: second_final_run_rejected=${segunda.ok ? 0 : 1}/1 rows_for_pair=${linhas.rows.length}/2 null_event_runs=2/2`,
    );
  });
});
