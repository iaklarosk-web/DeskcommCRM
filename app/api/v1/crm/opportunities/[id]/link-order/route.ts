/**
 * F13-T04 (ADR-034 §2) — POST /api/v1/crm/opportunities/[id]/link-order {order_id}
 * Vincula um pedido (`crm_orders`) da MESMA organização à oportunidade
 * (`crm_lead_links`, target `order`); único por par; linha `order_linked`.
 * Pedido de outra organização = 404 (contado como `cross_org_link_denied`).
 */
import { z } from "zod";

import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { vincularPedido } from "@/src/crm/oportunidades";
import { ctxDaRota } from "@/src/crm/permissao-da-rota";

import { falhaDaOportunidade } from "../../_erros";

export const dynamic = "force-dynamic";
const idSchema = z.string().uuid();
const bodySchema = z.strictObject({ order_id: z.string().uuid() });

export async function POST(req: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = getRequestId(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("agent", { requestId, resource: "crm_leads", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  const id = idSchema.safeParse((await context.params).id);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!id.success || !parsed.success) return fail("validation_failed", "Parâmetros inválidos.", 422, { requestId });
  try {
    const resultado = await vincularPedido(ctxDaRota(authz), id.data, parsed.data.order_id);
    await audit({ organizationId: authz.org.orgId, actorUserId: authz.user.id, action: "crm_opportunity.order_linked", resourceType: "crm_lead_links", resourceId: resultado.link_id, requestId, metadata: { order_id: parsed.data.order_id, created: resultado.created } });
    return ok(resultado, { requestId, status: resultado.created ? 201 : 200 });
  } catch (error) {
    const falha = falhaDaOportunidade(error, requestId);
    if (falha) return falha;
    throw error;
  }
}
