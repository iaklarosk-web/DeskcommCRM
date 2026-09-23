/**
 * O padrão KN do `/admin` sobre a assinatura de uma empresa (F19-T04,
 * ADR-042 §5; DF-33 do OS-Template): **suspender**, **reativar**, **estender
 * trial**, **provisionar na mão** e **abrir no Stripe** — as cinco ações que o
 * dono da plataforma tem sem sair do produto. Reembolso, estorno e troca de
 * plano ficam no Dashboard e no Portal do Stripe.
 *
 * Duas verdades, sempre nesta ordem: primeiro o PROVEDOR (quando a assinatura
 * é `stripe`), depois o banco. Se o Stripe recusar, nada muda aqui — e a
 * exceção sobe com o status dele. Organização `mock`/`operator` só muda no
 * banco. Cada ação é auditada pela rota (`billing.admin.*`).
 *
 * `provisionar na mão` é a única que cria: assinatura `operator` ativa no
 * plano pedido, ou reativa a existente — é como as organizações de origem `operator` vivem
 * na produção (D53), sem cliente no Stripe.
 */
import { incrementCounter } from "@/src/obs/counters";
import type { ServicePool } from "@/src/tenant-context/db";
import type { TenantCtx } from "@/src/tenant-context";

import { aplicarEventoDoGateway, criarAssinatura, lerAssinatura, lerAssinaturaEm, TransicaoIlegal, type Assinatura } from "./assinatura";
import { transicao } from "./estados";
import { estenderTrial as estenderTrialNoStripe, linkDoDashboard, pausarCobranca, type ConfigDoCliente } from "./gateway/stripe";
import { obterPlano } from "./planos";

export interface DepsDoAdmin {
  pool?: ServicePool;
  /** O cliente do Stripe; `null` = instalação sem Stripe (só o banco muda). */
  stripe?: ConfigDoCliente | null;
  agora?: () => Date;
}

const MIN_DIAS_DE_TRIAL = 1;
const MAX_DIAS_DE_TRIAL = 90;

function ctxDe(organizationId: string): TenantCtx {
  return { organization_id: organizationId, source: "job" };
}

async function stripeSeHouver(assinatura: Assinatura, deps: DepsDoAdmin): Promise<ConfigDoCliente | null> {
  if (assinatura.gateway !== "stripe" || assinatura.gateway_ref === null) return null;
  if (deps.stripe === undefined) {
    const { env } = await import("@/lib/env");
    return { base: env.STRIPE_API_BASE, chave: env.STRIPE_SECRET_KEY };
  }
  return deps.stripe;
}

async function mudarEstado(pool: ServicePool | undefined, assinatura: Assinatura, evento: "admin_suspended" | "admin_resumed", agora: Date): Promise<Assinatura> {
  const para = transicao(assinatura.status, evento);
  if (para === null) throw new TransicaoIlegal(assinatura.status, evento);
  const { withTenant } = await import("@/src/tenant-context");
  return withTenant(
    ctxDe(assinatura.organization_id),
    async (db) => {
      const { rows } = await db.query<Record<string, unknown>>(
        para === "blocked"
          ? `update public.subscriptions set status = 'blocked', blocked_at = $3 where id = $1 and organization_id = $2 returning id`
          : `update public.subscriptions set status = 'active', blocked_at = null, failed_at = null, grace_until = null where id = $1 and organization_id = $2 returning id`,
        para === "blocked" ? [assinatura.id, assinatura.organization_id, agora] : [assinatura.id, assinatura.organization_id],
      );
      if (rows.length !== 1) throw new Error("assinatura não atualizada");
      // Reler pela MESMA conexão: a transação de withTenant ainda não commitou.
      const lida = await lerAssinaturaEm(db, ctxDe(assinatura.organization_id));
      if (lida === null) throw new Error("assinatura sumiu");
      return lida;
    },
    { pool },
  );
}

/** 1 · Suspender: `pause_collection` no Stripe (se houver) e `blocked` no banco. */
export async function suspender(organizationId: string, deps: DepsDoAdmin = {}): Promise<Assinatura> {
  const assinatura = await lerAssinatura(ctxDe(organizationId), { pool: deps.pool });
  if (assinatura === null) throw new TransicaoIlegal("none", "admin_suspended");
  const stripe = await stripeSeHouver(assinatura, deps);
  if (stripe !== null) await pausarCobranca(stripe, assinatura.gateway_ref!, true);
  const atualizada = await mudarEstado(deps.pool, assinatura, "admin_suspended", (deps.agora ?? (() => new Date()))());
  incrementCounter("billing_admin_action", { action: "suspend", gateway: assinatura.gateway ?? "none" });
  return atualizada;
}

/** 2 · Reativar: limpa o `pause_collection` no Stripe (se houver) e volta a `active`. */
export async function reativar(organizationId: string, deps: DepsDoAdmin = {}): Promise<Assinatura> {
  const assinatura = await lerAssinatura(ctxDe(organizationId), { pool: deps.pool });
  if (assinatura === null) throw new TransicaoIlegal("none", "admin_resumed");
  const stripe = await stripeSeHouver(assinatura, deps);
  if (stripe !== null) await pausarCobranca(stripe, assinatura.gateway_ref!, false);
  const atualizada = await mudarEstado(deps.pool, assinatura, "admin_resumed", (deps.agora ?? (() => new Date()))());
  incrementCounter("billing_admin_action", { action: "resume", gateway: assinatura.gateway ?? "none" });
  return atualizada;
}

