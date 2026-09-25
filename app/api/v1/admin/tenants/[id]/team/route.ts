/**
 * `GET /api/v1/admin/tenants/<id>/team` — membros de uma organização, pelo
 * painel do dono (F21, ADR-048 §1).
 *
 * Leitura vale para qualquer `platform_admin`; a escrita vive em
 * `[userId]/route.ts` e exige escopo `full` (D51).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requirePlatformAdminApi } from "@/lib/auth/requirePlatformAdminApi";
import { listarMembros } from "@/src/equipe/repositorio";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const guarda = await requirePlatformAdminApi(requestId);
  if (!guarda.ok) return guarda.response;
  const { id } = await ctx.params;

  const membros = await listarMembros(id);
  await audit({
    action: "platform_admin.tenant_viewed",
    actorUserId: guarda.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "organization",
    resourceId: id,
    requestId,
    metadata: { recurso: "team", membros: membros.length },
  });
  return ok({ members: membros }, { requestId });
}
