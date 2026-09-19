/**
 * O RECEPTOR do webhook do Stripe (F19-T02, ADR-042 §2) — a função que a rota
 * `POST /api/v1/webhooks/stripe` chama. Irmão do `webhook-mock.ts`: a mesma
 * ordem de recusas, o mesmo `aplicarEventoDoGateway` no fim. O que o Stripe
 * tem a mais está antes do "aplicar":
 *
 * Ordem: segredo presente (503, G-27) → assinatura confere (401) → corpo na
 * allowlist (422) → `livemode` bate com o modo (422) → tipo tratado (senão 200
 * `ignored`) → organização achada por `client_reference_id` ou por
 * `subscriptions.gateway_ref` (senão 200 `ignored`, D20: o tenant vem do que o
 * banco sabe da assinatura, nunca só do payload) → para checkout e
 * subscription.updated, o ESTADO vem de `GET /v1/subscriptions` (regra 4 do
 * adapter) e o preço tem de estar na lista (422) → `aplicarEventoDoGateway`
 * → 200 com o desfecho. Duplicata e fora de ordem continuam 200: o gateway
 * não deve reentregar o que já foi visto.
 *
 * `customer.subscription.updated` também SINCRONIZA `plan_code` pelo preço:
 * a troca de plano acontece no Customer Portal (D57 b) e chega por aqui.
 */
import { incrementCounter } from "@/src/obs/counters";
import { getServicePool, type ServicePool } from "@/src/tenant-context/db";
import type { TenantCtx } from "@/src/tenant-context";

import { aplicarEventoDoGateway, type DesfechoDoEvento } from "./assinatura";
import type { TipoDeEventoDoGateway } from "./estados";
import {
  assinaturaDoStripeConfere,
  buscarAssinatura,
  CABECALHO_DA_ASSINATURA_STRIPE,
  ehTipoTratado,
  eventoPeloStatus,
  GATEWAY_STRIPE,
  lerEventoDoStripe,
  lerListaDePrecos,
  StripeIndisponivel,
  type AssinaturaDoStripe,
  type ConfigDoCliente,
  type EventoDoStripe,
} from "./gateway/stripe";

export { CABECALHO_DA_ASSINATURA_STRIPE };

export type MotivoDeIgnorar = "unhandled_type" | "unknown_subscription" | "status_nao_move" | "sem_subscription";

export type RespostaDoReceptorStripe =
  | { readonly status: 503; readonly code: "upstream_unavailable" }
  | { readonly status: 401; readonly code: "invalid_signature" }
  | { readonly status: 422; readonly code: "validation_failed" | "livemode_mismatch" | "price_outside_list" }
  | { readonly status: 502; readonly code: "provider_unavailable" }
  | { readonly status: 200; readonly code: "ignored"; readonly organization_id: string | null; readonly motivo: MotivoDeIgnorar }
  | { readonly status: 200; readonly code: "ok"; readonly organization_id: string; readonly desfecho: DesfechoDoEvento; readonly plano_sincronizado: boolean };

export interface DepsDoReceptor {
  pool?: ServicePool;
  graceDays?: number;
  secret?: string;
  modo?: "test" | "live";
  chave?: string;
  base?: string;
  precos?: string;
  agoraUnix?: () => number;
  fetch?: typeof fetch;
}

interface Config {
  secret: string;
  modo: "test" | "live";
  cliente: ConfigDoCliente;
  precos: ReadonlyMap<string, string>;
}

async function configurar(deps: DepsDoReceptor): Promise<Config> {
  const faltaAlgo = [deps.secret, deps.modo, deps.chave, deps.base, deps.precos].some((v) => v === undefined);
  const env = faltaAlgo ? (await import("@/lib/env")).env : null;
  const cliente: ConfigDoCliente = {
    base: deps.base ?? env!.STRIPE_API_BASE,
    chave: deps.chave ?? env!.STRIPE_SECRET_KEY,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  };
  return {
    secret: deps.secret ?? env!.STRIPE_WEBHOOK_SECRET,
    modo: deps.modo ?? env!.STRIPE_MODE,
    cliente,
    precos: lerListaDePrecos(deps.precos ?? env!.STRIPE_PRICE_IDS),
  };
}

