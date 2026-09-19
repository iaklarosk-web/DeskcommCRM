/**
 * A ASSINATURA de uma organização — leitura, criação, checkout, evento do
 * gateway, carência, mudança de plano e cancelamento (F12-T03/T05/T06,
 * ADR-030 §3; D38, D44).
 *
 * Tudo aqui roda dentro de `withTenant` (D20): uma transação por operação,
 * `app.organization_id` posto, `organization_id` explícito em cada SQL. As
 * tabelas são `service_only` (D35) — este módulo é o único escritor.
 *
 * Idempotência e ordem (§7.9 F12: "eventos duplicados/fora de ordem não
 * duplicam acesso/cobrança"):
 *   - DUPLICADO: `billing_events (gateway, event_ref)` é único; o segundo
 *     `insert … on conflict do nothing` cria 0 linhas e a função devolve
 *     `duplicate` sem tocar na assinatura (G-57: é o índice, não um select).
 *   - FORA DE ORDEM: evento com `occurred_at` anterior ao `last_event_at` da
 *     assinatura é gravado com `applied=false, ignored_reason='out_of_order'`
 *     e não muda nada — o mais novo já falou.
 *   - SEM TRANSIÇÃO: `payment_failed` numa assinatura `pending_payment` (nada a
 *     inadimplir) fica registrado como `no_transition`.
 *
 * Nada aqui apaga dado: cancelar e bloquear mudam o ESTADO. É a metade de D44
 * que o banco cumpre; a outra (escrita negada) é de `acesso.ts` + `requireRole`.
 */
import { incrementCounter } from "@/src/obs/counters";
import { notify } from "@/src/notifications";
import { membrosPorPapel } from "@/src/notifications/destinatarios";
import type { ServicePool } from "@/src/tenant-context/db";
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";

import {
  ehEstadoDaAssinatura,
  transicao,
  type EstadoDaAssinatura,
  type OrigemDaAssinatura,
  type TipoDeEventoDoGateway,
} from "./estados";
import { obterPlano, type Plano } from "./planos";

export interface Assinatura {
  readonly id: string;
  readonly organization_id: string;
  readonly plan_code: string;
  readonly status: EstadoDaAssinatura;
  readonly origin: OrigemDaAssinatura;
  readonly gateway: string | null;
  readonly gateway_ref: string | null;
  readonly current_period_start: string | null;
  readonly current_period_end: string | null;
  readonly failed_at: string | null;
  readonly grace_until: string | null;
  readonly blocked_at: string | null;
  readonly cancelled_at: string | null;
  readonly cancel_reason: string | null;
  readonly last_event_at: string | null;
  /** F19 (9033): cliente no gateway (Stripe `cus_…`); nulo em mock/operator. */
  readonly customer_ref: string | null;
  /** F19 (9033): fim do período de teste (D57 c); nulo = sem trial. */
  readonly trial_ends_at: string | null;
}

export interface Fatura {
  readonly id: string;
  readonly plan_code: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly amount_cents: number;
  readonly currency: string;
  readonly status: "open" | "paid" | "failed" | "void";
  readonly due_at: string;
  readonly paid_at: string | null;
  readonly gateway_ref: string | null;
}

/**
 * F19 (ADR-042 §6, D57 b): organização com gateway `stripe` troca de plano e
 * cancela no Customer Portal — as rotas da F12 respondem 409 `use_portal`.
 */
export class UsePortal extends Error {
  constructor(public readonly acao: "plan_change" | "cancel") {
    super(`ação ${acao} acontece no Customer Portal do gateway`);
    this.name = "UsePortal";
  }
}

export class TransicaoIlegal extends Error {
  constructor(
    public readonly de: EstadoDaAssinatura | "none",
    public readonly evento: string,
  ) {
    super(`transição ilegal da assinatura: ${de} -${evento}->`);
    this.name = "TransicaoIlegal";
  }
}

interface Deps {
  pool?: ServicePool;
  /** Dias de carência (D44). Vem de `lib/env.ts` no produto; o teste injeta. */
  graceDays?: number;
  agora?: () => Date;
}

const COLUNAS = `id, organization_id, plan_code, status, origin, gateway, gateway_ref,
  current_period_start, current_period_end, failed_at, grace_until, blocked_at,
  cancelled_at, cancel_reason, last_event_at, customer_ref, trial_ends_at`;

