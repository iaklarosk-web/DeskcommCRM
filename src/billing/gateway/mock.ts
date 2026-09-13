/**
 * O gateway MOCK (F12-T03, D11/D51: sem provedor real, sem gasto).
 *
 * Tem a MESMA forma que um gateway real teria — checkout com referência,
 * webhook assinado, evento com referência única e instante de ocorrência —
 * para que o adaptador real da F08+ seja uma classe nova, não um redesenho.
 * A "página de pagamento" é `/app/billing/mock-checkout/[ref]`, que, pelo
 * servidor, assina e entrega ao webhook o evento que o gateway entregaria.
 * A confirmação CONFIÁVEL de D38 é o webhook, nunca o retorno do navegador.
 *
 * Assinatura: HMAC-SHA256 do corpo com `BILLING_MOCK_WEBHOOK_SECRET`, hex, no
 * cabeçalho `x-mock-gateway-signature`. Segredo vazio = webhook responde 503
 * (fail closed, G-27) — nunca "aceita sem assinar".
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { ehTipoDeEventoDoGateway, type TipoDeEventoDoGateway } from "../estados";

export const CABECALHO_DA_ASSINATURA = "x-mock-gateway-signature";
export const GATEWAY_MOCK = "mock" as const;

export interface CheckoutMock {
  readonly gateway: typeof GATEWAY_MOCK;
  /** A referência do checkout é o id da fatura aberta — é o que o pagamento quita. */
  readonly checkout_ref: string;
  readonly url: string;
}

export function criarCheckoutMock(faturaId: string): CheckoutMock {
  return { gateway: GATEWAY_MOCK, checkout_ref: faturaId, url: `/app/billing/mock-checkout/${faturaId}` };
}

export interface EventoAssinado {
  readonly body: string;
  readonly signature: string;
}

export interface CorpoDoEventoMock {
  readonly organization_id: string;
  readonly event_ref: string;
  readonly event_type: TipoDeEventoDoGateway;
  readonly occurred_at: string;
  readonly amount_cents?: number | null;
  readonly checkout_ref?: string;
}

export function assinar(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export function assinaturaConfere(body: string, signature: string | null, secret: string): boolean {
  if (!signature || secret.length === 0) return false;
  const esperada = Buffer.from(assinar(body, secret), "hex");
  let dada: Buffer;
  try {
    dada = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  return dada.length === esperada.length && timingSafeEqual(dada, esperada);
}

/** Monta e assina o evento que o gateway mock "entrega" ao webhook. */
export function emitirEventoMock(corpo: CorpoDoEventoMock, secret: string): EventoAssinado {
  const body = JSON.stringify(corpo);
  return { body, signature: assinar(body, secret) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lê o corpo do webhook: allowlist de campos (G-42), nada mais entra. */
export function lerCorpoDoEventoMock(bruto: unknown): CorpoDoEventoMock | null {
  if (typeof bruto !== "object" || bruto === null) return null;
  const o = bruto as Record<string, unknown>;
  if (typeof o.organization_id !== "string" || !UUID.test(o.organization_id)) return null;
  if (typeof o.event_ref !== "string" || o.event_ref.length < 1 || o.event_ref.length > 128) return null;
  if (!ehTipoDeEventoDoGateway(o.event_type)) return null;
  if (typeof o.occurred_at !== "string" || Number.isNaN(new Date(o.occurred_at).getTime())) return null;
  const amount = o.amount_cents;
  if (amount !== undefined && amount !== null && !(typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0)) return null;
  const checkout = o.checkout_ref;
  if (checkout !== undefined && (typeof checkout !== "string" || !UUID.test(checkout))) return null;
  return {
    organization_id: o.organization_id,
    event_ref: o.event_ref,
    event_type: o.event_type,
    occurred_at: o.occurred_at,
    amount_cents: amount === undefined ? null : (amount as number | null),
    ...(typeof checkout === "string" ? { checkout_ref: checkout } : {}),
  };
}
