/**
 * F13-T01 (ADR-034 §2) — as DEFINIÇÕES dos campos configuráveis por organização.
 *
 * GET  /api/v1/settings/crm-fields           → { contacts: def[], companies: def[] }
 * PUT  /api/v1/settings/crm-fields           ← { entity, fields } (permissão `fields.manage`)
 *
 * A definição mora em `tenant_settings` (`crm.fields.<entity>`, D21); a lista
 * é validada por `validarDefinicoes` dentro de `setSetting` — uma régua só.
 */
import { z } from "zod";

import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import {
  definicoesDa,
  ENTIDADES_COM_CAMPOS,
  gravarDefinicoes,
  InvalidSettingError,
} from "@/src/crm/campos";
import { ctxDaRota, negarSemPermissao } from "@/src/crm/permissao-da-rota";

export const dynamic = "force-dynamic";

const putSchema = z.strictObject({
  entity: z.enum(ENTIDADES_COM_CAMPOS),
  fields: z.array(z.unknown()).max(50),
});

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const authz = await requireRole("viewer", { requestId, resource: "crm_fields", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  const ctx = ctxDaRota(authz);
  const [contacts, companies] = await Promise.all([definicoesDa(ctx, "contacts"), definicoesDa(ctx, "companies")]);
  return ok({ contacts, companies }, { requestId });
}

export async function PUT(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "crm_fields", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  const negado = negarSemPermissao(authz, "fields.manage", requestId);
  if (negado) return negado;
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Definição de campos inválida.", 422, { requestId, details: parsed.error.flatten() });
  }
  const ctx = ctxDaRota(authz);
  try {
    await gravarDefinicoes(ctx, parsed.data.entity, parsed.data.fields, "tenant_admin");
  } catch (error) {
    if (error instanceof InvalidSettingError) {
      return fail("validation_failed", error.message, 422, { requestId });
    }
    throw error;
  }
  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "crm_fields.updated",
    resourceType: "tenant_settings",
    // `resource_id` é uuid: a chave natural vai no metadata.
    resourceId: null,
    requestId,
    metadata: { key: `crm.fields.${parsed.data.entity}`, entity: parsed.data.entity, fields: parsed.data.fields.length },
  });
  return ok({ entity: parsed.data.entity, fields: await definicoesDa(ctx, parsed.data.entity) }, { requestId });
}