function agoraDe(deps: Deps): Date {
  return (deps.agora ?? (() => new Date()))();
}

async function diasDeCarencia(deps: Deps): Promise<number> {
  if (typeof deps.graceDays === "number") return deps.graceDays;
  const { env } = await import("@/lib/env");
  return env.BILLING_GRACE_DAYS;
}

function normalizar(linha: Record<string, unknown>): Assinatura {
  const status = linha.status;
  if (!ehEstadoDaAssinatura(status)) throw new Error(`subscriptions.status fora do enum: ${String(status)}`);
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));
  return {
    id: String(linha.id),
    organization_id: String(linha.organization_id),
    plan_code: String(linha.plan_code),
    status,
    origin: linha.origin as OrigemDaAssinatura,
    gateway: (linha.gateway as string | null) ?? null,
    gateway_ref: (linha.gateway_ref as string | null) ?? null,
    current_period_start: iso(linha.current_period_start),
    current_period_end: iso(linha.current_period_end),
    failed_at: iso(linha.failed_at),
    grace_until: iso(linha.grace_until),
    blocked_at: iso(linha.blocked_at),
    cancelled_at: iso(linha.cancelled_at),
    cancel_reason: (linha.cancel_reason as string | null) ?? null,
    last_event_at: iso(linha.last_event_at),
    customer_ref: (linha.customer_ref as string | null) ?? null,
    trial_ends_at: iso(linha.trial_ends_at),
  };
}

export async function lerAssinaturaEm(db: TenantDb, ctx: TenantCtx): Promise<Assinatura | null> {
  const { rows } = await db.query<Record<string, unknown>>(
    `select ${COLUNAS} from public.subscriptions where organization_id = $1`,
    [ctx.organization_id],
  );
  return rows[0] ? normalizar(rows[0]) : null;
}

export async function lerAssinatura(ctx: TenantCtx, deps: Deps = {}): Promise<Assinatura | null> {
  return withTenant(ctx, (db) => lerAssinaturaEm(db, ctx), deps);
}

export async function listarFaturasEm(db: TenantDb, ctx: TenantCtx): Promise<readonly Fatura[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `select id, plan_code, period_start, period_end, amount_cents, currency, status, due_at, paid_at, gateway_ref
       from public.invoices where organization_id = $1 order by period_start desc, created_at desc`,
    [ctx.organization_id],
  );
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));
  return rows.map((r) => ({
    id: String(r.id),
    plan_code: String(r.plan_code),
    period_start: iso(r.period_start) ?? "",
    period_end: iso(r.period_end) ?? "",
    amount_cents: Number(r.amount_cents),
    currency: String(r.currency),
    status: r.status as Fatura["status"],
    due_at: iso(r.due_at) ?? "",
    paid_at: iso(r.paid_at),
    gateway_ref: (r.gateway_ref as string | null) ?? null,
  }));
}

/**
 * Cria a assinatura de uma organização que ainda não tem (cadastro, admin,
 * loader do seed, fixture). `active` nasce com o período do plano a partir de
 * agora. Devolve a assinatura; lança se já existe (índice único).
 */
export async function criarAssinaturaEm(
  db: TenantDb,
  ctx: TenantCtx,
  entrada: { plan_code: string; origin: OrigemDaAssinatura; status: "active" | "pending_payment" },
  deps: Deps = {},
): Promise<Assinatura> {
  const plano = await obterPlano(entrada.plan_code, { pool: deps.pool });
  const agora = agoraDe(deps);
  const fim = new Date(agora.getTime() + plano.period_days * 86_400_000);
  const ativa = entrada.status === "active";
  const { rows } = await db.query<Record<string, unknown>>(
    `insert into public.subscriptions
       (organization_id, plan_code, status, origin, current_period_start, current_period_end)
     values ($1, $2, $3, $4, $5, $6)
     returning ${COLUNAS}`,
    [ctx.organization_id, plano.code, entrada.status, entrada.origin, ativa ? agora : null, ativa ? fim : null],
  );
  incrementCounter("billing_subscription_created", { origin: entrada.origin, status: entrada.status });
  return normalizar(rows[0]!);
}

