/**
 * `POST /api/v1/webhooks/billing-mock` (F12-T03) — o webhook do gateway MOCK.
 * Sem sessão: a autoridade é a assinatura HMAC (`x-mock-gateway-signature`),
 * e o tenant vem do corpo verificado (D20, `fromWebhook`-like). Ver
 * `src/billing/webhook-mock.ts` para a ordem das recusas. Mora em
 * `/api/v1/webhooks/*` como os outros webhooks: público por desenho (o
 * gateway não tem cookie — `lib/auth/public-paths.ts`) e fora da guarda de
 * suporte (segredo de máquina, sem sessão).
 */
import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { CABECALHO_DA_ASSINATURA } from "@/src/billing/gateway/mock";
import { receberEventoMock } from "@/src/billing/webhook-mock";
import { registrarRequisicao } from "@/src/obs/log";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const body = await req.text();
  const resposta = await receberEventoMock(body, req.headers.get(CABECALHO_DA_ASSINATURA));
  registrarRequisicao({
    request_id: requestId,
    organization_id: resposta.status === 200 ? resposta.organization_id : null,
    ...(resposta.status === 200 ? {} : { scope: "unresolved" as const }),
    outcome: resposta.status === 200 ? "accepted" : "rejected",
    path: "/api/v1/webhooks/billing-mock",
    method: "POST",
    status: resposta.status,
  });
  switch (resposta.status) {
    case 503:
      return fail("upstream_unavailable", "Webhook do gateway mock não configurado nesta instalação.", 503, { requestId });
    case 401:
      return fail("invalid_signature", "Assinatura do webhook inválida.", 401, { requestId });
    case 422:
      return fail("validation_failed", "Evento fora do contrato.", 422, { requestId });
    default:
      return ok(
        resposta.desfecho.applied
          ? { applied: true, status: resposta.desfecho.assinatura.status }
          : { applied: false, ignored_reason: resposta.desfecho.ignored_reason },
        { requestId },
      );
  }
}