export class DiasForaDaFaixa extends Error {
  constructor(public readonly dias: number) {
    super(`dias de trial fora de ${MIN_DIAS_DE_TRIAL}..${MAX_DIAS_DE_TRIAL}: ${dias}`);
    this.name = "DiasForaDaFaixa";
  }
}

/** 3 · Estender o trial em N dias (1..90) a partir de agora — no Stripe (se houver) e em `trial_ends_at`. */
export async function estenderTrial(organizationId: string, dias: number, deps: DepsDoAdmin = {}): Promise<Assinatura> {
  if (!Number.isInteger(dias) || dias < MIN_DIAS_DE_TRIAL || dias > MAX_DIAS_DE_TRIAL) throw new DiasForaDaFaixa(dias);
  const assinatura = await lerAssinatura(ctxDe(organizationId), { pool: deps.pool });
  if (assinatura === null) throw new TransicaoIlegal("none", "trial_extended");
  const agora = (deps.agora ?? (() => new Date()))();
  const fim = new Date(agora.getTime() + dias * 86_400_000);
  const stripe = await stripeSeHouver(assinatura, deps);
  if (stripe !== null) await estenderTrialNoStripe(stripe, assinatura.gateway_ref!, Math.floor(fim.getTime() / 1000));
  const { withTenant } = await import("@/src/tenant-context");
  const atualizada = await withTenant(
    ctxDe(organizationId),
    async (db) => {
      await db.query(`update public.subscriptions set trial_ends_at = $3 where id = $1 and organization_id = $2`, [assinatura.id, organizationId, fim]);
      const lida = await lerAssinaturaEm(db, ctxDe(organizationId));
      if (lida === null) throw new Error("assinatura sumiu");
      return lida;
    },
    { pool: deps.pool },
  );
  incrementCounter("billing_admin_action", { action: "extend_trial", gateway: assinatura.gateway ?? "none" });
  return atualizada;
}

/**
 * 4 · Provisionar na mão: assinatura `operator` ATIVA no plano pedido, sem
 * cliente no Stripe. Cria quando não há; quando há, aplica um
 * `payment_confirmed` de origem `operator` (é assim que reativa a
 * `pending_payment`/`past_due`/`blocked` sem inventar estado).
 */
export async function provisionarNaMao(organizationId: string, planCode: string, deps: DepsDoAdmin = {}): Promise<Assinatura> {
  const plano = await obterPlano(planCode, { pool: deps.pool });
  const ctx = ctxDe(organizationId);
  const existente = await lerAssinatura(ctx, { pool: deps.pool });
  const agora = (deps.agora ?? (() => new Date()))();
  if (existente === null) {
    const criada = await criarAssinatura(ctx, { plan_code: plano.code, origin: "operator", status: "active" }, { pool: deps.pool, agora: () => agora });
    incrementCounter("billing_admin_action", { action: "provision", gateway: "none" });
    return criada;
  }
  if (existente.status === "cancelled") throw new TransicaoIlegal("cancelled", "provision");
  // Assinatura do Stripe não se provisiona na mão: quem manda é o provedor
  // (reativar/estender trial são as ações certas).
  if (existente.gateway === "stripe") throw new TransicaoIlegal(existente.status, "provision");
  const r = await aplicarEventoDoGateway(
    ctx,
    { gateway: "mock", event_ref: `operator:${organizationId}:${agora.toISOString()}`, event_type: "payment_confirmed", occurred_at: agora.toISOString(), payload: { origin: "operator" } },
    { pool: deps.pool, agora: () => agora },
  );
  if (!r.applied) throw new TransicaoIlegal(existente.status, "provision");
  if (existente.plan_code !== plano.code) {
    const { withTenant } = await import("@/src/tenant-context");
    await withTenant(ctx, async (db) => db.query(`update public.subscriptions set plan_code = $3 where id = $1 and organization_id = $2`, [existente.id, organizationId, plano.code]), { pool: deps.pool });
  }
  incrementCounter("billing_admin_action", { action: "provision", gateway: existente.gateway ?? "none" });
  const lida = await lerAssinatura(ctx, { pool: deps.pool });
  if (lida === null) throw new Error("assinatura sumiu");
  return lida;
}

/** 5 · Abrir no Stripe: o link do Dashboard, só para assinatura `stripe` (null nas demais). */
export function linkNoStripe(assinatura: Pick<Assinatura, "gateway" | "gateway_ref">, modo: "test" | "live"): string | null {
  if (assinatura.gateway !== "stripe" || assinatura.gateway_ref === null) return null;
  return linkDoDashboard(modo, assinatura.gateway_ref);
}

export const ACOES_DO_ADMIN = ["suspend", "resume", "extend_trial", "provision", "open_in_stripe"] as const;
export type AcaoDoAdmin = (typeof ACOES_DO_ADMIN)[number];
