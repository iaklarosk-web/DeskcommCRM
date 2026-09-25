/**
 * F13-T03 (ADR-034 §2) — a configuração da fila de oportunidades.
 *
 * GET   /api/v1/settings/crm   → { distribution, queue_roles }
 * PATCH /api/v1/settings/crm   ← { distribution?, queue_roles? } (permissão `opportunities.assign`)
 *
 * `crm.distribution` (`manual|round_robin`) e `crm.queue_roles` (papéis D15)
 * moram em `tenant_settings` (D21) e são validados por `setSetting`.
 */
import { z } from "zod";

import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { ctxDaRota, negarSemPermissao } from "@/src/crm/permissao-da-rota";
import { PAPEIS_D15 } from "@/src/rbac/matrix";
import { getSetting, InvalidSettingError, setSetting } from "@/src/tenant-config/settings";

export const dynamic = "force-dynamic";

const patchSchema = z
  .strictObject({
    distribution: z.enum(["manual", "round_robin"]).optional(),
    queue_roles: z.array(z.enum(PAPEIS_D15 as unknown as [string, ...string[]])).min(1).max(4).optional(),
  })
  .refine((v) => v.distribution !== undefined || v.queue_roles !== undefined, { message: "nada a alterar" });

async function leitura(ctx: ReturnType<typeof ctxDaRota>) {
  const [distribution, queue_roles] = await Promise.all([getSetting(ctx, "crm.distribution"), getSetting(ctx, "crm.queue_roles")]);
  return { distribution, queue_roles };
}

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const authz = await requireRole("viewer", { requestId, resource: "crm_settings", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  return ok(await leitura(ctxDaRota(authz)), { requestId });
}

export async function PATCH(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "crm_settings", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  const negado = negarSemPermissao(authz, "opportunities.assign", requestId);
  if (negado) return negado;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Configuração inválida.", 422, { requestId, details: parsed.error.flatten() });
  const ctx = ctxDaRota(authz);
  try {
    if (parsed.data.distribution !== undefined) await setSetting(ctx, "crm.distribution", parsed.data.distribution, "tenant_admin");
    if (parsed.data.queue_roles !== undefined) await setSetting(ctx, "crm.queue_roles", parsed.data.queue_roles, "tenant_admin");
  } catch (error) {
    if (error instanceof InvalidSettingError) return fail("validation_failed", error.message, 422, { requestId });
    throw error;
  }
  // `resource_id` é uuid: a chave natural (`crm.distribution`/`crm.queue_roles`) vai no metadata.
  await audit({ organizationId: authz.org.orgId, actorUserId: authz.user.id, action: "crm_settings.updated", resourceType: "tenant_settings", resourceId: null, requestId, metadata: { keys: Object.keys(parsed.data).map((k) => `crm.${k}`), ...parsed.data } });
  return ok(await leitura(ctx), { requestId });
}