export async function criarAssinatura(
  ctx: TenantCtx,
  entrada: { plan_code: string; origin: OrigemDaAssinatura; status: "active" | "pending_payment" },
  deps: Deps = {},
): Promise<Assinatura> {
  return withTenant(ctx, (db) => criarAssinaturaEm(db, ctx, entrada, deps), deps);
}

async function faturaAbertaEm(db: TenantDb, ctx: TenantCtx, subscriptionId: string): Promise<Fatura | null> {
  const faturas = await listarFaturasEm(db, ctx);
  return faturas.find((f) => f.status === "open") ?? null;
}

async function abrirFaturaEm(
  db: TenantDb,
  ctx: TenantCtx,
  assinatura: Assinatura,
  plano: Plano,
  inicio: Date,
): Promise<Fatura> {
  const fim = new Date(inicio.getTime() + plano.period_days * 86_400_000);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.invoices
       (organization_id, subscription_id, plan_code, period_start, period_end, amount_cents, currency, status, due_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'open', $4)
     returning id`,
    [ctx.organization_id, assinatura.id, plano.code, inicio, fim, plano.price_cents, plano.currency],
  );
  const id = rows[0]!.id;
  return {
    id,
    plan_code: plano.code,
    period_start: inicio.toISOString(),
    period_end: fim.toISOString(),
    amount_cents: plano.price_cents,
    currency: plano.currency,
    status: "open",
    due_at: inicio.toISOString(),
    paid_at: null,
    gateway_ref: null,
  };
}

/**
 * Contratação (F12-T03): garante uma assinatura que ESPERA pagamento no plano
 * pedido e uma fatura aberta para o gateway cobrar. Sem assinatura → nasce
 * `pending_payment` de origem `self_service`; `cancelled` → volta a
 * `pending_payment` (mesma linha, novo ciclo); `pending_payment` → troca o
 * plano; `past_due`/`blocked` → a fatura aberta é a que o pagamento vai quitar.
 * `active` → não há o que contratar (mudança de plano é `mudarPlano`).
 */
export async function iniciarCheckout(
  ctx: TenantCtx,
  entrada: { plan_code: string },
  deps: Deps = {},
): Promise<{ assinatura: Assinatura; fatura: Fatura }> {
  return withTenant(
    ctx,
    async (db) => {
      const plano = await obterPlano(entrada.plan_code, { pool: deps.pool });
      const agora = agoraDe(deps);
      let assinatura = await lerAssinaturaEm(db, ctx);
      if (assinatura === null) {
        assinatura = await criarAssinaturaEm(db, ctx, { plan_code: plano.code, origin: "self_service", status: "pending_payment" }, deps);
      } else if (assinatura.status === "cancelled") {
        const para = transicao("cancelled", "checkout");
        if (para === null) throw new TransicaoIlegal("cancelled", "checkout");
        const { rows } = await db.query<Record<string, unknown>>(
          `update public.subscriptions set status = $3, plan_code = $4, cancelled_at = null, cancel_reason = null
            where id = $1 and organization_id = $2 returning ${COLUNAS}`,
          [assinatura.id, ctx.organization_id, para, plano.code],
        );
        assinatura = normalizar(rows[0]!);
      } else if (assinatura.status === "pending_payment") {
        const { rows } = await db.query<Record<string, unknown>>(
          `update public.subscriptions set plan_code = $3 where id = $1 and organization_id = $2 returning ${COLUNAS}`,
          [assinatura.id, ctx.organization_id, plano.code],
        );
        assinatura = normalizar(rows[0]!);
      } else if (assinatura.status === "active") {
        throw new TransicaoIlegal("active", "checkout");
      }
      const fatura = (await faturaAbertaEm(db, ctx, assinatura.id)) ?? (await abrirFaturaEm(db, ctx, assinatura, plano, agora));
      incrementCounter("billing_checkout_started", { plan: plano.code, status: assinatura.status });
      return { assinatura, fatura };
    },
    deps,
  );
}

export interface EventoDoGateway {
  readonly gateway: "mock" | "stripe";
  readonly event_ref: string;
  readonly event_type: TipoDeEventoDoGateway;
  readonly occurred_at: string;
  readonly amount_cents?: number | null;
  readonly payload?: Readonly<Record<string, unknown>>;
  /**
   * F19 (ADR-042 §2): referências ESTÁVEIS do provedor. No mock não existem e
   * `gateway_ref` recebe o `event_ref` (comportamento da F12); no Stripe
   * `subscription_ref` é o `sub_…` (é por ele que o webhook seguinte acha a
   * organização) e o `event_ref` é só o id do evento.
   */
  readonly subscription_ref?: string | null;
  /**
   * F19: a referência ESTÁVEL da fatura no provedor (`in_…`). Dois eventos do
   * mesmo ciclo (checkout.session.completed e invoice.paid) apontam para a
   * mesma fatura do CRM; sem ela (mock) a fatura recebe o `event_ref`.
   */
  readonly invoice_ref?: string | null;
  readonly customer_ref?: string | null;
  /** ISO; só quando o provedor diz `trialing` (D57 c). `null` apaga. */
  readonly trial_ends_at?: string | null;
  /** O `livemode` do evento do Stripe; o mock não manda. */
  readonly livemode?: boolean | null;
}

export type DesfechoDoEvento =
  | { readonly applied: true; readonly assinatura: Assinatura }
  | { readonly applied: false; readonly ignored_reason: "duplicate" | "out_of_order" | "unknown_subscription" | "no_transition"; readonly assinatura: Assinatura | null };

async function avisar(
  db: TenantDb,
  ctx: TenantCtx,
  evento: "subscription.payment_failed" | "subscription.blocked" | "subscription.activated",
  payload: Readonly<Record<string, unknown>>,
): Promise<number> {
  const admins = await membrosPorPapel(db, ctx, ["tenant_admin"]);
  const r = await notify(db, ctx, evento, admins, payload);
  return r.count;
}

/**
 * Aplica UM evento do gateway (F12-T03/T06). Ver o cabeçalho para duplicado,
 * fora de ordem e sem transição. `payment_confirmed` ativa e quita a fatura
 * aberta (ou abre uma já paga, quando é renovação sem fatura); `payment_failed`
 * abre a carência (D44) e avisa o `tenant_admin`.
 */
export async function aplicarEventoDoGateway(
  ctx: TenantCtx,
  evento: EventoDoGateway,
  deps: Deps = {},
): Promise<DesfechoDoEvento> {
  return withTenant(
    ctx,
    async (db) => {
      const ocorrido = new Date(evento.occurred_at);
      if (Number.isNaN(ocorrido.getTime())) throw new Error("occurred_at inválido");
      const assinatura = await lerAssinaturaEm(db, ctx);
      const gravado = await db.query<{ id: string }>(
        `insert into public.billing_events
           (organization_id, subscription_id, gateway, event_ref, event_type, amount_cents, occurred_at, payload, livemode)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
         on conflict (gateway, event_ref) do nothing
         returning id`,
        [
          ctx.organization_id, assinatura?.id ?? null, evento.gateway, evento.event_ref, evento.event_type,
          evento.amount_cents ?? null, ocorrido, JSON.stringify(evento.payload ?? {}), evento.livemode ?? null,
        ],
      );
      const eventoId = gravado.rows[0]?.id;
      if (eventoId === undefined) {
        incrementCounter("billing_event_duplicate", { type: evento.event_type });
        return { applied: false, ignored_reason: "duplicate", assinatura };
      }
      const ignorar = async (motivo: "out_of_order" | "unknown_subscription" | "no_transition"): Promise<DesfechoDoEvento> => {
        await db.query(`update public.billing_events set ignored_reason = $3 where id = $1 and organization_id = $2`, [eventoId, ctx.organization_id, motivo]);
        incrementCounter("billing_event_ignored", { type: evento.event_type, reason: motivo });
        return { applied: false, ignored_reason: motivo, assinatura };
      };
      if (assinatura === null) return ignorar("unknown_subscription");
      if (assinatura.last_event_at !== null && ocorrido.getTime() < new Date(assinatura.last_event_at).getTime()) {
        return ignorar("out_of_order");
      }
      const para = transicao(assinatura.status, evento.event_type);
      if (para === null) return ignorar("no_transition");

      const plano = await obterPlano(assinatura.plan_code, { pool: deps.pool });
      let atualizada: Assinatura;
      if (evento.event_type === "payment_confirmed") {
        const fim = new Date(ocorrido.getTime() + plano.period_days * 86_400_000);
        // Referência estável do provedor quando ele a tem (Stripe: sub_…);
        // senão o id do evento, como na F12. `customer_ref` só se o evento
        // trouxer (coalesce mantém o que já estava). `trial_ends_at`: o
        // provedor manda a data enquanto está em teste e `null` ao sair dele.
        const { rows } = await db.query<Record<string, unknown>>(
          `update public.subscriptions
              set status = $3, gateway = $4, gateway_ref = $5,
                  current_period_start = $6, current_period_end = $7,
                  failed_at = null, grace_until = null, blocked_at = null, last_event_at = $6,
                  customer_ref = coalesce($8, customer_ref),
                  trial_ends_at = case when $9::boolean then $10::timestamptz else trial_ends_at end
            where id = $1 and organization_id = $2 returning ${COLUNAS}`,
          [
            assinatura.id, ctx.organization_id, para, evento.gateway, evento.subscription_ref ?? evento.event_ref, ocorrido, fim,
            evento.customer_ref ?? null, evento.trial_ends_at !== undefined, evento.trial_ends_at ?? null,
          ],
        );
        atualizada = normalizar(rows[0]!);
        const refDaFatura = evento.invoice_ref ?? evento.event_ref;
        const aberta = await faturaAbertaEm(db, ctx, assinatura.id);
        const jaPaga = await db.query<{ id: string }>(
          `select id from public.invoices where organization_id = $1 and subscription_id = $2 and gateway_ref = $3 and status = 'paid'`,
          [ctx.organization_id, assinatura.id, refDaFatura],
        );
        if (aberta !== null) {
          await db.query(
            `update public.invoices set status = 'paid', paid_at = $3, gateway_ref = $4
              where id = $1 and organization_id = $2`,
            [aberta.id, ctx.organization_id, ocorrido, refDaFatura],
          );
        } else if (jaPaga.rows.length === 0) {
          // Renovação sem fatura aberta: abre uma já paga — UMA por fatura do
          // provedor (o segundo evento do mesmo ciclo não duplica).
          await db.query(
            `insert into public.invoices
               (organization_id, subscription_id, plan_code, period_start, period_end, amount_cents, currency, status, due_at, paid_at, gateway_ref)
             values ($1, $2, $3, $4, $5, $6, $7, 'paid', $4, $4, $8)`,
            [ctx.organization_id, assinatura.id, plano.code, ocorrido, fim, plano.price_cents, plano.currency, refDaFatura],
          );
        }
        // F19: renovação (active → active) não é ativação — o Stripe manda
        // `invoice.paid` a cada ciclo, e avisar "ativada" a cada mês seria ruído
        // que esconde a ativação de verdade (pending/past_due/blocked → active).
        if (assinatura.status !== "active") {
          await avisar(db, ctx, "subscription.activated", { plan_code: plano.code, current_period_end: fim.toISOString() });
        }
      } else if (evento.event_type === "cancelled") {
        // F19 (ADR-042 §2, D44): o gateway avisa que a assinatura acabou no
        // Portal — mesmo desfecho do `cancelar()` humano: dados preservados,
        // acesso `billing_only`. O motivo nomeia a origem, nunca texto do
        // provedor.
        const { rows } = await db.query<Record<string, unknown>>(
          `update public.subscriptions
              set status = $3, cancelled_at = $4, cancel_reason = $5, last_event_at = $4
            where id = $1 and organization_id = $2 returning ${COLUNAS}`,
          [assinatura.id, ctx.organization_id, para, ocorrido, `cancelado no gateway ${evento.gateway}`],
        );
        atualizada = normalizar(rows[0]!);
        incrementCounter("billing_subscription_cancelled", { from: assinatura.status });
      } else {
        const carencia = await diasDeCarencia(deps);
        const graceUntil = new Date(ocorrido.getTime() + carencia * 86_400_000);
        const { rows } = await db.query<Record<string, unknown>>(
          `update public.subscriptions
              set status = $3, failed_at = $4, grace_until = $5, last_event_at = $4
            where id = $1 and organization_id = $2 returning ${COLUNAS}`,
          [assinatura.id, ctx.organization_id, para, ocorrido, graceUntil],
        );
        atualizada = normalizar(rows[0]!);
        await avisar(db, ctx, "subscription.payment_failed", { grace_until: graceUntil.toISOString(), grace_days: carencia });
      }
      await db.query(`update public.billing_events set applied = true, subscription_id = $3 where id = $1 and organization_id = $2`, [eventoId, ctx.organization_id, assinatura.id]);
      incrementCounter("billing_event_applied", { type: evento.event_type, to: para });
      return { applied: true, assinatura: atualizada };
    },
    deps,
  );
}

/**
 * Varredura da carência (F12-T06, D44): `past_due` com `grace_until` vencido
 * vira `blocked` — escrita nova negada, dados e cobrança preservados — e o
 * `tenant_admin` é avisado. Idempotente: rodar de novo bloqueia 0.
 */
export async function varrerCarencia(ctx: TenantCtx, deps: Deps = {}): Promise<{ blocked: number; notified: number }> {
  return withTenant(
    ctx,
    async (db) => {
      const agora = agoraDe(deps);
      const assinatura = await lerAssinaturaEm(db, ctx);
      if (assinatura === null || assinatura.status !== "past_due" || assinatura.grace_until === null) return { blocked: 0, notified: 0 };
      if (new Date(assinatura.grace_until).getTime() > agora.getTime()) return { blocked: 0, notified: 0 };
      const para = transicao("past_due", "grace_expired");
      if (para === null) throw new TransicaoIlegal("past_due", "grace_expired");
      await db.query(
        `update public.subscriptions set status = $3, blocked_at = $4 where id = $1 and organization_id = $2`,
        [assinatura.id, ctx.organization_id, para, agora],
      );
      const notified = await avisar(db, ctx, "subscription.blocked", { blocked_at: agora.toISOString() });
      incrementCounter("billing_subscription_blocked");
      return { blocked: 1, notified };
    },
    deps,
  );
}

/**
 * Mudança de plano (F12-T05): imediata, sem pro-rata — DEFAULT DECLARADO
 * (ADR-030 §3), não decisão comercial. Só em `active`: quem deve, paga primeiro.
 */
export async function mudarPlano(ctx: TenantCtx, entrada: { plan_code: string }, deps: Deps = {}): Promise<Assinatura> {
  return withTenant(
    ctx,
    async (db) => {
      const assinatura = await lerAssinaturaEm(db, ctx);
      if (assinatura === null) throw new TransicaoIlegal("none", "plan_change");
      if (assinatura.gateway === "stripe") throw new UsePortal("plan_change");
      if (assinatura.status !== "active") throw new TransicaoIlegal(assinatura.status, "plan_change");
      const plano = await obterPlano(entrada.plan_code, { pool: deps.pool });
      const { rows } = await db.query<Record<string, unknown>>(
        `update public.subscriptions set plan_code = $3 where id = $1 and organization_id = $2 returning ${COLUNAS}`,
        [assinatura.id, ctx.organization_id, plano.code],
      );
      incrementCounter("billing_plan_changed", { from: assinatura.plan_code, to: plano.code });
      return normalizar(rows[0]!);
    },
    deps,
  );
}

/** Cancelamento pelo `tenant_admin` (F12-T05): estado muda, dado fica. */
export async function cancelar(ctx: TenantCtx, entrada: { reason: string }, deps: Deps = {}): Promise<Assinatura> {
  return withTenant(
    ctx,
    async (db) => {
      const assinatura = await lerAssinaturaEm(db, ctx);
      if (assinatura === null) throw new TransicaoIlegal("none", "cancelled");
      if (assinatura.gateway === "stripe") throw new UsePortal("cancel");
      const para = transicao(assinatura.status, "cancelled");
      if (para === null) throw new TransicaoIlegal(assinatura.status, "cancelled");
      const { rows } = await db.query<Record<string, unknown>>(
        `update public.subscriptions set status = $3, cancelled_at = $4, cancel_reason = $5
          where id = $1 and organization_id = $2 returning ${COLUNAS}`,
        [assinatura.id, ctx.organization_id, para, agoraDe(deps), entrada.reason.slice(0, 500)],
      );
      incrementCounter("billing_subscription_cancelled", { from: assinatura.status });
      return normalizar(rows[0]!);
    },
    deps,
  );
}
