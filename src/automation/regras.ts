/**
 * F15-T04 — regras QUANDO/SE/ENTÃO sobre o catálogo (ADR-036 §2 T04, D54 e).
 *
 * O vocabulário fechado de uma regra do SaaS:
 *  - GATILHOS: os quatro que o proprietário aprovou (`lead.stage_changed`,
 *    `conversation.resolved`, `order.confirmed`, `task.overdue`) mais
 *    `lead.created`, herdado e já emitido pela base;
 *  - AÇÕES: só entradas do catálogo D17 com executor `automation`
 *    (`send_message`, `create_task`, `transfer_to_human`, `assign_owner`).
 *    Nenhum side effect fora do catálogo (D17: "automação não executa side
 *    effect fora dele") — as sete ações herdadas do kit (`call_webhook`,
 *    `send_whatsapp`…) ficam fora do vocabulário do SaaS.
 *
 * Este arquivo também resolve as ENTRADAS de cada ação a partir do evento:
 * a regra diz "quando o pedido for confirmado, crie a tarefa X"; o que a ação
 * precisa (`order_id`, `conversation_id`, `opportunity_id`) vem do evento ou
 * das tabelas do tenant, e o que não se resolve é `skipped` com motivo — a run
 * registra, ninguém inventa.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { findAction } from "@/src/actions/catalog";
import { conversaAceitaEnvio } from "@/src/actions/catalog";
import type { ConversationState } from "@/src/conversation";
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";

export const GATILHOS_DE_REGRA = [
  "lead.created",
  "lead.stage_changed",
  "conversation.resolved",
  "order.confirmed",
  "task.overdue",
] as const;
export type GatilhoDeRegra = (typeof GATILHOS_DE_REGRA)[number];

export const ACOES_DE_REGRA = ["send_message", "create_task", "transfer_to_human", "assign_owner"] as const;
export type AcaoDeRegra = (typeof ACOES_DE_REGRA)[number];

export function ehGatilhoDeRegra(valor: unknown): valor is GatilhoDeRegra {
  return typeof valor === "string" && (GATILHOS_DE_REGRA as readonly string[]).includes(valor);
}
export function ehAcaoDeRegra(valor: unknown): valor is AcaoDeRegra {
  return typeof valor === "string" && (ACOES_DE_REGRA as readonly string[]).includes(valor);
}

/** Toda ação de regra é entrada do catálogo com executor `automation` — conferido na carga. */
for (const nome of ACOES_DE_REGRA) {
  const entrada = findAction(nome);
  if (entrada === null || !entrada.executors.includes("automation")) {
    throw new Error(`ACOES_DE_REGRA: ${nome} não é ação do catálogo com executor automation`);
  }
}

/** A configuração de cada ação, como a tela grava em `automation_rules.actions[].config`. */
export const CONFIG_DA_ACAO = {
  send_message: z.strictObject({ body: z.string().trim().min(1).max(4096) }),
  create_task: z.strictObject({
    title: z.string().trim().min(1).max(255),
    priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    due_in_hours: z.number().int().min(1).max(24 * 365).nullable().default(null),
  }),
  transfer_to_human: z.strictObject({ summary: z.string().trim().min(2).max(2000) }),
  assign_owner: z.strictObject({ user_id: z.string().uuid().nullable().default(null) }),
} as const;

export const acaoDeRegraSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("send_message"), config: CONFIG_DA_ACAO.send_message }),
  z.strictObject({ type: z.literal("create_task"), config: CONFIG_DA_ACAO.create_task }),
  z.strictObject({ type: z.literal("transfer_to_human"), config: CONFIG_DA_ACAO.transfer_to_human }),
  z.strictObject({ type: z.literal("assign_owner"), config: CONFIG_DA_ACAO.assign_owner }),
]);
export type AcaoDeRegraConfigurada = z.infer<typeof acaoDeRegraSchema>;

/**
 * Valida a lista de ações de uma regra do SaaS. Devolve `null` quando serve,
 * ou o PRIMEIRO problema com nome — é o que a rota devolve em 422 e o que o
 * mutante 72 sabota.
 */
export function validarAcoesDeRegra(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return "esperava ao menos uma ação";
  if (value.length > 10) return "no máximo 10 ações por regra";
  for (const [i, acao] of value.entries()) {
    const tipo = typeof acao === "object" && acao !== null ? (acao as { type?: unknown }).type : undefined;
    if (!ehAcaoDeRegra(tipo)) return `ação ${i + 1} fora do catálogo: ${String(tipo)}`;
    const lida = acaoDeRegraSchema.safeParse(acao);
    if (!lida.success) return `ação ${i + 1} (${tipo}): configuração inválida`;
  }
  return null;
}

/**
 * O que a rota confere depois do schema herdado: gatilho e ações dentro do
 * vocabulário do SaaS. `null` = serve; texto = o primeiro problema, com nome.
 */
export function regraForaDoVocabulario(triggerEvent: unknown, actions: unknown): string | null {
  if (!ehGatilhoDeRegra(triggerEvent)) return `gatilho fora do vocabulário: ${String(triggerEvent)} (aceitos: ${GATILHOS_DE_REGRA.join(", ")})`;
  return validarAcoesDeRegra(actions);
}

// ─── Entradas da ação a partir do evento ────────────────────────────────────

export interface EventoDeRegra {
  readonly id: string;
  readonly event_type: string;
  readonly entity_kind: string;
  readonly entity_id: string | null;
  readonly payload: Record<string, unknown>;
}

export type EntradasResolvidas =
  | { readonly ok: true; readonly input: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string };

const lerUuid = (v: unknown): string | null => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