function idDe(valor: unknown): string | null {
  if (typeof valor === "string" && valor.length > 0) return valor;
  if (typeof valor === "object" && valor !== null && typeof (valor as { id?: unknown }).id === "string") return (valor as { id: string }).id;
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A organização pela referência do gateway (índice `subscriptions_gateway_ref_idx`, 9033). */
async function organizacaoPelaAssinatura(pool: ServicePool, subscriptionId: string): Promise<{ organization_id: string; plan_code: string } | null> {
  const { rows } = await pool.query<{ organization_id: string; plan_code: string }>(
    `select organization_id, plan_code from public.subscriptions where gateway = $1 and gateway_ref = $2`,
    [GATEWAY_STRIPE, subscriptionId],
  );
  return rows[0] ?? null;
}

interface Alvo {
  organization_id: string;
  subscription_id: string | null;
  customer: string | null;
  /** O plano gravado hoje (para sincronizar em `subscription.updated`). */
  plan_code_atual: string | null;
}

/** De onde vem a organização, por tipo de evento. `null` = não achou. */
async function acharAlvo(pool: ServicePool, evento: EventoDoStripe): Promise<Alvo | null | "sem_subscription"> {
  const o = evento.objeto;
  if (evento.type === "checkout.session.completed") {
    const ref = typeof o.client_reference_id === "string" ? o.client_reference_id : null;
    const subscription = idDe(o.subscription);
    if (ref === null || !UUID.test(ref)) return null;
    if (o.mode !== "subscription" || subscription === null) return "sem_subscription";
    // A organização tem de existir COM assinatura (a contratação da F11/F12
    // criou a linha pending_payment antes do Checkout): referência que não
    // bate no banco é `ignored`, nunca 500 por FK.
    const { rows } = await pool.query<{ plan_code: string }>(`select plan_code from public.subscriptions where organization_id = $1`, [ref]);
    if (rows.length === 0) return null;
    return { organization_id: ref, subscription_id: subscription, customer: idDe(o.customer), plan_code_atual: rows[0]!.plan_code };
  }
  const subscription = evento.type.startsWith("invoice.") ? idDe(o.subscription) : idDe(o.id);
  if (subscription === null) return "sem_subscription";
  const achado = await organizacaoPelaAssinatura(pool, subscription);
  if (achado !== null) return { organization_id: achado.organization_id, subscription_id: subscription, customer: idDe(o.customer), plan_code_atual: achado.plan_code };
  // Última chance, só para eventos da subscription: o metadata que o checkout gravou.
  const meta = o.metadata as { organization_id?: unknown } | undefined;
  if (evento.type.startsWith("customer.subscription.") && typeof meta?.organization_id === "string" && UUID.test(meta.organization_id)) {
    return { organization_id: meta.organization_id, subscription_id: subscription, customer: idDe(o.customer), plan_code_atual: null };
  }
  return null;
}

export async function receberEventoStripe(
  body: string,
  signature: string | null,
  deps: DepsDoReceptor = {},
): Promise<RespostaDoReceptorStripe> {
  const cfg = await configurar(deps);
  if (cfg.secret.length === 0) {
    incrementCounter("billing_webhook_rejected", { reason: "no_secret", gateway: GATEWAY_STRIPE });
    return { status: 503, code: "upstream_unavailable" };
  }
  const agoraUnix = deps.agoraUnix ?? (() => Math.floor(Date.now() / 1000));
  if (!assinaturaDoStripeConfere(body, signature, cfg.secret, agoraUnix())) {
    incrementCounter("billing_webhook_rejected", { reason: "signature", gateway: GATEWAY_STRIPE });
    return { status: 401, code: "invalid_signature" };
  }
  let bruto: unknown;
  try {
    bruto = JSON.parse(body);
  } catch {
    bruto = null;
  }
  const evento = lerEventoDoStripe(bruto);
  if (evento === null) {
    incrementCounter("billing_webhook_rejected", { reason: "schema", gateway: GATEWAY_STRIPE });
    return { status: 422, code: "validation_failed" };
  }
  if (evento.livemode !== (cfg.modo === "live")) { // MUTANT: stripe-livemode
    incrementCounter("billing_webhook_rejected", { reason: "livemode", gateway: GATEWAY_STRIPE });
    return { status: 422, code: "livemode_mismatch" };
  }
  if (!ehTipoTratado(evento.type)) {
    incrementCounter("billing_webhook_ignored", { reason: "unhandled_type", gateway: GATEWAY_STRIPE });
    return { status: 200, code: "ignored", organization_id: null, motivo: "unhandled_type" };
  }
  const pool = deps.pool ?? (await getServicePool());
  const alvo = await acharAlvo(pool, evento);
  if (alvo === null || alvo === "sem_subscription") {
    const motivo: MotivoDeIgnorar = alvo === null ? "unknown_subscription" : "sem_subscription";
    incrementCounter("billing_webhook_ignored", { reason: motivo, gateway: GATEWAY_STRIPE });
    return { status: 200, code: "ignored", organization_id: null, motivo };
  }

  // O estado: do provedor quando o evento é sobre a subscription; do tipo
  // quando é sobre a fatura ou o encerramento.
  let tipo: TipoDeEventoDoGateway | null;
  let noProvedor: AssinaturaDoStripe | null = null;
  let planoPeloPreco: string | null = null;
  if (evento.type === "checkout.session.completed" || evento.type === "customer.subscription.created" || evento.type === "customer.subscription.updated") {
    try {
      noProvedor = await buscarAssinatura(cfg.cliente, alvo.subscription_id!); // MUTANT: stripe-estado-do-provedor
    } catch (erro) {
      incrementCounter("billing_webhook_rejected", { reason: "provider", gateway: GATEWAY_STRIPE });
      const status = erro instanceof StripeIndisponivel && erro.status === 503 ? 503 : 502;
      return status === 503 ? { status: 503, code: "upstream_unavailable" } : { status: 502, code: "provider_unavailable" };
    }
    if (noProvedor.price_id !== null) {
      planoPeloPreco = cfg.precos.get(noProvedor.price_id) ?? null;
      if (planoPeloPreco === null) {
        incrementCounter("billing_webhook_rejected", { reason: "price", gateway: GATEWAY_STRIPE });
        return { status: 422, code: "price_outside_list" };
      }
    }
    tipo = eventoPeloStatus(noProvedor.status);
  } else if (evento.type === "invoice.paid" || evento.type === "invoice.payment_succeeded") {
    tipo = "payment_confirmed";
  } else if (evento.type === "invoice.payment_failed") {
    tipo = "payment_failed";
  } else {
    tipo = "cancelled"; // customer.subscription.deleted
  }
  if (tipo === null) {
    incrementCounter("billing_webhook_ignored", { reason: "status_nao_move", gateway: GATEWAY_STRIPE });
    return { status: 200, code: "ignored", organization_id: alvo.organization_id, motivo: "status_nao_move" };
  }

  const ctx: TenantCtx = { organization_id: alvo.organization_id, source: "webhook" };
  const amount = typeof evento.objeto.amount_paid === "number" ? evento.objeto.amount_paid : null;
  // A fatura do CRM segue a FATURA do Stripe (`in_…`), não o evento: o checkout
  // e o `invoice.paid` do mesmo ciclo apontam para a mesma linha, em qualquer ordem.
  const invoiceRef = evento.type.startsWith("invoice.") ? idDe(evento.objeto.id) : (noProvedor?.latest_invoice ?? null);
  const trialEndsAt =
    noProvedor === null
      ? undefined
      : noProvedor.status === "trialing" && noProvedor.trial_end !== null
        ? new Date(noProvedor.trial_end * 1000).toISOString()
        : null;
  const desfecho = await aplicarEventoDoGateway(
    ctx,
    {
      gateway: GATEWAY_STRIPE,
      event_ref: evento.id,
      event_type: tipo,
      occurred_at: new Date(evento.created * 1000).toISOString(),
      amount_cents: amount,
      // Allowlist (G-42): tipo, ids e status do provedor — nunca o objeto inteiro.
      payload: {
        type: evento.type,
        subscription: alvo.subscription_id,
        customer: alvo.customer ?? noProvedor?.customer ?? null,
        ...(noProvedor ? { provider_status: noProvedor.status, price_id: noProvedor.price_id } : {}),
      },
      subscription_ref: alvo.subscription_id,
      invoice_ref: invoiceRef,
      customer_ref: alvo.customer ?? noProvedor?.customer ?? null,
      ...(trialEndsAt === undefined ? {} : { trial_ends_at: trialEndsAt }),
      livemode: evento.livemode,
    },
    { pool, graceDays: deps.graceDays },
  );

  // D57 b: a troca de plano vem do Portal e chega por subscription.updated.
  // (`customer.subscription.created` entra pelo mesmo caminho do provedor:
  // acha a organização pelo `metadata.organization_id` que o checkout gravou.)
  let planoSincronizado = false;
  if (evento.type === "customer.subscription.updated" && planoPeloPreco !== null && alvo.plan_code_atual !== null && planoPeloPreco !== alvo.plan_code_atual) {
    const r = await pool.query(
      `update public.subscriptions set plan_code = $3 where organization_id = $1 and gateway_ref = $2 and gateway = 'stripe'`,
      [alvo.organization_id, alvo.subscription_id, planoPeloPreco],
    );
    planoSincronizado = (r.rowCount ?? 0) === 1;
    incrementCounter("billing_plan_synced", { from: alvo.plan_code_atual, to: planoPeloPreco });
  }
  return { status: 200, code: "ok", organization_id: alvo.organization_id, desfecho, plano_sincronizado: planoSincronizado };
}
