/**
 * F13-T03 (ADR-034 §2) — POST /api/v1/crm/opportunities/distribute {pipeline_id?}
 * Distribui a fila por rodízio (permissão `opportunities.assign`; só com
 * `crm.distribution=round_robin`, senão 409 `distribution_manual`).
 */
import { z } from "zod";

import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { distribuir } from "@/src/crm/oportunidades";
import { ctxDaRota, negarSemPermissao } from "@/src/crm/permissao-da-rota";

import { falhaDaOportunidade } from "../_erros";

export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ pipeline_id: z.string().uuid().optional() });

export async function POST(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("agent", { requestId, resource: "crm_opportunity_queue", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  const negado = negarSemPermissao(authz, "opportunities.assign", requestId);
  if (negado) return negado;
  const corpo = await req.text();
  const parsed = bodySchema.safeParse(corpo.trim() === "" ? {} : JSON.parse(corpo));
  if (!parsed.success) return fail("validation_failed", "Parâmetros inválidos.", 422, { requestId });
  try {
    const resultado = await distribuir(ctxDaRota(authz), parsed.data.pipeline_id);
    await audit({
      organizationId: authz.org.orgId,
      actorUserId: authz.user.id,
      action: "crm_opportunity.distributed",
      resourceType: "crm_leads",
      requestId,
      metadata: { queue_size: resultado.queue_size, assigned: resultado.assignments.length, eligible: resultado.eligible, balanced: resultado.balanced },
    });
    return ok(resultado, { requestId });
  } catch (error) {
    const falha = falhaDaOportunidade(error, requestId);
    if (falha) return falha;
    throw error;
  }
}
