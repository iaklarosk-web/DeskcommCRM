/**
 * `POST /api/v1/billing/subscription/plan` `{plan_code}` (F12-T05) — mudança
 * de plano imediata, sem pro-rata (default declarado, ADR-030 §3). Só em `active`.
 */
import { z } from "zod";

import { getRequestId } from "@/lib/api/request-id";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { requireRole } from "@/lib/auth/require-role";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { mudarPlano, PlanoDesconhecido, TransicaoIlegal, UsePortal } from "@/src/billing";

import { contextoDeCobranca } from "../../_ctx";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({ plan_code: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/) });

export async function POST(req: Request): Promise<Response> {
  // Acompanhamento (suporte) é só leitura: quem assina, paga, troca ou cancela
  // é a própria empresa, nunca o dono da plataforma acompanhando.
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = getRequestId(req);
  const authz = await requireRole("admin", { requestId, resource: "billing_plan", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  const auth = { ctx: contextoDeCobranca(authz), user: authz.user };
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", "Informe plan_code.", 422, { requestId });
  try {
    const assinatura = await mudarPlano(auth.ctx, { plan_code: corpo.data.plan_code });
    await audit({
      action: "billing.plan_changed",
      actorUserId: auth.user.id,
      organizationId: auth.ctx.organization_id,
      resourceType: "subscription",
      resourceId: assinatura.id,
      requestId,
      metadata: { plan_code: assinatura.plan_code },
    });
    return ok({ subscription: assinatura }, { requestId });
  } catch (erro) {
    if (erro instanceof PlanoDesconhecido) return fail("validation_failed", "Plano desconhecido.", 422, { requestId });
    if (erro instanceof UsePortal) return fail("use_portal", "Esta assinatura é gerenciada no portal do gateway: troque de plano por Gerenciar assinatura.", 409, { requestId });
    if (erro instanceof TransicaoIlegal) return fail("state_conflict", "Só uma assinatura ativa troca de plano.", 409, { requestId });
    return fail("internal_error", "Não foi possível trocar o plano.", 500, { requestId });
  }
}
