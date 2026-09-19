/**
 * `POST /api/v1/billing/portal` (F19-T03, ADR-042 §6; D57 b) — a sessão do
 * Customer Portal do Stripe: é LÁ que a organização troca de plano, atualiza o
 * cartão e cancela; as mudanças voltam pelo webhook. Só para assinatura com
 * gateway `stripe` e cliente conhecido (409 nos demais); Stripe fora ou sem
 * chave → 503, nunca um link inventado.
 */
import { getRequestId } from "@/lib/api/request-id";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { requireRole } from "@/lib/auth/require-role";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { lerAssinatura } from "@/src/billing";
import { criarSessaoDoPortal, StripeIndisponivel } from "@/src/billing/gateway/stripe";

import { contextoDeCobranca } from "../_ctx";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  // Acompanhamento (suporte) é só leitura: quem gerencia a assinatura é a empresa.
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = getRequestId(req);
  const authz = await requireRole("admin", { requestId, resource: "billing_portal", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  const ctx = contextoDeCobranca(authz);
  const assinatura = await lerAssinatura(ctx);
  if (assinatura === null || assinatura.gateway !== "stripe" || assinatura.customer_ref === null) {
    return fail("state_conflict", "Esta assinatura não é gerenciada pelo portal do gateway.", 409, { requestId });
  }
  try {
    const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
    const sessao = await criarSessaoDoPortal(
      { base: env.STRIPE_API_BASE, chave: env.STRIPE_SECRET_KEY },
      { customer_ref: assinatura.customer_ref, return_url: `${base}/app/billing`, configuration: env.STRIPE_PORTAL_CONFIGURATION_ID },
    );
    await audit({
      action: "billing.portal_opened",
      actorUserId: authz.user.id,
      organizationId: ctx.organization_id,
      resourceType: "subscription",
      resourceId: assinatura.id,
      requestId,
      metadata: { gateway: "stripe", customer_ref: assinatura.customer_ref },
    });
    return ok({ url: sessao.url }, { requestId });
  } catch (erro) {
    if (erro instanceof StripeIndisponivel) return fail("upstream_unavailable", "O gateway de pagamento não respondeu; tente de novo.", 503, { requestId });
    return fail("internal_error", "Não foi possível abrir o portal.", 500, { requestId });
  }
}
