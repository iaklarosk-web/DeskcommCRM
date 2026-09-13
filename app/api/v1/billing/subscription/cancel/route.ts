/**
 * `POST /api/v1/billing/subscription/cancel` `{reason}` (F12-T05) — cancela
 * preservando dados; a cobrança continua legível e a reativação é um novo
 * checkout.
 */
import { z } from "zod";

import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { cancelar, TransicaoIlegal } from "@/src/billing";

import { contextoDeCobranca } from "../../_ctx";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export async function POST(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const auth = await contextoDeCobranca(requestId, "billing_cancel");
  if (!auth.ok) return auth.response;
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", "Informe o motivo (3 a 500 caracteres).", 422, { requestId });
  try {
    const assinatura = await cancelar(auth.ctx, { reason: corpo.data.reason });
    await audit({
      action: "billing.subscription_cancelled",
      actorUserId: auth.user.id,
      organizationId: auth.ctx.organization_id,
      resourceType: "subscription",
      resourceId: assinatura.id,
      requestId,
      metadata: { from_plan: assinatura.plan_code },
    });
    return ok({ subscription: assinatura }, { requestId });
  } catch (erro) {
    if (erro instanceof TransicaoIlegal) return fail("state_conflict", "A assinatura não pode ser cancelada neste estado.", 409, { requestId });
    return fail("internal_error", "Não foi possível cancelar.", 500, { requestId });
  }
}
