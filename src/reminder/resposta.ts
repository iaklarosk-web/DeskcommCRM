/**
 * A RESPOSTA do cliente ao lembrete (§5.12: "5.7 → 5.6 → 5.9; a IA lê a tag,
 * extrai quantidades e chama `update_order_quantity` …; `replied_at` é
 * preenchido"; §7.6 F05-T08).
 *
 * Três momentos, três funções:
 *
 *  · `registrarRespostaAoLembrete` — chamada pelo PIPELINE DE ENTRADA
 *    (`src/channels/inbound.ts`), na transação da mensagem: carimba
 *    `replied_at`/`replied_message_id` no lembrete aberto desta conversa e
 *    decide `replied_late` contra o `cutoff_at` gravado no envio. É aqui, e
 *    não no turno da IA, porque a resposta é um FATO da entrada — ela existe
 *    mesmo que a IA esteja desligada ou a conversa esteja com uma pessoa.
 *  · `lembreteDaConversa` — lida pelo CONSTRUTOR DE CONTEXTO do turno
 *    (`src/ai/contexto.ts`): se a conversa tem a tag `awaiting_quantity`, o
 *    lembrete em curso entra no prompt com o pedido `draft` do cliente (ids,
 *    itens, revisão) — é o que dá ao modelo o `order_id`/`item_id`/
 *    `expected_revision` que `update_order_quantity` exige.
 *  · `concluirLembrete` — chamada pelo TURNO ao terminar de tratar a
 *    resposta: carimba o desfecho e LIMPA a tag. O turno não executa domínio
 *    (§5.9); concluir o lembrete é fechar o próprio ciclo da automação, como
 *    `ai.reply_sent` fecha o da resposta.
 *
 * ─── Resposta DEPOIS do corte ───────────────────────────────────────────────
 *
 * §7.6 T08: "resposta após fechamento da produção segue exceção/avaliação
 * humana configurada, sem assumir a entrega automaticamente". Aqui isso é
 * `replied_late=true`: o turno NÃO extrai quantidade nem toca no pedido —
 * chama gente (`transfer_to_human`, motivo `tenant_rule`), com o pedido e o
 * período no dossiê. A regra de exceção da empresa (aceitar tarde? até quando?)
 * é configuração futura (D48); até lá o único desfecho honesto é humano.
 */
import { limparTag, tagsDaConversa } from "@/src/conversation";
import { listOrderCards, type OrderCard } from "@/src/crm/reads";
import { incrementCounter } from "@/src/obs/counters";
import type { ServicePool } from "@/src/tenant-context/db";
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";

export interface RespostaRegistrada {
  readonly reminder_run_id: string;
  readonly period_key: string;
  readonly late: boolean;
}

export async function registrarRespostaAoLembrete(
  db: TenantDb,
  ctx: TenantCtx,
  conversationId: string,
  messageId: string,
  agora: Date,
): Promise<RespostaRegistrada | null> {
  const r = await db.query<{ id: string; period_key: string; replied_late: boolean }>(
    `update public.reminder_runs
        set replied_at = $3, replied_message_id = $4::uuid,
            replied_late = (cutoff_at < $3::timestamptz)
      where id = (
        select id from public.reminder_runs
         where organization_id = $1 and conversation_id = $2
           and sent_message_id is not null and replied_at is null
         order by sent_at desc, id desc
         limit 1
      ) and organization_id = $1
      returning id, period_key, replied_late`,
    [ctx.organization_id, conversationId, agora.toISOString(), messageId],
  );
  const linha = r.rows[0];
  if (linha === undefined) return null;
  incrementCounter(linha.replied_late ? "reminder_replied_late" : "reminder_replied");
  return { reminder_run_id: linha.id, period_key: linha.period_key, late: linha.replied_late };
}

export interface LembreteDaConversa {
  readonly reminder_run_id: string;
  readonly period_key: string;
  readonly sent_at: string | null;
  readonly cutoff_at: string | null;
  readonly replied_at: string | null;
  readonly replied_late: boolean;
  /** O pedido `draft` mais recente do cliente, com ids, itens e revisão — ou nulo. */
  readonly pedido_draft: OrderCard | null;
}

const iso = (v: Date | string | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : String(v);

/**
 * O lembrete em curso desta conversa, ou `null` quando a conversa não espera
 * quantidade (sem a tag) ou não há lembrete aberto.
 */
export async function lembreteDaConversa(
  ctx: TenantCtx,
  conversationId: string,
  deps: { pool?: ServicePool } = {},
): Promise<LembreteDaConversa | null> {
  const linha = await withTenant(
    ctx,
    async (db) => {
      const tags = await tagsDaConversa(db, ctx, conversationId);
      if (!tags.includes("awaiting_quantity")) return null;
      const r = await db.query<{
        id: string;
        customer_id: string;
        period_key: string;
        sent_at: Date | string | null;
        cutoff_at: Date | string | null;
        replied_at: Date | string | null;
        replied_late: boolean;
      }>(
        `select id, customer_id, period_key, sent_at, cutoff_at, replied_at, replied_late
           from public.reminder_runs
          where organization_id = $1 and conversation_id = $2
            and sent_message_id is not null and concluded_at is null
          order by sent_at desc, id desc
          limit 1`,
        [ctx.organization_id, conversationId],
      );
      return r.rows[0] ?? null;
    },
    { pool: deps.pool },
  );
  if (linha === null) return null;

  const pedidos = await listOrderCards(ctx, linha.customer_id, 5, { pool: deps.pool });
  return {
    reminder_run_id: linha.id,
    period_key: linha.period_key,
    sent_at: iso(linha.sent_at),
    cutoff_at: iso(linha.cutoff_at),
    replied_at: iso(linha.replied_at),
    replied_late: linha.replied_late,
    pedido_draft: pedidos.find((p) => p.status === "draft") ?? null,
  };
}

export type DesfechoDoLembrete =
  | "order_updated"
  | "order_created"
  | "handoff_late_reply"
  | "handoff"
  | "no_action";

/** Fecha o ciclo do lembrete e limpa a tag da conversa. Idempotente. */
export async function concluirLembrete(
  ctx: TenantCtx,
  reminderRunId: string,
  desfecho: DesfechoDoLembrete,
  deps: { pool?: ServicePool } = {},
): Promise<boolean> {
  return withTenant(
    ctx,
    async (db) => {
      const r = await db.query<{ conversation_id: string | null }>(
        `update public.reminder_runs
            set concluded_at = now(), concluded_as = $3
          where id = $1 and organization_id = $2 and concluded_at is null
          returning conversation_id`,
        [reminderRunId, ctx.organization_id, desfecho],
      );
      const conversa = r.rows[0]?.conversation_id ?? null;
      if (conversa !== null) await limparTag(db, ctx, conversa, "awaiting_quantity");
      incrementCounter("reminder_concluded", { as: desfecho });
      return r.rows.length === 1;
    },
    { pool: deps.pool },
  );
}
