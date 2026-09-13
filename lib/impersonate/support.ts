import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail } from "@/lib/api/wrappers";

/** Escopos do acompanhamento (F11-T02, ADR-030 §4) — espelho do CHECK de 9024. */
export const ESCOPOS_DO_SUPORTE = ["all", "inbox", "crm", "settings", "billing"] as const;
export type EscopoDoSuporte = (typeof ESCOPOS_DO_SUPORTE)[number];

export const supportSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), actor_user_id: z.string().uuid(),
  auth_session_id: z.string().uuid(), previous_organization_id: z.string().uuid().nullable(),
  expires_at: z.string(), name: z.string(), locale: z.string().nullable(),
  access_mode: z.enum(["full", "support_readonly"]), status: z.enum(["active", "expired", "revoked"]),
  // F11-T02: motivo e escopo (9024). `reason` nulo só em sessão anterior à migration.
  reason: z.string().nullable().optional().default(null),
  scope: z.enum(ESCOPOS_DO_SUPORTE).optional().default("all"),
});
export type SupportContext = z.infer<typeof supportSchema>;

/** Chamar depois de getUser. A RPC resolve auth.uid + auth.session_id, nunca cookie. */
export async function readSupportContext(db: Awaited<ReturnType<typeof createClient>>): Promise<SupportContext | null> {
  const { data, error } = await db.rpc("fn_support_context");
  if (error) throw new Error("Não foi possível confirmar o acompanhamento administrativo.");
  return data === null ? null : supportSchema.parse(data);
}

/**
 * Prefixos de rota que cada escopo alcança (ADR-030 §4). `all` alcança tudo
 * (só leitura); rota fora do escopo é 403 `support_scope`. Rotas de sessão e
 * de saída do acompanhamento ficam sempre abertas — a pessoa precisa conseguir
 * sair.
 */
const ROTAS_POR_ESCOPO: Readonly<Record<Exclude<EscopoDoSuporte, "all">, readonly string[]>> = {
  inbox: ["/api/v1/inbox/", "/api/v1/conversations/", "/api/v1/messages/", "/api/v1/realtime/"],
  crm: ["/api/v1/contacts/", "/api/v1/contacts", "/api/v1/crm/", "/api/v1/catalog/", "/api/v1/companies/"],
  settings: ["/api/v1/settings/", "/api/v1/team", "/api/v1/team/"],
  billing: ["/api/v1/billing/"],
};
const SEMPRE_NO_ESCOPO = ["/api/v1/auth/", "/api/v1/admin/impersonate/end", "/api/v1/organizations/switch"];

export function rotaNoEscopo(scope: EscopoDoSuporte, caminho: string | null): boolean {
  if (scope === "all" || caminho === null) return true;
  if (SEMPRE_NO_ESCOPO.some((p) => caminho.startsWith(p))) return true;
  return ROTAS_POR_ESCOPO[scope].some((p) => caminho === p || caminho.startsWith(p));
}

export function supportWriteError(support: SupportContext | null | undefined, organizationId?: string): string | null {
  if (!support || (organizationId && organizationId !== support.organization_id)) return null;
  if (support.status !== "active") return "O acompanhamento terminou. Saia do acompanhamento para continuar.";
  if (support.access_mode !== "full") return "Este acompanhamento permite somente leitura.";
  return null;
}

/** Guarda de EFEITO, antes dos clientes service role. Não substitui RBAC/MFA.
 * Sem cookie de usuário, workers/tokens seguem sua autorização própria.
 * targetOrganizationId é exclusivamente path ou registro confiável de administração.
 */
export async function requireSupportWrite(targetOrganizationId?: string) {
  try {
    const { loadAuthUser } = await import("@/lib/auth/server");
    const user = await loadAuthUser();
    if (!user) return null;
    const support = user.support;
    const message = supportWriteError(support, targetOrganizationId);
    return message ? fail("forbidden", message, 403) : null;
  } catch {
    return fail("upstream_unavailable", "Não foi possível confirmar a permissão de acompanhamento.", 503);
  }
}

/** Identidade vem do state HMAC já verificado, nunca do body. */
export async function supportCallbackWriteAllowed(organizationId: string, actorId?: string, sessionId?: string): Promise<boolean> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data, error } = await createAdminClient().rpc("fn_support_callback_write_allowed", {
    p_org: organizationId, p_actor: actorId ?? null, p_session: sessionId ?? null,
  });
  return !error && data === true;
}
export async function authenticatedSessionId(): Promise<string> {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("Sessão ausente.");
  const { data } = await db.auth.getClaims();
  return z.string().uuid().parse(data?.claims.session_id);
}
