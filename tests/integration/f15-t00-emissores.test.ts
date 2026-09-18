/**
 * F15-T00 — os três emissores de evento da F15 (ADR-036 §2 T00).
 *
 * Só `lead.stage_changed`/`lead.created` existiam no `event_log`; as regras
 * 4×4 aprovadas pelo proprietário precisam de `conversation.resolved`,
 * `order.confirmed` e `task.overdue`. Aqui cada emissor é MEDIDO no banco:
 *  - resolver a conversa pela tabela D16 grava UMA linha (e `resolved →
 *    inbound.message → ai_handling` não grava outra);
 *  - confirmar o pedido pelo serviço de ADR-012 grava UMA linha, e o replay
 *    do mesmo comando (recibo idempotente) não grava a segunda;
 *  - a varredura de vencidas emite UMA linha por (tarefa, prazo): rodada duas
 *    vezes, continua uma; prazo novo vencido de novo = linha nova; tenant sem
 *    regra ouvindo não é elegível.
 */
import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { transition } from "@/src/conversation";
import { executeOrderCommand } from "@/src/crm/orders/service";
import {
  listarTenantsComRegraDeTarefaVencida,
  rodarVarreduraDeTarefasVencidas,
  varrerTarefasVencidas,
} from "@/src/crm/tarefas/vencidas";
import type { TenantCtx } from "@/src/tenant-context";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");

