import { z } from "zod";
import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/conversations/[id]/close — fecha a conversa.
 *
 * Não bloqueia por assignee — qualquer membro com permissão (RLS) pode fechar.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { ctxDoInbox, erroDeApiDaTransicao, moverPeloInbox } from "@/lib/inbox/acoes-d16";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Conversation } from "@/lib/types/messaging";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  let body: unknown = {};
  const text = await req.text();
  try { body = text ? JSON.parse(text) : {}; } catch { return fail("validation_failed", "Corpo inválido.", 422, { requestId }); }
  const parsed = z.object({ expected_revision: z.number().int().positive().optional() }).safeParse(body);
  if (!parsed.success) return fail("validation_failed", "Revisão inválida.", 422, { requestId });
  const { id } = await ctx.params;
  const supabase = await createClient();

  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const user = authz.user;

  const { data: visible, error: readError } = await supabase.from("conversations")
    .select("id, organization_id, service_revision").eq("id", id)
    .eq("organization_id", authz.org.orgId).maybeSingle();
  if (readError) return fail("internal_error", readError.message, 500, { requestId });
  if (!visible) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  // F03-T09: fechar pelo inbox é `human.resolved` (D16). O CAS por revisão fica
  // AQUI, na porta, porque a expectativa é de quem clicou: `transition()` faz o
  // seu próprio CAS com a revisão que ela acabou de ler sob lock, e não teria
  // como saber que a tela viu uma revisão mais velha.
  if (
    parsed.data.expected_revision !== undefined &&
    parsed.data.expected_revision !== visible.service_revision
  ) {
    return fail("conflict", t("O atendimento mudou. Atualize e tente novamente."), 409, {
      requestId,
    });
  }
  try {
    await moverPeloInbox(ctxDoInbox(authz.org.orgId, user.id, authz.org.role), id, "resolver", {
      kind: "attendant",
      userId: user.id,
    });
  } catch (err) {
    const apiErr = erroDeApiDaTransicao(err, requestId, t);
    if (!apiErr) throw err;
    return fail(apiErr.code, apiErr.message, apiErr.status, {
      details: apiErr.details,
      requestId,
    });
  }
  const { data, error } = await createAdminClient()
    .from("conversations")
    .select("*")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  const conv = data as unknown as Conversation;

  await audit({
    action: "conversation.closed",
    actorUserId: user.id,
    organizationId: conv.organization_id,
    resourceType: "conversation",
    resourceId: conv.id,
    requestId,
  });

  return ok(conv, { requestId });
}
