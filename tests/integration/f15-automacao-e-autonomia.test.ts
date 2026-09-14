/**
 * F15 — automação e autonomia de IA (ADR-036): a suíte da fase, com banco.
 *
 * Cresce task a task; a linha `autonomy:` do VERIFY SUMMARY (ADR-037 §2) só é
 * gravada no fim, quando TODOS os campos existem — linha pela metade reprova
 * o gate e engana quem lê (regra 7 da RETOMADA).
 *
 * T01 — política por ação (D54 b): os quatro modos exercitados por executor
 * `ai` em ações de ESCRITA, com o efeito conferido no banco; `create_task`
 * pela IA nasce com `actor_type=ai` (§B5/§C6 fechado); `roles_denied` pelas
 * permissões que as rotas novas exigem.
 */
import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFakeRegistry } from "@/lib/agent-engine/edge/llm/providers";
import { comoTextoDoProvedor, responderTurno } from "@/src/ai";
import { estadoDoLimite } from "@/src/ai/limite";
import { execute } from "@/src/actions/execute";
import { processarEventoDeRegra } from "@/src/automation/motor";
import { validarAcoesDeRegra } from "@/src/automation/regras";
import { executeOrderCommand } from "@/src/crm/orders/service";
import { varrerTarefasVencidas } from "@/src/crm/tarefas/vencidas";
import { transition } from "@/src/conversation";
import { embutirDeterministico, reindexarDocumento } from "@/src/knowledge";
import { claim, filaDeHandoffs } from "@/src/handoff/registro";
import { criarAdapterMock } from "@/src/channels/mock";
import { can, type Permissao, type PapelD15 } from "@/src/rbac/matrix";
import { setSetting } from "@/src/tenant-config/settings";
import type { TenantCtx } from "@/src/tenant-context";
import { ROLE_RANK } from "@/lib/auth/types";

import { CFG_LLM, semearTenant, type ConfigDeTenant } from "./f04-turno-fixtures";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");

