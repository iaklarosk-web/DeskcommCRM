import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { cookieSecure } from "@/lib/supabase/cookie-secure";
import { IMPERSONATE_COOKIE_NAME, IMPERSONATE_TTL_SECONDS, isImpersonateSecretReady, signImpersonateCookie } from "@/lib/impersonate/cookie";
import { ESCOPOS_DO_SUPORTE } from "@/lib/impersonate/support";

/**
 * F11-T02 (D39, D51, ADR-030 §4): o acompanhamento nesta base é SÓ LEITURA —
 * `full` é recusado (422) —, exige motivo (10–500) e escopo, e o vencimento é
 * escolhido em minutos (1–60; o banco ainda limita a 3600 s).
 */
const inputSchema = z.object({
  access_mode: z.enum(["support_readonly"]).default("support_readonly"),
  reason: z.string().trim().min(10).max(500),
  scope: z.enum(ESCOPOS_DO_SUPORTE).default("all"),
  expires_in_minutes: z.number().int().min(1).max(60).default(60),
});
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  const { id: tenantId } = await params;
  if (!z.string().uuid().safeParse(tenantId).success) return fail("validation_failed", "Organização inválida.", 422, { requestId });
  const input = inputSchema.safeParse(await req.json().catch(() => ({})));
  if (!input.success) return fail("validation_failed", "Acompanhamento exige motivo (10 a 500 caracteres), escopo válido e só leitura; vencimento de 1 a 60 minutos.", 422, { requestId });
  let ctx;
  try { ctx = await requirePlatformAdmin(); }
  catch { return fail("forbidden", "Administração da plataforma necessária.", 403, { requestId }); }
  if (await mfaEmDivida()) return fail("mfa_required", "Confirme a verificação em duas etapas.", 403, { requestId });
  if (!isImpersonateSecretReady()) return fail("upstream_unavailable", "Acompanhamento não configurado nesta instalação.", 503, { requestId });
  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Entre novamente.", 401, { requestId });
  if (user.support) return fail("state_conflict", "Encerre o acompanhamento atual primeiro.", 409, { requestId });
  const previous = await resolveActiveOrg(user);
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  const sessionId = claims?.claims.session_id;
  if (!z.string().uuid().safeParse(sessionId).success) return fail("unauthenticated", "Sessão inválida.", 401, { requestId });
  const admin = createAdminClient();
  const { data: id, error } = await admin.rpc("fn_start_support_saas", {
    p_actor: ctx.user.id, p_session: sessionId, p_org: tenantId,
    p_previous: previous?.orgId ?? null, p_reason: input.data.reason, p_scope: input.data.scope,
    p_ttl: Math.min(input.data.expires_in_minutes * 60, IMPERSONATE_TTL_SECONDS),
  });
  if (error || !id) return fail("state_conflict", "Não foi possível iniciar. Confira o acesso e o estado da organização.", 409, { requestId });
  const { data: session } = await admin.from("platform_support_sessions").select("expires_at, access_mode, reason, scope")
    .eq("id", id).eq("actor_user_id", ctx.user.id).eq("organization_id", tenantId).single();
  if (!session) return fail("upstream_unavailable", "Acompanhamento iniciado. Recarregue para confirmar o estado.", 503, { requestId });
  const exp = Math.floor(new Date(session.expires_at).getTime()/1000);
  (await cookies()).set(IMPERSONATE_COOKIE_NAME, signImpersonateCookie({
    tenantId, platformAdminId: ctx.user.id, sessionId: id, exp,
  }), { httpOnly: true, secure: cookieSecure(), sameSite: "strict", path: "/", maxAge: 60*60*24*30 });
  await audit({ action: "platform_admin.impersonate_started", actorUserId: ctx.user.id,
    actingAsPlatformAdmin: true, bypassedRls: true, organizationId: tenantId,
    resourceType: "organization", resourceId: tenantId, requestId,
    metadata: { auth_session_id: sessionId, support_session_id: id, access_mode: session.access_mode, expires_at: session.expires_at, reason: session.reason, scope: session.scope } });
  return ok({ redirect_url: "/app/inbox", expires_at: session.expires_at, support_session_id: id, access_mode: session.access_mode, reason: session.reason, scope: session.scope }, { requestId });
}
