/**
 * `DELETE /api/v1/admin/tenants/<id>/invites/<inviteId>` — o dono da plataforma
 * revoga um convite de qualquer organização (F20-T03, ADR-045 §4; D61 b/c).
 *
 * Convite de outra organização responde 404, como na rota do tenant: de fora,
 * "não existe" e "não é seu" são indistinguíveis de propósito.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requirePlatformAdminApi } from "@/lib/auth/requirePlatformAdminApi";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { revogarConviteDaOrganizacao } from "@/src/convites/politica";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; inviteId: string }> },
): Promise<Response> {
  // D51: acompanhamento é só leitura; revogar convite é ato de gestão.
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const guarda = await requirePlatformAdminApi(requestId);
  if (!guarda.ok) return guarda.response;
  const { id, inviteId } = await ctx.params;

  const resultado = await revogarConviteDaOrganizacao({
    organization_id: id,
    invite_id: inviteId,
    papel: "platform_admin",
    revoked_by: guarda.user.id,
  });
  if (!resultado.ok) {
    return fail("not_found", "Convite não encontrado ou já não está pendente.", 404, { requestId });
  }

  await audit({
    action: "member.invite_revoked",
    actorUserId: guarda.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "membership",
    resourceId: inviteId,
    requestId,
    metadata: { via: "admin" },
  });
  return ok({ revoked: true }, { requestId });
}
