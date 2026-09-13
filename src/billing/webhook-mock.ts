/**
 * O RECEPTOR do webhook do gateway mock (F12-T03) — a função que a rota
 * `POST /api/v1/billing/webhooks/mock` chama e que a página de checkout mock
 * também chama, pelo servidor, para "entregar" o evento. Um receptor só: o
 * caminho que o gateway real percorreria é o mesmo que o mock percorre.
 *
 * Ordem: segredo presente (503 se não, G-27) → assinatura confere (401) →
 * corpo pela allowlist (422) → `aplicarEventoDoGateway` na organização que o
 * corpo nomeia (D20: o tenant vem do evento verificado, nunca de sessão) →
 * 200 com o desfecho (`applied`/`ignored_reason`). Duplicata e fora de ordem
 * são 200 de propósito: o gateway não deve reentregar o que já foi visto.
 */
import { incrementCounter } from "@/src/obs/counters";
import type { ServicePool } from "@/src/tenant-context/db";
import type { TenantCtx } from "@/src/tenant-context";

import { aplicarEventoDoGateway, type DesfechoDoEvento } from "./assinatura";
import { assinaturaConfere, lerCorpoDoEventoMock } from "./gateway/mock";

export type RespostaDoReceptor =
  | { readonly status: 503; readonly code: "upstream_unavailable" }
  | { readonly status: 401; readonly code: "invalid_signature" }
  | { readonly status: 422; readonly code: "validation_failed" }
  | { readonly status: 200; readonly code: "ok"; readonly organization_id: string; readonly desfecho: DesfechoDoEvento };

interface Deps {
  pool?: ServicePool;
  graceDays?: number;
  secret?: string;
}

async function segredo(deps: Deps): Promise<string> {
  if (typeof deps.secret === "string") return deps.secret;
  const { env } = await import("@/lib/env");
  return env.BILLING_MOCK_WEBHOOK_SECRET;
}

export async function receberEventoMock(
  body: string,
  signature: string | null,
  deps: Deps = {},
): Promise<RespostaDoReceptor> {
  const secret = await segredo(deps);
  if (secret.length === 0) {
    incrementCounter("billing_webhook_rejected", { reason: "no_secret" });
    return { status: 503, code: "upstream_unavailable" };
  }
  if (!assinaturaConfere(body, signature, secret)) {
    incrementCounter("billing_webhook_rejected", { reason: "signature" });
    return { status: 401, code: "invalid_signature" };
  }
  let bruto: unknown;
  try {
    bruto = JSON.parse(body);
  } catch {
    bruto = null;
  }
  const corpo = lerCorpoDoEventoMock(bruto);
  if (corpo === null) {
    incrementCounter("billing_webhook_rejected", { reason: "schema" });
    return { status: 422, code: "validation_failed" };
  }
  const ctx: TenantCtx = { organization_id: corpo.organization_id, source: "webhook" };
  const desfecho = await aplicarEventoDoGateway(
    ctx,
    {
      gateway: "mock",
      event_ref: corpo.event_ref,
      event_type: corpo.event_type,
      occurred_at: corpo.occurred_at,
      amount_cents: corpo.amount_cents ?? null,
      payload: corpo.checkout_ref ? { checkout_ref: corpo.checkout_ref } : {},
    },
    { pool: deps.pool, graceDays: deps.graceDays },
  );
  return { status: 200, code: "ok", organization_id: corpo.organization_id, desfecho };
}