const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`, max: 4 });

const ORG_A = "f1500000-0000-4000-8000-00000000000a";
const ORG_B = "f1500000-0000-4000-8000-00000000000b";
const ATT_A = "f1500000-1001-4000-8000-00000000000a";
const ATT_B = "f1500000-1001-4000-8000-00000000000b";
const CONTACT_A = "f1500000-2000-4000-8000-00000000000a";
const SESSAO_A = "f1500000-3000-4000-8000-00000000000a";
const CONVERSA_A = "f1500000-4000-4000-8000-00000000000a";
const PRODUCT_A = "f1500000-5000-4000-8000-00000000000a";

const ctxA: TenantCtx = { organization_id: ORG_A, source: "session", user_id: ATT_A };

const T0 = new Date("2026-09-14T12:00:00.000Z");

async function eventos(org: string, tipo: string, entidade?: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `select count(*)::text as n from public.event_log
      where organization_id = $1 and event_type = $2 and ($3::uuid is null or entity_id = $3::uuid)`,
    [org, tipo, entidade ?? null],
  );
  return Number(rows[0]!.n);
}

beforeAll(async () => {
  await pool.query(`
    insert into auth.users (id, email) values
      ('${ATT_A}','f15-t00-att-a@integration.test'), ('${ATT_B}','f15-t00-att-b@integration.test');
    insert into public.organizations (id, slug, legal_name, display_name, onboarded_at) values
      ('${ORG_A}','f15-t00-a','F15 T00 A','F15 A', now()), ('${ORG_B}','f15-t00-b','F15 T00 B','F15 B', now());
    insert into public.user_organizations (organization_id, user_id, role, accepted_at) values
      ('${ORG_A}','${ATT_A}','agent',now()), ('${ORG_B}','${ATT_B}','agent',now());
    insert into public.contacts (id, organization_id, display_name, phone_number) values
      ('${CONTACT_A}','${ORG_A}','Contato A','+5511900001500');
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${SESSAO_A}','${ORG_A}','sessao-f15-t00','\\x00'::bytea);
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, channel, status, is_group, saas_state, assigned_to_user_id)
      values ('${CONVERSA_A}','${ORG_A}','${CONTACT_A}','${SESSAO_A}','whatsapp','claimed',false,'human_handling','${ATT_A}');
    insert into public.catalog_products (id, organization_id, codigo, nome, preco_cents, sale_unit) values
      ('${PRODUCT_A}','${ORG_A}','F15-A','Produto A',1000,'un');
  `);
});

afterAll(async () => {
  await pool.end();
});

describe("F15-T00 — conversation.resolved", () => {
  it("resolver pela tabela D16 grava UMA linha com ids (1/1); reabrir e resolver de novo grava a segunda", async () => {
    // Arrange
    const antes = await eventos(ORG_A, "conversation.resolved", CONVERSA_A);

    // Act
    const r = await transition(ctxA, CONVERSA_A, "human.resolved", { kind: "attendant", userId: ATT_A }, { pool });
    const depois = await eventos(ORG_A, "conversation.resolved", CONVERSA_A);
    const { rows } = await pool.query<{ payload: Record<string, unknown>; entity_kind: string }>(
      `select payload, entity_kind from public.event_log where organization_id=$1 and event_type='conversation.resolved' and entity_id=$2`,
      [ORG_A, CONVERSA_A],
    );
    await transition(ctxA, CONVERSA_A, "human.reopened", { kind: "attendant", userId: ATT_A }, { pool });
    await transition(ctxA, CONVERSA_A, "human.resolved", { kind: "attendant", userId: ATT_A }, { pool });
    const segunda = await eventos(ORG_A, "conversation.resolved", CONVERSA_A);

    // Assert
    expect(r).toEqual({ from: "human_handling", to: "resolved" });
    expect(depois - antes).toBe(1);
    expect(rows[0]!.entity_kind).toBe("conversation");
    expect(rows[0]!.payload).toMatchObject({ organization_id: ORG_A, conversation_id: CONVERSA_A, contact_id: CONTACT_A, from: "human_handling", actor_kind: "attendant" });
    expect(segunda - antes).toBe(2);
    console.info(`f15-t00-emissores: conversation_resolved=${depois - antes}/1 after_reopen=${segunda - antes}/2`);
  });
});

describe("F15-T00 — order.confirmed", () => {
  it("confirmar pelo serviço grava UMA linha (1/1); o replay do comando não grava outra; o rascunho não emite", async () => {
    // Arrange
    const executor = { type: "human" as const, user_id: ATT_A };
    const draft = await executeOrderCommand(ctxA, executor, {
      command: "create_draft",
      idempotency_key: randomUUID(),
      contact_id: CONTACT_A,
      company_id: null,
      company_name: null,
      channel: "whatsapp",
      delivery_date: "2026-09-20",
      currency: "BRL",
      items: [{ id: randomUUID(), position: 1, requested_text: "uma unidade", product_id: PRODUCT_A, product_name: "Produto A", sale_unit: "un", quantity: "1.000", unit_price_cents: 1000, currency: "BRL" }],
    }, { pool });
    const aposRascunho = await eventos(ORG_A, "order.confirmed", draft.order.id);
    const chave = randomUUID();

    // Act
    const confirmado = await executeOrderCommand(ctxA, executor, { command: "confirm_order", idempotency_key: chave, order_id: draft.order.id, expected_revision: draft.order.revision }, { pool });
    const replay = await executeOrderCommand(ctxA, executor, { command: "confirm_order", idempotency_key: chave, order_id: draft.order.id, expected_revision: draft.order.revision }, { pool });
    const linhas = await pool.query<{ payload: Record<string, unknown>; entity_kind: string }>(
      `select payload, entity_kind from public.event_log where organization_id=$1 and event_type='order.confirmed' and entity_id=$2`,
      [ORG_A, draft.order.id],
    );

    // Assert
    expect(aposRascunho).toBe(0);
    expect(confirmado.order.status).toBe("confirmed");
    expect(replay.replayed).toBe(true);
    expect(linhas.rows).toHaveLength(1);
    expect(linhas.rows[0]!.entity_kind).toBe("crm_order");
    expect(linhas.rows[0]!.payload).toMatchObject({ organization_id: ORG_A, order_id: draft.order.id, contact_id: CONTACT_A, total_cents: 1000 });
    console.info(`f15-t00-emissores: order_confirmed=${linhas.rows.length}/1 replay_emitted=${linhas.rows.length - 1}/0`);
  });
});

describe("F15-T00 — task.overdue (varredura por tenant)", () => {
  it("elegível só quem tem regra ativa ouvindo; duas varreduras = UMA linha por (tarefa, prazo); prazo novo vencido = linha nova; tarefa concluída não emite", async () => {
    // Arrange — A tem regra ativa, B tem regra inativa
    await pool.query(
      `insert into public.automation_rules (organization_id, name, trigger_event, is_active) values
         ($1,'f15-t00 vencidas','task.overdue',true), ($2,'f15-t00 desligada','task.overdue',false)`,
      [ORG_A, ORG_B],
    );
    const vencida = randomUUID();
    const concluida = randomUUID();
    const futura = randomUUID();
    const vencidaB = randomUUID();
    await pool.query(
      `insert into public.crm_tasks (id, organization_id, title, due_date, status, assigned_to) values
         ($1,$5,'vencida',$6,'pending',$7),
         ($2,$5,'concluída',$6,'done',$7),
         ($3,$5,'futura',$8,'pending',$7),
         ($4,$9,'vencida de B',$6,'pending',null)`,
      [vencida, concluida, futura, vencidaB, ORG_A, new Date(T0.getTime() - 3_600_000), ATT_A, new Date(T0.getTime() + 3_600_000), ORG_B],
    );

    // Act
    const elegiveis = await listarTenantsComRegraDeTarefaVencida({ pool });
    const primeira = await rodarVarreduraDeTarefasVencidas({ pool, agora: () => T0 });
    const segunda = await rodarVarreduraDeTarefasVencidas({ pool, agora: () => T0 });
    const linhasA = await eventos(ORG_A, "task.overdue");
    const linhasB = await eventos(ORG_B, "task.overdue");
    // prazo novo, vencido de novo
    await pool.query(`update public.crm_tasks set due_date=$2 where id=$1`, [vencida, new Date(T0.getTime() - 60_000)]);
    const terceira = await varrerTarefasVencidas({ organization_id: ORG_A, source: "cron" }, { pool, agora: () => T0 });
    const linhasDaTarefa = await eventos(ORG_A, "task.overdue", vencida);
    const payload = await pool.query<{ payload: Record<string, unknown> }>(
      `select payload from public.event_log where organization_id=$1 and event_type='task.overdue' and entity_id=$2 order by created_at limit 1`,
      [ORG_A, vencida],
    );

    // Assert
    expect(elegiveis).toEqual([ORG_A]);
    expect(primeira).toMatchObject({ tenants_eligible: 1, tenants_failed: 0, overdue_found: 1, emitted: 1, already_emitted: 0 });
    expect(segunda).toMatchObject({ tenants_eligible: 1, overdue_found: 1, emitted: 0, already_emitted: 1 });
    expect(linhasA).toBe(1);
    expect(linhasB).toBe(0);
    expect(terceira).toMatchObject({ overdue_found: 1, emitted: 1, already_emitted: 0 });
    expect(linhasDaTarefa).toBe(2);
    expect(payload.rows[0]!.payload).toMatchObject({ organization_id: ORG_A, task_id: vencida, assigned_to: ATT_A, priority: "medium" });
    expect(typeof payload.rows[0]!.payload.due_epoch).toBe("string");
    console.info(
      `f15-t00-emissores: task_overdue_eligible=${elegiveis.length}/1 emitted_run1=${primeira.emitted}/1 emitted_run2=${segunda.emitted}/0 ` +
        `rows_after_two_runs=${linhasA}/1 rows_other_tenant=${linhasB}/0 new_due_date_rows=${linhasDaTarefa}/2`,
    );
  });
});
