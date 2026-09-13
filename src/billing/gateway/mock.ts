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

import { z } from "zod";

import { TIPOS_DE_EVENTO_DO_GATEWAY, type TipoDeEventoDoGateway } from "../estados";

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

const corpoDoEventoSchema = z.object({
  organization_id: z.string().uuid(),
  event_ref: z.string().min(1).max(128),
  event_type: z.enum(TIPOS_DE_EVENTO_DO_GATEWAY),
  occurred_at: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), "occurred_at inválido"),
  amount_cents: z.number().int().min(0).nullable().optional(),
  checkout_ref: z.string().uuid().optional(),
});

/** Lê o corpo do webhook por schema (allowlist de campos, G-42): nada mais entra. */
export function lerCorpoDoEventoMock(bruto: unknown): CorpoDoEventoMock | null {
  const lido = corpoDoEventoSchema.safeParse(bruto);
  if (!lido.success) return null;
  const { organization_id, event_ref, event_type, occurred_at, amount_cents, checkout_ref } = lido.data;
  return {
    organization_id,
    event_ref,
    event_type,
    occurred_at,
    amount_cents: amount_cents ?? null,
    ...(checkout_ref !== undefined ? { checkout_ref } : {}),
  };
}
