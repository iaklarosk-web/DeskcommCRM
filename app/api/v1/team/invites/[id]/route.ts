/**
 * `DELETE /api/v1/team/invites/<id>` — revoga um convite pendente
 * (F20-T03, ADR-045 §4; D61 b/c).
 *
 * Revogar é o que mata um link que vazou: o `/i/<token>` passa a responder
 * "convite cancelado" na hora. A organização vem da SESSÃO; convite de outra
 * empresa responde 404, indistinguível de inexistente.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { revogarConviteDaOrganizacao } from "@/src/convites/politica";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const { id } = await ctx.params;

  const resultado = await revogarConviteDaOrganizacao({
    organization_id: org.orgId,
    invite_id: id,
    papel: org.role,
    revoked_by: user.id,
  });

  if (!resultado.ok) {
    if (resultado.motivo === "sem_permissao") return fail("forbidden", "Acesso negado.", 403, { requestId });
    return fail("not_found", "Convite não encontrado ou já não está pendente.", 404, { requestId });
  }

  await audit({
    action: "member.invite_revoked",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "membership",
    resourceId: id,
    requestId,
  });
  return ok({ revoked: true }, { requestId });
}
