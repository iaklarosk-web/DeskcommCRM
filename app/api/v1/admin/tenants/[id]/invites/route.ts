/**
 * `GET/POST /api/v1/admin/tenants/<id>/invites` — convites de uma organização,
 * pelo painel do dono (F20-T03, ADR-045 §4; D61 c).
 *
 * É a rota que destrava o caso que motivou a fase: o proprietário cria um
 * tenant, fecha a tela e perde o link do convite — e não conseguia recuperá-lo,
 * porque a sessão de suporte é só-leitura (D51) e `POST /api/v1/team/invite`
 * nega escrita durante acompanhamento. Aqui ele age com a própria autoridade de
 * `platform_admin`, auditado, sem virar membro da organização do cliente.
 *
 * `POST` serve para reenviar (o link anterior é revogado — D61 b) e para
 * convidar de novo alguém cujo convite venceu.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requirePlatformAdminApi } from "@/lib/auth/requirePlatformAdminApi";
import { env } from "@/lib/env";
import { emitirConvite, listarPendentes, type PapelDoConvite } from "@/src/convites/repositorio";
import { linkDoConvite } from "@/src/convites/token";

export const dynamic = "force-dynamic";

const PAPEIS: PapelDoConvite[] = ["viewer", "agent", "manager", "admin"];

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const guarda = await requirePlatformAdminApi(requestId);
  if (!guarda.ok) return guarda.response;
  const { id } = await ctx.params;

  const pendentes = await listarPendentes(id);
  await audit({
    action: "platform_admin.tenant_viewed",
    actorUserId: guarda.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "organization",
    resourceId: id,
    requestId,
    metadata: { recurso: "invites", pendentes: pendentes.length },
  });
  return ok(
    {
      invites: pendentes.map((c) => ({
        id: c.id,
        email: c.email,
        role: c.role,
        expires_at: c.expires_at,
        created_at: c.created_at,
        link: linkDoConvite(env.NEXT_PUBLIC_APP_URL, c.token),
      })),
    },
    { requestId },
  );
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const guarda = await requirePlatformAdminApi(requestId);
  if (!guarda.ok) return guarda.response;
  const { id } = await ctx.params;

  let corpo: { email?: unknown; role?: unknown };
  try {
    corpo = (await req.json()) as { email?: unknown; role?: unknown };
  } catch {
    return fail("validation_error", "Corpo inválido.", 400, { requestId });
  }
  const email = typeof corpo.email === "string" ? corpo.email.trim().toLowerCase() : "";
  const role = corpo.role as PapelDoConvite;
  if (email.length === 0 || !email.includes("@")) {
    return fail("validation_error", "Informe o e-mail do convite.", 400, { requestId });
  }
  if (!PAPEIS.includes(role)) {
    return fail("validation_error", `Papel inválido: use ${PAPEIS.join(", ")}.`, 400, { requestId });
  }

  const { convite, link, revogados } = await emitirConvite({
    organization_id: id,
    email,
    role,
    invited_by: guarda.user.id,
    app_url: env.NEXT_PUBLIC_APP_URL,
  });
  await audit({
    action: "member.invited",
    actorUserId: guarda.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "membership",
    resourceId: convite.id,
    requestId,
    metadata: { email, role, via: "admin", revogados_no_reenvio: revogados },
  });
  return ok({ invite: { id: convite.id, email: convite.email, role: convite.role, expires_at: convite.expires_at, link }, revogados }, { status: 201, requestId });
}
