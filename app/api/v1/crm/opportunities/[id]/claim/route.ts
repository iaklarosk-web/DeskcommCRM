/**
 * F13-T03 (ADR-034 §2) — POST /api/v1/crm/opportunities/[id]/claim
 * Quem puxa da fila fica com a oportunidade; a segunda tentativa recebe 409.
 */
import { z } from "zod";

import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { reivindicar } from "@/src/crm/oportunidades";
import { ctxDaRota } from "@/src/crm/permissao-da-rota";

import { falhaDaOportunidade } from "../../_erros";

export const dynamic = "force-dynamic";
const idSchema = z.string().uuid();

export async function POST(req: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = getRequestId(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("agent", { requestId, resource: "crm_opportunity_queue", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return fail("validation_failed", "Identificador inválido.", 422, { requestId });
  try {
    const resultado = await reivindicar(ctxDaRota(authz), id.data, authz.user.id);
    await audit({ organizationId: authz.org.orgId, actorUserId: authz.user.id, action: "crm_opportunity.claimed", resourceType: "crm_leads", resourceId: id.data, requestId });
    return ok(resultado, { requestId });
  } catch (error) {
    const falha = falhaDaOportunidade(error, requestId);
    if (falha) return falha;
    throw error;
  }
}
