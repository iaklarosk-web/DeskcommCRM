/**
 * `POST /api/v1/billing/checkout` `{plan_code}` (F12-T03) — contratação: a
 * assinatura passa a esperar pagamento no plano pedido e o gateway (mock)
 * devolve o checkout. O navegador que volta do checkout NÃO ativa nada (D38):
 * quem ativa é o webhook.
 */
import { z } from "zod";

import { getRequestId } from "@/lib/api/request-id";
import { requireRole } from "@/lib/auth/require-role";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { criarCheckoutMock, iniciarCheckout, PlanoDesconhecido, TransicaoIlegal } from "@/src/billing";

import { contextoDeCobranca } from "../_ctx";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({ plan_code: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/) });

export async function POST(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const authz = await requireRole("admin", { requestId, resource: "billing_checkout", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  const auth = { ctx: contextoDeCobranca(authz), user: authz.user };
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", "Informe plan_code.", 422, { requestId });
  try {
    const { assinatura, fatura } = await iniciarCheckout(auth.ctx, { plan_code: corpo.data.plan_code });
    const checkout = criarCheckoutMock(fatura.id);
    await audit({
      action: "billing.checkout_started",
      actorUserId: auth.user.id,
      organizationId: auth.ctx.organization_id,
      resourceType: "subscription",
      resourceId: assinatura.id,
      requestId,
      metadata: { plan_code: assinatura.plan_code, status: assinatura.status, invoice_id: fatura.id, gateway: checkout.gateway },
    });
    return ok({ subscription: assinatura, invoice: fatura, checkout }, { requestId });
  } catch (erro) {
    if (erro instanceof PlanoDesconhecido) return fail("validation_failed", "Plano desconhecido.", 422, { requestId });
    if (erro instanceof TransicaoIlegal) return fail("state_conflict", "A assinatura já está ativa; para trocar de plano use a mudança de plano.", 409, { requestId });
    return fail("internal_error", "Não foi possível iniciar a contratação.", 500, { requestId });
  }
}