const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`, max: 4 });
const SEGREDO_FICTICIO = "segredo-ficticio-da-autonomia-f15-0001";
const adapterMock = criarAdapterMock({ segredoDeAssinatura: () => SEGREDO_FICTICIO, pool });
const deps = () => ({ pool, adapters: { mock: adapterMock }, modo: "mock" as const });

const ORG_A = "f1500001-0000-4000-8000-00000000000a";
const ORG_B = "f1500001-0000-4000-8000-00000000000b";
const ADMIN_A = "f1500001-1001-4000-8000-00000000000a";
const ATT_A1 = "f1500001-1003-4000-8000-00000000000a";
const ATT_A2 = "f1500001-1004-4000-8000-00000000000a";
const ATT_A3 = "f1500001-1005-4000-8000-00000000000a";
const ATT_B = "f1500001-1003-4000-8000-00000000000b";
const SESSAO_A = "f1500001-3000-4000-8000-00000000000a";
const SESSAO_B = "f1500001-3000-4000-8000-00000000000b";
const PRODUCT_A = "f1500001-5000-4000-8000-00000000000a";
const contatoDe = (org: string, n: number) => org.replace(/^f1500001-0000/, `f1500001-2${n}00`);
const conversaDe = (org: string, n: number) => org.replace(/^f1500001-0000/, `f1500001-4${n}00`);
const PEDIDO_A = "f1500001-6000-4000-8000-00000000000a";
const ITEM_A = "f1500001-7000-4000-8000-00000000000a";

const ctxA: TenantCtx = { organization_id: ORG_A, source: "session", user_id: ADMIN_A };
const ctxIaA: TenantCtx = { organization_id: ORG_A, source: "job" };
const IA = { kind: "ai" } as const;

const medidas = {
  policy_modes: 0,
  ai_task_created: 0,
  roles_denied: 0,
  roles_denied_total: 0,
  limit_hits: 0,
  calls_after_limit: 0,
  calls_after_limit_total: 0,
  paused: 0,
  resumed: 0,
  handoffs: 0,
  balanced: 0,
  assignees_distinct: 0,
  rules: 0,
  runs: 0,
  replays: 0,
  duplicate_runs: 0,
  outside_catalog_denied: 0,
  reindexed: 0,
  reindexed_total: 0,
  unchanged_skipped: 0,
  unchanged_total: 0,
  sources_cited: 0,
  sources_total: 0,
};

// ─── T02: um tenant próprio para o turno de IA (fixture da F04) ─────────────
const ORG_L = "f1500002-0000-4000-8000-00000000000a";
const ADMIN_L = "f1500002-1001-4000-8000-00000000000a";
const ctxL: TenantCtx = { organization_id: ORG_L, source: "job" };
const conversaL = (n: number) => `f1500002-4${String(n).padStart(3, "0")}-4000-8000-00000000000a`;
const contatoL = (n: number) => `f1500002-2${String(n).padStart(3, "0")}-4000-8000-00000000000a`;
const TENANT_L: ConfigDeTenant = {
  org: ORG_L,
  slug: "f15-limite",
  usuario: "f1500002-1000-4000-8000-00000000000a",
  sessao: "f1500002-3000-4000-8000-00000000000a",
  conta: "f15-limite-conta",
  contatos: [1, 2, 3, 4, 5, 6].map((n) => ({ id: contatoL(n), nome: `Cliente L${n}`, telefone: `+551193400000${n}` })),
  conversas: [1, 2, 3, 4, 5, 6].map((n) => ({ id: conversaL(n), contato: contatoL(n), estado: "ai_handling", statusLegado: "ai_handling" })),
  produtos: [{ id: "f1500002-5100-4000-8000-00000000000a", codigo: "CAFE-01", nome: "Café torrado premium", preco_cents: 2500 }],
  materiais: [{ fonte: "f1500002-6100-4000-8000-00000000000a", versao: "f1500002-7100-4000-8000-00000000000a", nome: "Entregas e prazos", trechos: ["o prazo de entrega para Campinas e de dois dias uteis"] }],
  settings: { "ai.enabled": true, "ai.unknown_answer": "Ainda não tenho essa informação aqui.", "ai.confidence_threshold": 0.6 },
};

function registroQueResponde() {
  const estado = { chamadas: 0 };
  const registry = createFakeRegistry(async () => {
    estado.chamadas += 1;
    return {
      content: [{ type: "text" as const, text: comoTextoDoProvedor({ reply: "Claro, posso ajudar.", intent: "saudacao", confidence: 0.95, tool_calls: [], handoff: { wanted: false, reason: null } }) }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
      warnings: [],
    };
  });
  return { registry, estado };
}
const depsDoTurno = (registry: ReturnType<typeof createFakeRegistry>) => ({ pool, cfg: CFG_LLM, registry, adapters: { mock: adapterMock }, modo: "mock" });
const turnosGravados = () => conta(`select count(*)::text as n from public.ai_usage_events where organization_id=$1 and operation='chat'`, [ORG_L]);

async function conta(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}
const tarefasDe = (org: string) => conta(`select count(*)::text as n from public.crm_tasks where organization_id=$1`, [org]);
const mensagensDe = (conversa: string) => conta(`select count(*)::text as n from public.messages where conversation_id=$1`, [conversa]);
const estadoDa = async (conversa: string) => (await pool.query<{ s: string }>(`select saas_state as s from public.conversations where id=$1`, [conversa])).rows[0]?.s;

beforeAll(async () => {
  await pool.query(`
    insert into auth.users (id, email) values
      ('${ADMIN_A}','f15-admin-a@integration.test'), ('${ATT_A1}','f15-att-a1@integration.test'), ('${ATT_A2}','f15-att-a2@integration.test'),
      ('${ATT_A3}','f15-att-a3@integration.test'), ('${ATT_B}','f15-att-b@integration.test');
    insert into public.organizations (id, slug, legal_name, display_name, status, onboarded_at) values
      ('${ORG_A}','f15-auto-a','F15 A','F15 A','active', now()), ('${ORG_B}','f15-auto-b','F15 B','F15 B','active', now());
    insert into public.user_organizations (organization_id, user_id, role, accepted_at) values
      ('${ORG_A}','${ADMIN_A}','admin',now()), ('${ORG_A}','${ATT_A1}','agent',now()), ('${ORG_A}','${ATT_A2}','agent',now()),
      ('${ORG_A}','${ATT_A3}','agent',now()), ('${ORG_B}','${ATT_B}','agent',now());
    insert into public.tenant_settings (organization_id, key, value, schema_version, source) values
      ('${ORG_A}','ai.enabled','true'::jsonb,1,'tenant_admin'), ('${ORG_B}','ai.enabled','true'::jsonb,1,'tenant_admin');
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted) values
      ('${SESSAO_A}','${ORG_A}','sessao-f15-a','\\x00'::bytea), ('${SESSAO_B}','${ORG_B}','sessao-f15-b','\\x00'::bytea);
    insert into public.channel_accounts (organization_id, provider, account_key, status, phone_e164, channel_session_id) values
      ('${ORG_A}','mock','f15-a','active','+5511900001501','${SESSAO_A}'), ('${ORG_B}','mock','f15-b','active','+5511900001502','${SESSAO_B}');
    insert into public.catalog_products (id, organization_id, codigo, nome, preco_cents, moeda, sale_unit, ativo) values
      ('${PRODUCT_A}','${ORG_A}','F15-A','Produto A',1000,'BRL','un',true);
  `);
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    await pool.query(
      `insert into public.contacts (id, organization_id, display_name, phone_number) values ($1,$2,$3,$4)`,
      [contatoDe(ORG_A, n), ORG_A, `Contato A ${n}`, `+55119015000${n}`],
    );
    await pool.query(
      `insert into public.conversations (id, organization_id, contact_id, channel_session_id, channel, status, is_group, saas_state)
       values ($1,$2,$3,$4,'whatsapp','ai_handling',false,'ai_handling')`,
      [conversaDe(ORG_A, n), ORG_A, contatoDe(ORG_A, n), SESSAO_A],
    );
  }
  await pool.query(
    `insert into public.crm_orders (id, organization_id, contact_id, source, channel, currency, total_cents, created_by_actor_type, created_by_actor_id)
     values ($1,$2,$3,'ui','whatsapp','BRL',1000,'user',$4)`,
    [PEDIDO_A, ORG_A, contatoDe(ORG_A, 1), ADMIN_A],
  );
  await pool.query(
    `insert into public.crm_order_items (id, organization_id, order_id, position, requested_text, product_id, product_name_snapshot, sale_unit_snapshot, quantity, unit_price_cents, currency_snapshot, line_total_cents)
     values ($1,$2,$3,1,'1 un',$4,'Produto A','un',1.000,1000,'BRL',1000)`,
    [ITEM_A, ORG_A, PEDIDO_A, PRODUCT_A],
  );
});

beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await semearTenant(client, TENANT_L);
    await client.query(`insert into auth.users (id, email) values ($1, 'f15-admin-l@integration.test')`, [ADMIN_L]);
    await client.query(`insert into public.user_organizations (organization_id, user_id, role, accepted_at) values ($1,$2,'admin',now())`, [ORG_L, ADMIN_L]);
    await client.query("commit");
  } catch (erro) {
    await client.query("rollback");
    throw erro;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await pool.end();
});

describe("F15-T01 — política por ação: os quatro modos, por executor ai, com efeito no banco", () => {
  it("allow: create_task pela IA nasce com actor_type=ai nos recibos/eventos (ai_task_created=1/1)", async () => {
    // Arrange
    await setSetting(ctxA, "actions.policy", { create_task: "allow" }, "tenant_admin", { pool });
    const antes = await tarefasDe(ORG_A);
    const chave = randomUUID();
    // Act
    const r = await execute(ctxIaA, IA, "create_task", { order_id: PEDIDO_A, title: "Ligar para confirmar", idempotency_key: chave }, deps());
    const replay = await execute(ctxIaA, IA, "create_task", { order_id: PEDIDO_A, title: "Ligar para confirmar", idempotency_key: chave }, deps());
    // Assert
    expect(r.status, `${r.reason ?? ""} ${r.detalhe ?? ""}`).toBe("executed");
    expect(replay.status).toBe("executed");
    expect(replay.output?.["replayed"]).toBe(true);
    expect((await tarefasDe(ORG_A)) - antes).toBe(1);
    const taskId = String(r.output?.["task_id"]);
    const eventos = await pool.query<{ actor_type: string; actor_id: string | null }>(
      `select actor_type, actor_id from public.crm_task_events where organization_id=$1 and task_id=$2`,
      [ORG_A, taskId],
    );
    // `actor_id` é o id do turno (o `requestId` da execução) — rastreável, não uma pessoa.
    expect(eventos.rows).toHaveLength(1);
    expect(eventos.rows[0]).toMatchObject({ actor_type: "ai" });
    expect(eventos.rows[0]?.actor_id).toMatch(/^[0-9a-f-]{36}$/);
    const recibo = await pool.query<{ actor_type: string }>(`select actor_type from public.crm_task_command_receipts where id=$1`, [chave]);
    expect(recibo.rows[0]?.actor_type).toBe("ai");
    const criadaPor = await pool.query<{ created_by: string | null }>(`select created_by from public.crm_tasks where id=$1`, [taskId]);
    expect(criadaPor.rows[0]?.created_by).toBeNull();
    const auditada = await conta(
      `select count(*)::text as n from public.audit_events where organization_id=$1 and action_name='create_task' and actor_type='ai' and result='executed'`,
      [ORG_A],
    );
    expect(auditada).toBe(2);
    medidas.policy_modes += 1;
    medidas.ai_task_created = 1;
    console.info(`f15-t01-allow: executed=1/1 replayed=1/1 task_events_ai=${eventos.rows.length}/1 created_by_null=1/1 audit_ai_executed=${auditada}/2`);
  });

  it("approve: create_order pela IA fica pendente para o attendant, sem gravar o pedido", async () => {
    // Arrange
    await setSetting(ctxA, "actions.policy", { create_order: "approve" }, "tenant_admin", { pool });
    const pedidosAntes = await conta(`select count(*)::text as n from public.crm_orders where organization_id=$1`, [ORG_A]);
    // Act
    const r = await execute(ctxIaA, IA, "create_order", {
      conversation_id: conversaDe(ORG_A, 2),
      customer_id: contatoDe(ORG_A, 2),
      idempotency_key: "f15-t01-approve-create-order",
      items: [{ requested_text: "2 un", product_id: PRODUCT_A, quantity: "2" }],
    }, deps());
    // Assert
    expect(r.status, `${r.reason ?? ""} ${r.detalhe ?? ""}`).toBe("pending");
    expect(r.pending_action_id).toBeTruthy();
    const pendencia = await pool.query<{ status: string; action_name: string }>(`select status, action_name from public.pending_actions where id=$1`, [r.pending_action_id]);
    expect(pendencia.rows[0]).toEqual({ status: "pending", action_name: "create_order" });
    expect(await conta(`select count(*)::text as n from public.crm_orders where organization_id=$1`, [ORG_A])).toBe(pedidosAntes);
    expect(await estadoDa(conversaDe(ORG_A, 2))).toBe("waiting_confirmation");
    medidas.policy_modes += 1;
    console.info(`f15-t01-approve: pending=1/1 orders_written=0/0 state=waiting_confirmation`);
  });

  it("block: create_task pela IA é negada (policy_blocked), auditada, e nenhuma tarefa nasce", async () => {
    // Arrange
    await setSetting(ctxA, "actions.policy", { create_task: "block" }, "tenant_admin", { pool });
    const antes = await tarefasDe(ORG_A);
    // Act
    const r = await execute(ctxIaA, IA, "create_task", { order_id: PEDIDO_A, title: "Não deve nascer", idempotency_key: randomUUID() }, deps());
    // Assert
    expect(r.status).toBe("denied");
    expect(r.reason).toBe("policy_blocked");
    expect(await tarefasDe(ORG_A)).toBe(antes);
    const auditada = await conta(
      `select count(*)::text as n from public.audit_events where organization_id=$1 and action_name='create_task' and actor_type='ai' and result='denied' and payload->>'reason'='policy_blocked'`,
      [ORG_A],
    );
    expect(auditada).toBe(1);
    medidas.policy_modes += 1;
    console.info(`f15-t01-block: denied=1/1 reason=policy_blocked tasks_written=0/0 audit_rows=${auditada}/1`);
  });

  it("transfer: send_message pela IA não envia; a conversa vai a waiting_human com handoff tenant_rule (policy_transferred)", async () => {
    // Arrange
    await setSetting(ctxA, "actions.policy", { send_message: "transfer" }, "tenant_admin", { pool });
    const conversa = conversaDe(ORG_A, 3);
    const mensagensAntes = await mensagensDe(conversa);
    // Act
    const r = await execute(ctxIaA, IA, "send_message", { conversation_id: conversa, body: "Isto não deve sair." }, deps());
    // Assert
    expect(r.status).toBe("denied");
    expect(r.reason).toBe("policy_transferred");
    expect(r.detalhe).toBe("transferred");
    expect(await mensagensDe(conversa)).toBe(mensagensAntes);
    expect(await estadoDa(conversa)).toBe("waiting_human");
    const handoff = await pool.query<{ reason: string }>(`select reason from public.handoffs where organization_id=$1 and conversation_id=$2`, [ORG_A, conversa]);
    expect(handoff.rows.map((h) => h.reason)).toEqual(["tenant_rule"]);
    const auditada = await conta(
      `select count(*)::text as n from public.audit_events where organization_id=$1 and action_name='send_message' and actor_type='ai' and result='denied' and payload->>'reason'='policy_transferred'`,
      [ORG_A],
    );
    expect(auditada).toBe(1);
    // A política é da organização: B, sem entrada, continua no D33 (send_message allow).
    const b = await execute({ organization_id: ORG_B, source: "job" }, IA, "send_message", { conversation_id: randomUUID(), body: "x" }, deps());
    expect(b.reason).toBe("conversation_not_found");
    medidas.policy_modes += 1;
    console.info(`f15-t01-transfer: denied=1/1 messages_written=0/0 state=waiting_human handoff_reason=tenant_rule audit_rows=${auditada}/1 other_tenant_untouched=1/1`);
  });

  it("policy_modes=4/4 e a política sem entrada volta ao D33 (create_task allow de novo)", async () => {
    await setSetting(ctxA, "actions.policy", {}, "tenant_admin", { pool });
    const r = await execute(ctxIaA, IA, "create_task", { order_id: PEDIDO_A, title: "Depois de limpar a política", idempotency_key: randomUUID() }, deps());
    expect(r.status).toBe("executed");
    expect(medidas.policy_modes).toBe(4);
    console.info(`f15-t01-modes: policy_modes=${medidas.policy_modes}/4`);
  });
});

describe("F15-T02 — limite diário de turnos: pausa automática, aviso único, retomada", () => {
  it("com daily_turns=2, dois turnos respondem; o terceiro bate o limite (limit_hits=1/1) e vira handoff tenant_rule sem chamar o provedor", async () => {
    // Arrange
    await setSetting({ organization_id: ORG_L, source: "session", user_id: ADMIN_L }, "ai.limits.daily_turns", 2, "tenant_admin", { pool });
    const { registry, estado } = registroQueResponde();
    // Act
    const t1 = await responderTurno(ctxL, { conversation_id: conversaL(1), mensagem_do_cliente: "oi, tem café?" }, depsDoTurno(registry));
    const t2 = await responderTurno(ctxL, { conversation_id: conversaL(2), mensagem_do_cliente: "qual o prazo?" }, depsDoTurno(registry));
    const gravadosAntes = await turnosGravados();
    const t3 = await responderTurno(ctxL, { conversation_id: conversaL(3), mensagem_do_cliente: "e o preço?" }, depsDoTurno(registry));
    const limite = await estadoDoLimite(ctxL, { pool });
    // Assert
    expect(t1.status).toBe("respondido");
    expect(t2.status).toBe("respondido");
    expect(gravadosAntes).toBe(2);
    expect(t3.status).toBe("handoff");
    expect(t3.motivo).toBe("tenant_rule");
    expect(t3.chamadas_ao_modelo).toBe(0);
    expect(estado.chamadas, "o provedor foi chamado depois do limite").toBe(2);
    expect(limite).toMatchObject({ limit: 2, used: 2, remaining: 0, allowed: false });
    expect(await estadoDa(conversaL(3))).toBe("waiting_human");
    medidas.limit_hits = 1;
    console.info(`f15-t02-limite: turns_before=2/2 limit_hits=1/1 provider_calls=${estado.chamadas}/2 state=waiting_human`);
  });

  it("depois do limite: três turnos, zero chamadas ao provedor, saldo de ai_usage_events inalterado (calls_after_limit=0/3); um aviso só ao tenant_admin (paused=1/1)", async () => {
    // Arrange
    const { registry, estado } = registroQueResponde();
    const gravadosAntes = await turnosGravados();
    // Act — três conversas distintas: a que bateu já está com gente.
    const desfechos = [];
    for (const n of [4, 5, 6]) {
      desfechos.push(await responderTurno(ctxL, { conversation_id: conversaL(n), mensagem_do_cliente: `tentativa ${n}` }, depsDoTurno(registry)));
    }
    const gravadosDepois = await turnosGravados();
    const avisos = await pool.query<{ user_id: string; payload: Record<string, unknown> }>(
      `select user_id, payload from public.notifications where organization_id=$1 and event='ai.limit_reached'`,
      [ORG_L],
    );
    // Assert — G-20: saldo antes/depois.
    expect(desfechos.map((d) => d.status)).toEqual(["handoff", "handoff", "handoff"]);
    expect(desfechos.every((d) => d.motivo === "tenant_rule" && d.chamadas_ao_modelo === 0)).toBe(true);
    expect(estado.chamadas).toBe(0);
    expect(gravadosDepois).toBe(gravadosAntes);
    expect(avisos.rows).toHaveLength(1);
    expect(avisos.rows[0]).toMatchObject({ user_id: ADMIN_L });
    expect(avisos.rows[0]?.payload).toMatchObject({ used: 2, limit: 2 });
    expect(typeof avisos.rows[0]?.payload.day).toBe("string");
    medidas.calls_after_limit = estado.chamadas;
    medidas.calls_after_limit_total = desfechos.length;
    medidas.paused = 1;
    console.info(`f15-t02-pausa: calls_after_limit=${estado.chamadas}/${desfechos.length} usage_delta=${gravadosDepois - gravadosAntes}/0 notified_admin=${avisos.rows.length}/1 (over 4 attempts)`);
  });

  it("subir o limite retoma a IA na hora (resumed=1/1); 0 volta a 'sem teto'", async () => {
    // Arrange — a conversa 4 voltou para a IA (o atendente devolveu, D34).
    await pool.query(`update public.conversations set saas_state='ai_handling', status='ai_handling', assigned_to_user_id=null where id=$1`, [conversaL(4)]);
    await setSetting({ organization_id: ORG_L, source: "session", user_id: ADMIN_L }, "ai.limits.daily_turns", 10, "tenant_admin", { pool });
    const { registry, estado } = registroQueResponde();
    const gravadosAntes = await turnosGravados();
    // Act
    const t = await responderTurno(ctxL, { conversation_id: conversaL(4), mensagem_do_cliente: "voltei" }, depsDoTurno(registry));
    await setSetting({ organization_id: ORG_L, source: "session", user_id: ADMIN_L }, "ai.limits.daily_turns", 0, "tenant_admin", { pool });
    const semTeto = await estadoDoLimite(ctxL, { pool });
    // Assert
    expect(t.status).toBe("respondido");
    expect(estado.chamadas).toBe(1);
    expect((await turnosGravados()) - gravadosAntes).toBe(1);
    expect(semTeto).toMatchObject({ limit: 0, remaining: null, allowed: true });
    medidas.resumed = 1;
    console.info(`f15-t02-retomada: resumed=1/1 provider_calls=${estado.chamadas}/1 no_limit_allowed=1/1`);
  });
});

describe("F15-T03 — handoff por rodízio: entregue a um, visto por um, assumido por um", () => {
  const ctxAtt = (user: string): TenantCtx => ({ organization_id: ORG_A, source: "session", user_id: user });
  const handoffsDe = (conversas: number[]) =>
    pool.query<{ conversation_id: string; assigned_to: string | null; claimed_at: Date | null }>(
      `select conversation_id, assigned_to, claimed_at from public.handoffs where organization_id=$1 and conversation_id = any($2::uuid[]) order by created_at`,
      [ORG_A, conversas.map((n) => conversaDe(ORG_A, n))],
    );

  it("round_robin: H=4 handoffs sobre 3 attendants → balanced=1, assignees_distinct=3, aviso só ao atribuído (4/4)", async () => {
    // Arrange
    await setSetting(ctxA, "handoff.assignment", "round_robin", "tenant_admin", { pool });
    const avisosAntes = await conta(`select count(*)::text as n from public.notifications where organization_id=$1 and event='handoff.created'`, [ORG_A]);
    // Act — quatro transferências pela IA (o caminho real do turno).
    for (const n of [5, 6, 7, 8]) {
      const r = await execute(ctxIaA, IA, "transfer_to_human", { conversation_id: conversaDe(ORG_A, n), reason: "customer_request", summary: `Cliente ${n} pediu uma pessoa.` }, deps());
      expect(r.status, `${r.reason ?? ""} ${r.detalhe ?? ""}`).toBe("executed");
    }
    const linhas = await handoffsDe([5, 6, 7, 8]);
    const porPessoa = new Map<string, number>();
    for (const l of linhas.rows) porPessoa.set(l.assigned_to ?? "null", (porPessoa.get(l.assigned_to ?? "null") ?? 0) + 1);
    const cargas = [...porPessoa.values()];
    const avisos = await pool.query<{ user_id: string; payload: Record<string, unknown> }>(
      `select user_id, payload from public.notifications where organization_id=$1 and event='handoff.created' and payload->>'conversation_id' = any($2::text[]) order by created_at`,
      [ORG_A, [5, 6, 7, 8].map((n) => conversaDe(ORG_A, n))],
    );
    // Assert
    expect(linhas.rows).toHaveLength(4);
    expect(linhas.rows.every((l) => l.assigned_to !== null)).toBe(true);
    expect(porPessoa.has("null")).toBe(false);
    expect(porPessoa.size).toBe(3);
    expect(Math.max(...cargas) - Math.min(...cargas)).toBeLessThanOrEqual(1);
    expect(avisos.rows).toHaveLength(4);
    expect(avisos.rows.every((a) => a.user_id === a.payload.assigned_to)).toBe(true);
    expect((await conta(`select count(*)::text as n from public.notifications where organization_id=$1 and event='handoff.created'`, [ORG_A])) - avisosAntes).toBe(4);
    medidas.handoffs = linhas.rows.length;
    medidas.balanced = Math.max(...cargas) - Math.min(...cargas) <= 1 ? 1 : 0;
    medidas.assignees_distinct = porPessoa.size;
    console.info(`f15-t03-rodizio: handoffs=${linhas.rows.length} balanced=${medidas.balanced} assignees_distinct=${porPessoa.size} notified_assignee_only=${avisos.rows.length}/4 loads=${cargas.join(",")}`);
  });

  it("cada attendant vê só o que lhe foi entregue; o claim de outro é assigned_to_other e o do atribuído assume", async () => {
    // Arrange
    const linhas = await handoffsDe([5, 6, 7, 8]);
    const alvo = linhas.rows[0]!;
    const dono = alvo.assigned_to!;
    const outro = [ATT_A1, ATT_A2, ATT_A3].find((u) => u !== dono)!;
    const idDoAlvo = (await pool.query<{ id: string }>(`select id from public.handoffs where organization_id=$1 and conversation_id=$2`, [ORG_A, alvo.conversation_id])).rows[0]!.id;
    // Act
    const filaDoDono = await filaDeHandoffs(ctxAtt(dono), dono, { pool });
    const filaDoOutro = await filaDeHandoffs(ctxAtt(outro), outro, { pool });
    const recusado = await claim(ctxAtt(outro), idDoAlvo, outro, { pool });
    const assumido = await claim(ctxAtt(dono), idDoAlvo, dono, { pool });
    // Assert
    expect(filaDoDono.some((h) => h.id === idDoAlvo)).toBe(true);
    expect(filaDoOutro.some((h) => h.id === idDoAlvo)).toBe(false);
    expect(recusado).toMatchObject({ ok: false, reason: "assigned_to_other" });
    expect(assumido).toMatchObject({ ok: true, assignee_id: dono, to: "human_handling" });
    console.info(`f15-t03-fila: visible_to_assignee=1/1 hidden_from_other=1/1 other_claim_rejected=1/1 assignee_claim_ok=1/1`);
  });

  it("queue (default) continua sem atribuição: o handoff nasce para a corrida e avisa a fila inteira (1/1)", async () => {
    // Arrange
    await setSetting(ctxA, "handoff.assignment", "queue", "tenant_admin", { pool });
    // Act
    const r = await execute(ctxIaA, IA, "transfer_to_human", { conversation_id: conversaDe(ORG_A, 9), reason: "customer_request", summary: "Cliente 9 pediu uma pessoa." }, deps());
    const linha = (await handoffsDe([9])).rows[0];
    const avisos = await conta(`select count(*)::text as n from public.notifications where organization_id=$1 and event='handoff.created' and payload->>'conversation_id'=$2`, [ORG_A, conversaDe(ORG_A, 9)]);
    // Assert
    expect(r.status).toBe("executed");
    expect(linha?.assigned_to).toBeNull();
    expect(avisos).toBe(3);
    console.info(`f15-t03-queue: unassigned=1/1 notified_queue=${avisos}/3`);
  });
});

describe("F15-T04 — regras sobre o catálogo: 4 gatilhos × 4 ações, replays sem duplicar, fora do catálogo negado", () => {
  const regras: Record<string, string> = {};
  let leadA = "";
  let pedidoDo3 = "";
  let pedidoConfirmavel = "";
  const eventoDe = async (tipo: string) =>
    (
      await pool.query<{ id: string; organization_id: string; event_type: string; entity_kind: string; entity_id: string | null; payload: Record<string, unknown> }>(
        `select id, organization_id, event_type, entity_kind, entity_id, payload from public.event_log
          where organization_id=$1 and event_type=$2 order by created_at desc limit 1`,
        [ORG_A, tipo],
      )
    ).rows[0]!;
  const runsDaOrg = () => conta(`select count(*)::text as n from public.automation_rule_runs where organization_id=$1`, [ORG_A]);

  it("quatro regras ativas, uma por gatilho, cada uma com uma ação do catálogo (rules=4)", async () => {
    // Arrange — o funil padrão e uma oportunidade sem dono para o contato 1;
    // um pedido para o contato 3 (a conversa 3 será resolvida).
    const funil = await pool.query<{ id: string }>(`select id from crm_pipelines where organization_id=$1 and is_default order by position limit 1`, [ORG_A]);
    const etapas = await pool.query<{ id: string }>(`select id from crm_stages where organization_id=$1 and pipeline_id=$2 and not is_won and not is_lost order by position limit 2`, [ORG_A, funil.rows[0]!.id]);
    leadA = randomUUID();
    await pool.query(
      `insert into crm_leads (id, organization_id, pipeline_id, stage_id, contact_id, title, created_at, updated_at) values ($1,$2,$3,$4,$5,'Oportunidade da regra',now(),now())`,
      [leadA, ORG_A, funil.rows[0]!.id, etapas.rows[0]!.id, contatoDe(ORG_A, 1)],
    );
    const pedido3 = await executeOrderCommand(ctxA, { type: "human", user_id: ADMIN_A }, {
      command: "create_draft", idempotency_key: randomUUID(), contact_id: contatoDe(ORG_A, 3), company_id: null, company_name: null, channel: "whatsapp", delivery_date: "2026-09-22", currency: "BRL",
      items: [{ id: randomUUID(), position: 1, requested_text: "1 un", product_id: PRODUCT_A, product_name: "Produto A", sale_unit: "un", quantity: "1.000", unit_price_cents: 1000, currency: "BRL" }],
    }, { pool });
    pedidoDo3 = pedido3.order.id;
    // O pedido que a regra de `order.confirmed` vai ver confirmado: criado pelo
    // serviço (com data prevista), porque o rascunho cru da fixture é incompleto.
    const pedido2 = await executeOrderCommand(ctxA, { type: "human", user_id: ADMIN_A }, {
      command: "create_draft", idempotency_key: randomUUID(), contact_id: contatoDe(ORG_A, 2), company_id: null, company_name: null, channel: "whatsapp", delivery_date: "2026-09-23", currency: "BRL",
      items: [{ id: randomUUID(), position: 1, requested_text: "2 un", product_id: PRODUCT_A, product_name: "Produto A", sale_unit: "un", quantity: "2.000", unit_price_cents: 1000, currency: "BRL" }],
    }, { pool });
    pedidoConfirmavel = pedido2.order.id;
    const definicoes: Array<[string, string, Record<string, unknown>]> = [
      ["lead.stage_changed", "assign_owner", { user_id: null }],
      ["order.confirmed", "create_task", { title: "Preparar a entrega do pedido confirmado", priority: "high", due_in_hours: 24 }],
      ["task.overdue", "send_message", { body: "Passando para lembrar do seu pedido — precisa de algo?" }],
      ["conversation.resolved", "create_task", { title: "Pós-atendimento: ligar em 2 dias", priority: "medium", due_in_hours: null }],
    ];
    // Act
    for (const [gatilho, acao, config] of definicoes) {
      const r = await pool.query<{ id: string }>(
        `insert into public.automation_rules (organization_id, name, trigger_event, conditions, actions, is_active, created_by_user_id)
         values ($1,$2,$3,'[]'::jsonb,$4::jsonb,true,$5) returning id`,
        [ORG_A, `regra ${gatilho} → ${acao}`, gatilho, JSON.stringify([{ type: acao, config }]), ADMIN_A],
      );
      regras[gatilho] = r.rows[0]!.id;
    }
    // Assert
    expect(Object.keys(regras)).toHaveLength(4);
    expect(definicoes.every(([, acao, config]) => validarAcoesDeRegra([{ type: acao, config }]) === null)).toBe(true);
    medidas.rules = 4;
    console.info(`f15-t04-regras: rules=4 actions_valid=4/4`);
  });

  it("cada gatilho real dispara a sua regra (runs=4/4) e o efeito da ação está no banco", async () => {
    // Arrange — os quatro eventos, pelos emissores reais (T00) ou pela rota herdada (lead).
    const etapaNova = (await pool.query<{ stage_id: string }>(`select id as stage_id from crm_stages where organization_id=$1 and not is_won and not is_lost and id <> (select stage_id from crm_leads where id=$2) order by position limit 1`, [ORG_A, leadA])).rows[0]!.stage_id;
    await pool.query(`select public.emit_event('lead.stage_changed','crm_lead',$2::uuid,$3::jsonb,'{"source":"test"}'::jsonb,$1::uuid)`, [ORG_A, leadA, JSON.stringify({ lead_id: leadA, to_stage_id: etapaNova })]);
    await executeOrderCommand(ctxA, { type: "human", user_id: ADMIN_A }, { command: "confirm_order", idempotency_key: randomUUID(), order_id: pedidoConfirmavel, expected_revision: 1 }, { pool });
    await pool.query(`insert into public.crm_tasks (id, organization_id, title, due_date, status, contact_id) values ($1,$2,'vencida da regra',now() - interval '1 hour','pending',$3)`, [randomUUID(), ORG_A, contatoDe(ORG_A, 1)]);
    await varrerTarefasVencidas({ organization_id: ORG_A, source: "cron" }, { pool });
    await transition(ctxA, conversaDe(ORG_A, 3), "human.resolved", { kind: "attendant", userId: ATT_A1 }, { pool });
    const tarefasAntes = await tarefasDe(ORG_A);
    const mensagensAntes = await mensagensDe(conversaDe(ORG_A, 1));
    // Act
    const resultados = [];
    for (const tipo of ["lead.stage_changed", "order.confirmed", "task.overdue", "conversation.resolved"]) {
      resultados.push(await processarEventoDeRegra(await eventoDe(tipo), { pool, adapters: { mock: adapterMock }, modo: "mock" }));
    }
    // Assert — cada run `success`, e o efeito medido na tabela de destino.
    const runs = resultados.flatMap((r) => r.runs);
    expect(runs.map((r) => r.status)).toEqual(["success", "success", "success", "success"]);
    const dono = (await pool.query<{ owner_user_id: string | null }>(`select owner_user_id from crm_leads where id=$1`, [leadA])).rows[0]!.owner_user_id;
    expect([ATT_A1, ATT_A2, ATT_A3]).toContain(dono);
    const tarefaDoPedido = await conta(`select count(*)::text as n from crm_tasks where organization_id=$1 and order_id=$2 and title='Preparar a entrega do pedido confirmado'`, [ORG_A, pedidoConfirmavel]);
    expect(tarefaDoPedido).toBe(1);
    expect((await mensagensDe(conversaDe(ORG_A, 1))) - mensagensAntes).toBe(1);
    const tarefaDoPos = await conta(`select count(*)::text as n from crm_tasks where organization_id=$1 and order_id=$2 and title='Pós-atendimento: ligar em 2 dias'`, [ORG_A, pedidoDo3]);
    expect(tarefaDoPos).toBe(1);
    expect((await tarefasDe(ORG_A)) - tarefasAntes).toBe(2);
    const auditadas = await conta(`select count(*)::text as n from audit_events where organization_id=$1 and actor_type='automation' and result='executed' and request_id like 'rule:%'`, [ORG_A]);
    expect(auditadas).toBe(4);
    medidas.runs = runs.filter((r) => r.status === "success").length;
    console.info(`f15-t04-runs: runs=${medidas.runs}/4 owner_assigned=1/1 task_on_order=1/1 message_sent=1/1 task_after_resolved=1/1 audited_automation=${auditadas}/4`);
  });

  it("redespachar os quatro eventos não executa nada de novo (replays=4 duplicate_runs=0)", async () => {
    // Arrange
    const runsAntes = await runsDaOrg();
    const tarefasAntes = await tarefasDe(ORG_A);
    const mensagensAntes = await mensagensDe(conversaDe(ORG_A, 1));
    // Act
    const resultados = [];
    for (const tipo of ["lead.stage_changed", "order.confirmed", "task.overdue", "conversation.resolved"]) {
      resultados.push(await processarEventoDeRegra(await eventoDe(tipo), { pool, adapters: { mock: adapterMock }, modo: "mock" }));
    }
    // Assert — o índice da 9027 recusou as quatro; nenhuma linha, tarefa ou mensagem nova.
    const status = resultados.flatMap((r) => r.runs.map((x) => x.status));
    expect(status).toEqual(["duplicate", "duplicate", "duplicate", "duplicate"]);
    expect((await runsDaOrg()) - runsAntes).toBe(0);
    expect((await tarefasDe(ORG_A)) - tarefasAntes).toBe(0);
    expect((await mensagensDe(conversaDe(ORG_A, 1))) - mensagensAntes).toBe(0);
    medidas.replays = status.length;
    medidas.duplicate_runs = (await runsDaOrg()) - runsAntes;
    console.info(`f15-t04-replays: replays=${status.length} duplicate_runs=${medidas.duplicate_runs} tasks_delta=0/0 messages_delta=0/0`);
  });

  it("ação fora do catálogo é recusada na escrita e não executa na leitura (outside_catalog_denied=1/1)", async () => {
    // Arrange — uma regra legada com ação herdada do kit (call_webhook).
    const recusa = validarAcoesDeRegra([{ type: "call_webhook", config: { url: "https://example.invalid" } }]);
    const legada = await pool.query<{ id: string }>(
      `insert into public.automation_rules (organization_id, name, trigger_event, conditions, actions, is_active)
       values ($1,'legada',$2,'[]'::jsonb,$3::jsonb,true) returning id`,
      [ORG_A, "order.confirmed", JSON.stringify([{ type: "call_webhook", config: { url: "https://example.invalid" } }])],
    );
    // Um evento NOVO de verdade no barramento (a run tem FK para event_log).
    const novoEvento = await pool.query<{ id: string }>(
      `select public.emit_event('order.confirmed','crm_order',$2::uuid,$3::jsonb,'{"source":"test"}'::jsonb,$1::uuid) as id`,
      [ORG_A, pedidoConfirmavel, JSON.stringify({ order_id: pedidoConfirmavel, contact_id: contatoDe(ORG_A, 2) })],
    );
    const evento = { ...(await eventoDe("order.confirmed")), id: novoEvento.rows[0]!.id };
    // Act
    const r = await processarEventoDeRegra(evento, { pool, adapters: { mock: adapterMock }, modo: "mock" });
    const daLegada = r.runs.find((x) => x.rule_id === legada.rows[0]!.id);
    // Assert
    expect(recusa).toMatch(/fora do catálogo: call_webhook/);
    expect(daLegada?.status).toBe("failed");
    expect(daLegada?.actions[0]).toMatchObject({ type: "call_webhook", status: "failed", error: "outside_catalog" });
    await pool.query(`delete from public.automation_rules where id=$1`, [legada.rows[0]!.id]);
    medidas.outside_catalog_denied = recusa !== null && daLegada?.status === "failed" ? 1 : 0;
    console.info(`f15-t04-catalogo: outside_catalog_denied=${medidas.outside_catalog_denied}/1 (write=1/1 run=1/1)`);
  });
});

describe("F15-T05 — conhecimento: reindexação incremental e proveniência citada", () => {
  const FONTE_L = TENANT_L.materiais[0]!.fonte;
  const ORIGINAL = TENANT_L.materiais[0]!.trechos[0]!;
  // ≈ 690 caracteres: com o trecho original (curto) passa de 700 e vira o SEGUNDO
  // trecho — `partirEmTrechos` junta parágrafos curtos até o alvo de 700.
  const NOVO = `${Array.from({ length: 8 }, (_, i) => `a retirada na loja e possivel de segunda a sexta das nove as dezoito (nota ${i})`).join(" ")} horario sujeito a alteracao em feriados e vesperas`;
  function embutidorQueConta() {
    const estado = { chamadas: 0 };
    // O mesmo embutidor determinístico do turno (mock, D12), só contado: os
    // vetores têm de continuar comparáveis com a pergunta do cliente.
    const embutir = (texto: string) => {
      estado.chamadas += 1;
      return embutirDeterministico(texto);
    };
    return { embutir, estado };
  }

  it("trecho inalterado não é reembedado; só o novo/alterado chama o embutidor (reindexed=N/N unchanged_skipped=M/M)", async () => {
    // Arrange — o material da fixture tem 1 trecho embutido na versão 1.
    const chunksAntes = await conta(`select count(*)::text as n from public.ai_chunks where organization_id=$1 and knowledge_source_id=$2`, [ORG_L, FONTE_L]);
    // Act 1 — acrescenta um parágrafo: 1 igual + 1 novo.
    const um = embutidorQueConta();
    const r1 = await reindexarDocumento(ctxL, FONTE_L, { conteudo: `${ORIGINAL}\n\n${NOVO}` }, { pool, embutir: um.embutir });
    // Act 2 — o mesmo texto de novo: nada a embutir.
    const dois = embutidorQueConta();
    const r2 = await reindexarDocumento(ctxL, FONTE_L, { conteudo: `${ORIGINAL}\n\n${NOVO}` }, { pool, embutir: dois.embutir });
    // Act 3 — altera o primeiro parágrafo: 1 alterado + 1 igual.
    const tres = embutidorQueConta();
    const r3 = await reindexarDocumento(ctxL, FONTE_L, { conteudo: `${ORIGINAL} — atualizado\n\n${NOVO}` }, { pool, embutir: tres.embutir });
    const ativa = await pool.query<{ active_kb_version_id: string; chunks_count: number }>(`select active_kb_version_id, chunks_count from public.ai_knowledge_sources where id=$1`, [FONTE_L]);
    const chunksDaAtiva = await conta(`select count(*)::text as n from public.ai_chunks where organization_id=$1 and kb_version_id=$2`, [ORG_L, ativa.rows[0]!.active_kb_version_id]);
    const chunksTotal = await conta(`select count(*)::text as n from public.ai_chunks where organization_id=$1 and knowledge_source_id=$2`, [ORG_L, FONTE_L]);
    const versoesAtivas = await conta(`select count(*)::text as n from public.ai_knowledge_versions where organization_id=$1 and knowledge_source_id=$2 and is_active`, [ORG_L, FONTE_L]);
    // Assert — chamadas ao embutidor = trechos reindexados, sempre.
    expect(chunksAntes).toBe(1);
    expect(r1).toMatchObject({ version_number: 2, trechos: 2, reindexed: 1, unchanged_skipped: 1 });
    expect(um.estado.chamadas).toBe(1);
    expect(r2).toMatchObject({ version_number: 3, trechos: 2, reindexed: 0, unchanged_skipped: 2 });
    expect(dois.estado.chamadas).toBe(0);
    expect(r3).toMatchObject({ version_number: 4, trechos: 2, reindexed: 1, unchanged_skipped: 1 });
    expect(tres.estado.chamadas).toBe(1);
    expect(ativa.rows[0]!.active_kb_version_id).toBe(r3.version_id);
    expect(Number(ativa.rows[0]!.chunks_count)).toBe(2);
    expect(chunksDaAtiva).toBe(2);
    expect(chunksTotal).toBe(2);
    expect(versoesAtivas).toBe(1);
    medidas.reindexed = r1.reindexed + r2.reindexed + r3.reindexed;
    medidas.reindexed_total = um.estado.chamadas + dois.estado.chamadas + tres.estado.chamadas;
    medidas.unchanged_skipped = r1.unchanged_skipped + r2.unchanged_skipped + r3.unchanged_skipped;
    medidas.unchanged_total = r1.trechos + r2.trechos + r3.trechos - medidas.reindexed;
    console.info(`f15-t05-reindex: reindexed=${medidas.reindexed}/${medidas.reindexed_total} unchanged_skipped=${medidas.unchanged_skipped}/${medidas.unchanged_total} active_versions=1/1 chunks_active=2/2 chunks_total=2/2`);
  });

  it("a resposta que usou o acervo cita a fonte no resultado e na mensagem enviada (sources_cited=S/S)", async () => {
    // Arrange — a conversa 4 respondeu na T02 e ficou em `waiting_customer`; a
    // mensagem nova do cliente a devolve à IA (é o que o inbound faz, D16).
    await pool.query(`update public.conversations set saas_state='ai_handling', status='ai_handling' where id=$1`, [conversaL(4)]);
    const { registry } = registroQueResponde();
    // Act
    const t = await responderTurno(ctxL, { conversation_id: conversaL(4), mensagem_do_cliente: "qual o prazo de entrega para Campinas?" }, depsDoTurno(registry));
    const mensagem = await pool.query<{ metadata: Record<string, unknown> }>(
      `select metadata from public.messages where organization_id=$1 and conversation_id=$2 and direction='outbound' order by created_at desc limit 1`,
      [ORG_L, conversaL(4)],
    );
    // Assert
    expect(t.status).toBe("respondido");
    expect(t.fontes_citadas).toEqual(["Entregas e prazos"]);
    expect(mensagem.rows[0]?.metadata["ai_sources"]).toEqual(["Entregas e prazos"]);
    medidas.sources_cited = t.fontes_citadas.length > 0 ? 1 : 0;
    medidas.sources_total = 1;
    console.info(`f15-t05-proveniencia: sources_cited=${medidas.sources_cited}/${medidas.sources_total} sources=${t.fontes_citadas.join(",")}`);
  });
});

describe("F15-T01 — papéis: as rotas novas negam o attendant e o dono da plataforma", () => {
  it("roles_denied=D/D pelas permissões que as rotas exigem (settings.manage) e pelo rank mínimo (manager)", () => {
    // Arrange — o que cada rota nova da F15 exige (ai-autonomy, ai-limits, automation-rules).
    const negadas: Array<[PapelD15, Permissao]> = [
      ["attendant", "settings.manage"],
      ["platform_admin", "settings.manage"],
      ["attendant", "settings.manage"],
    ];
    // Act
    const negou = negadas.map(([papel, permissao]) => !can(papel, permissao));
    const rankNega = ROLE_RANK.agent < ROLE_RANK.manager;
    // Assert
    expect(negou.every(Boolean)).toBe(true);
    expect(rankNega).toBe(true);
    expect(can("tenant_admin", "settings.manage") && can("manager", "settings.manage")).toBe(true);
    medidas.roles_denied = negou.filter(Boolean).length;
    medidas.roles_denied_total = negadas.length;
    console.info(`f15-t01-papeis: roles_denied=${medidas.roles_denied}/${medidas.roles_denied_total} manager_allowed=1/1`);
  });
});