/** uuid v5-like determinístico (sha1 truncado) — o `idempotency_key` de create_task por (regra, evento). */
export function uuidDeterministico(semente: string): string {
  const h = createHash("sha1").update(semente).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0")}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

async function contatoDoEvento(db: TenantDb, ctx: TenantCtx, evento: EventoDeRegra): Promise<string | null> {
  const direto = lerUuid(evento.payload["contact_id"]);
  if (direto !== null) return direto;
  if (evento.entity_kind === "crm_lead" && evento.entity_id !== null) {
    const r = await db.query<{ contact_id: string | null }>(`select contact_id from public.crm_leads where organization_id=$1 and id=$2`, [ctx.organization_id, evento.entity_id]);
    return r.rows[0]?.contact_id ?? null;
  }
  if (evento.entity_kind === "conversation" && evento.entity_id !== null) {
    const r = await db.query<{ contact_id: string }>(`select contact_id from public.conversations where organization_id=$1 and id=$2`, [ctx.organization_id, evento.entity_id]);
    return r.rows[0]?.contact_id ?? null;
  }
  return null;
}

/** A conversa ATIVA do contato — a mais recente cujo estado aceita envio (D33). */
async function conversaAtivaDoContato(db: TenantDb, ctx: TenantCtx, contactId: string): Promise<string | null> {
  const r = await db.query<{ id: string; saas_state: ConversationState }>(
    `select id, saas_state from public.conversations
      where organization_id=$1 and contact_id=$2 and saas_state is not null
      order by coalesce(saas_state_entered_at, created_at) desc limit 5`,
    [ctx.organization_id, contactId],
  );
  return r.rows.find((c) => conversaAceitaEnvio(c.saas_state))?.id ?? null;
}

async function pedidoDoEvento(db: TenantDb, ctx: TenantCtx, evento: EventoDeRegra, contactId: string | null): Promise<string | null> {
  const direto = lerUuid(evento.payload["order_id"]);
  if (direto !== null) return direto;
  if (evento.entity_kind === "crm_lead" && evento.entity_id !== null) {
    const r = await db.query<{ target_id: string }>(
      `select target_id from public.crm_lead_links where organization_id=$1 and lead_id=$2 and target_kind='order' order by created_at desc limit 1`,
      [ctx.organization_id, evento.entity_id],
    );
    if (r.rows[0]) return r.rows[0].target_id;
  }
  if (contactId === null) return null;
  const r = await db.query<{ id: string }>(
    `select id from public.crm_orders where organization_id=$1 and contact_id=$2 and status in ('draft','confirmed','in_production')
      order by created_at desc limit 1`,
    [ctx.organization_id, contactId],
  );
  return r.rows[0]?.id ?? null;
}

async function oportunidadeDoEvento(db: TenantDb, ctx: TenantCtx, evento: EventoDeRegra, contactId: string | null): Promise<string | null> {
  if (evento.entity_kind === "crm_lead" && evento.entity_id !== null) return evento.entity_id;
  const direto = lerUuid(evento.payload["lead_id"]);
  if (direto !== null) return direto;
  if (contactId === null) return null;
  const r = await db.query<{ id: string }>(
    `select id from public.crm_leads where organization_id=$1 and contact_id=$2 and status='open' and owner_user_id is null and owner_agent_id is null
      order by created_at desc limit 1`,
    [ctx.organization_id, contactId],
  );
  return r.rows[0]?.id ?? null;
}

/**
 * Resolve as entradas da ação para este evento. `ok:false` é a ação que não
 * tem sobre o que agir (sem conversa ativa, sem pedido, sem oportunidade) —
 * fica na run como `skipped`, com o motivo.
 */
export async function entradasDaAcao(
  ctx: TenantCtx,
  acao: AcaoDeRegraConfigurada,
  evento: EventoDeRegra,
  chave: { readonly ruleId: string },
  deps: { pool?: ServicePool; agora?: () => Date } = {},
): Promise<EntradasResolvidas> {
  const agora = (deps.agora ?? (() => new Date()))();
  return withTenant(
    ctx,
    async (db) => {
      const contactId = await contatoDoEvento(db, ctx, evento);
      switch (acao.type) {
        case "send_message": {
          const conversationId = lerUuid(evento.payload["conversation_id"]) ?? (contactId === null ? null : await conversaAtivaDoContato(db, ctx, contactId));
          if (conversationId === null) return { ok: false, reason: "no_active_conversation" };
          return { ok: true, input: { conversation_id: conversationId, body: acao.config.body } };
        }
        case "transfer_to_human": {
          const conversationId = contactId === null ? null : await conversaAtivaDoContato(db, ctx, contactId);
          if (conversationId === null) return { ok: false, reason: "no_active_conversation" };
          return { ok: true, input: { conversation_id: conversationId, reason: "tenant_rule", summary: acao.config.summary } };
        }
        case "create_task": {
          const orderId = await pedidoDoEvento(db, ctx, evento, contactId);
          if (orderId === null) return { ok: false, reason: "no_order" };
          return {
            ok: true,
            input: {
              order_id: orderId,
              title: acao.config.title,
              priority: acao.config.priority,
              due_date: acao.config.due_in_hours === null ? null : new Date(agora.getTime() + acao.config.due_in_hours * 3_600_000).toISOString(),
              idempotency_key: uuidDeterministico(`rule:${chave.ruleId}:event:${evento.id}:create_task`),
            },
          };
        }
        case "assign_owner": {
          const opportunityId = await oportunidadeDoEvento(db, ctx, evento, contactId);
          if (opportunityId === null) return { ok: false, reason: "no_open_opportunity" };
          return { ok: true, input: { opportunity_id: opportunityId, user_id: acao.config.user_id } };
        }
      }
    },
    { pool: deps.pool },
  );
}
