/**
 * `PATCH/DELETE /api/v1/admin/tenants/<id>/team/<userId>` — mudar papel e
 * remover membro, pelo painel do dono (F21, ADR-048 §1 e §4).
 *
 * Esta rota existe por causa de 25/09/2026: fechado o D60, o proprietário
 * precisou sair do tenant do cliente e NÃO HAVIA TELA. A remoção saiu por
 * `DELETE` em psql, sem linha em `api_audit_log`, com a regra do último admin
 * conferida na mão. Aqui a regra é imposta por código, dentro da transação, e
 * toda ação deixa rastro.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requirePlatformAdminApi } from "@/lib/auth/requirePlatformAdminApi";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { adminMudarPapelSchema } from "@/lib/schemas/team";
import { removerMembro, mudarPapel } from "@/src/equipe/repositorio";
import type { RecusaDaEquipe } from "@/src/equipe/politica";

export const dynamic = "force-dynamic";

/** Cada recusa tem o seu texto: é ele que diz à pessoa o que fazer a seguir. */
const TEXTO: Record<RecusaDaEquipe, string> = {
  ultimo_admin:
    "Esta é a última pessoa com papel de administrador. Convide ou promova alguém antes — uma empresa sem administrador não consegue convidar, configurar nem gerir a assinatura.",
  membro_nao_encontrado: "Esta pessoa não é membro desta empresa.",
  papel_igual: "A pessoa já tem esse papel.",
};

const STATUS: Record<RecusaDaEquipe, number> = {
  ultimo_admin: 409,
  membro_nao_encontrado: 404,
  papel_igual: 409,
};

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; userId: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const guarda = await requirePlatformAdminApi(requestId);
  if (!guarda.ok) return guarda.response;
  if (guarda.platformAdmin.scope !== "full") {
    return fail("forbidden", "Acompanhamento é só leitura: mudar papel exige escopo full.", 403, { requestId });
  }
  const { id, userId } = await ctx.params;

  const corpo = adminMudarPapelSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) {
    return fail("validation_error", "Papel inválido.", 422, { requestId, details: corpo.error.flatten().fieldErrors });
  }

  const r = await mudarPapel({ organization_id: id, user_id: userId, novo: corpo.data.role });
  if (!r.ok) {
    await audit({
      action: "admin.membership_role_denied",
      actorUserId: guarda.user.id,
      actingAsPlatformAdmin: true,
      bypassedRls: true,
      organizationId: id,
      resourceType: "user_organizations",
      resourceId: userId,
      requestId,
      metadata: { recusa: r.recusa, papel_pedido: corpo.data.role },
    });
    return fail(r.recusa, TEXTO[r.recusa], STATUS[r.recusa], { requestId });
  }

  await audit({
    action: "admin.membership_role_changed",
    actorUserId: guarda.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "user_organizations",
    resourceId: userId,
    requestId,
    metadata: { papel_anterior: r.papel_anterior, papel_novo: corpo.data.role },
  });
  return ok({ user_id: userId, role: corpo.data.role, papel_anterior: r.papel_anterior }, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; userId: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const guarda = await requirePlatformAdminApi(requestId);
  if (!guarda.ok) return guarda.response;
  if (guarda.platformAdmin.scope !== "full") {
    return fail("forbidden", "Acompanhamento é só leitura: remover membro exige escopo full.", 403, { requestId });
  }
  const { id, userId } = await ctx.params;

  const r = await removerMembro({ organization_id: id, user_id: userId });
  if (!r.ok) {
    await audit({
      action: "admin.membership_removal_denied",
      actorUserId: guarda.user.id,
      actingAsPlatformAdmin: true,
      bypassedRls: true,
      organizationId: id,
      resourceType: "user_organizations",
      resourceId: userId,
      requestId,
      metadata: { recusa: r.recusa },
    });
    return fail(r.recusa, TEXTO[r.recusa], STATUS[r.recusa], { requestId });
  }

  await audit({
    action: "admin.membership_removed",
    actorUserId: guarda.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "user_organizations",
    resourceId: userId,
    requestId,
    metadata: { papel_removido: r.papel_removido },
  });
  return ok({ user_id: userId, removido: true }, { requestId });
}
