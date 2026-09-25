/**
 * `POST /api/v1/webhooks/stripe` (F19-T02, ADR-042 §2) — o webhook do gateway
 * REAL. Sem sessão: a autoridade é a assinatura `Stripe-Signature`, e o
 * tenant vem do que o banco sabe da assinatura (`client_reference_id` do
 * checkout ou `subscriptions.gateway_ref`), nunca só do payload (D20). Ordem
 * das recusas em `src/billing/webhook-stripe.ts`. Mora em `/api/v1/webhooks/*`
 * como os outros: público por desenho (`lib/auth/public-paths.ts`) e fora da
 * guarda de suporte. Com `BILLING_GATEWAY=mock` (produção nesta fase, D57 f)
 * o segredo está vazio e a rota responde 503 — nunca 200 sem assinatura.
 */
import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { CABECALHO_DA_ASSINATURA_STRIPE, receberEventoStripe } from "@/src/billing/webhook-stripe";
import { registrarRequisicao } from "@/src/obs/log";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const body = await req.text();
  const resposta = await receberEventoStripe(body, req.headers.get(CABECALHO_DA_ASSINATURA_STRIPE));
  const organizationId = resposta.status === 200 ? resposta.organization_id : null;
  registrarRequisicao({
    request_id: requestId,
    organization_id: organizationId,
    ...(organizationId === null ? { scope: "unresolved" as const } : {}),
    outcome: resposta.status === 200 ? "accepted" : "rejected",
    path: "/api/v1/webhooks/stripe",
    method: "POST",
    status: resposta.status,
  });
  switch (resposta.status) {
    case 503:
      return fail("upstream_unavailable", "Webhook do Stripe não configurado nesta instalação.", 503, { requestId });
    case 502:
      return fail("upstream_unavailable", "O Stripe não respondeu à leitura da assinatura; reenvie.", 502, { requestId });
    case 401:
      return fail("invalid_signature", "Assinatura do webhook inválida.", 401, { requestId });
    case 422:
      return fail(
        "validation_failed",
        resposta.code === "livemode_mismatch"
          ? "Evento de outro modo (live/test) — recusado."
          : resposta.code === "price_outside_list"
            ? "Preço fora de STRIPE_PRICE_IDS — recusado sem gravar."
            : "Evento fora do contrato.",
        422,
        { requestId },
      );
    default:
      return ok(
        resposta.code === "ignored"
          ? { applied: false, ignored_reason: resposta.motivo }
          : resposta.desfecho.applied
            ? { applied: true, status: resposta.desfecho.assinatura.status, plan_synced: resposta.plano_sincronizado }
            : { applied: false, ignored_reason: resposta.desfecho.ignored_reason },
        { requestId },
      );
  }
}
