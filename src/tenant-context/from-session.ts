/**
 * fromSession — TenantCtx a partir da sessão autenticada (§5.1).
 *
 * Reusa a cadeia herdada que já é a fonte de verdade de auth do app:
 * `loadAuthUser()` valida o JWT via `supabase.auth.getUser()` (nunca
 * `getSession()` — AGENTS.md §0) e `resolveActiveOrg()` resolve a org ativa de
 * fonte confiável (cookie validado contra memberships, nunca o body). A
 * identidade da requisição viaja nos cookies lidos por `next/headers`, por
 * isso a função não recebe o request explicitamente — mesma assinatura da
 * cadeia que ela embrulha.
 */
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";

import { TenantResolutionError, type TenantCtx } from "./types";

export async function fromSession(): Promise<TenantCtx> {
  const user = await loadAuthUser();
  if (!user) {
    throw new TenantResolutionError("session", "unauthenticated");
  }

  // Suporte não é membership. TenantCtx ainda não preserva suas restrições
  // de modo, expiração e auditoria; a adaptação explícita pertence à F11.
  // Evita converter o papel sintético de resolveActiveOrg em acesso comum.
  if (user.support) {
    throw new TenantResolutionError("session", "support_session_not_supported");
  }

  const org = await resolveActiveOrg(user);
  if (!org) {
    throw new TenantResolutionError("session", "no_membership");
  }

  return {
    organization_id: org.orgId,
    user_id: user.id,
    role: org.role,
    source: "session",
  };
}
