/**
 * F13 (ADR-034) — o gate de PERMISSÃO D15 nas rotas novas do CRM comercial.
 *
 * `requireRole` (rank + MFA) continua decidindo 401/403 de acesso à rota; este
 * helper traduz o papel herdado já resolvido para D15 e aplica a MATRIZ
 * (`src/rbac/matrix.ts`) — é o que faz `roles_denied=D/D` ser medido contra a
 * mesma tabela que a unit `rbac-matriz` deriva. Nunca decide sozinho: só roda
 * depois de `requireRole` ter passado.
 */
import { fail } from "@/lib/api/wrappers";
import { can, papelD15DoHerdado, type PapelD15, type Permissao } from "@/src/rbac/matrix";
import type { TenantCtx } from "@/src/tenant-context";

export interface AutorizacaoDaRota {
  user: { id: string };
  org: { orgId: string; role: string };
}

export function papelDaRota(authz: AutorizacaoDaRota): PapelD15 | null {
  return papelD15DoHerdado(authz.org.role, false);
}

/** `null` = permitido; `Response` = 403 `forbidden_role` pronto para devolver. */
export function negarSemPermissao(
  authz: AutorizacaoDaRota,
  permissao: Permissao,
  requestId: string,
): Response | null {
  if (can(papelDaRota(authz), permissao)) return null;
  return fail("forbidden_role", "Seu papel não permite esta operação.", 403, {
    requestId,
    details: { permissao, papel: papelDaRota(authz) },
  });
}

export function ctxDaRota(authz: AutorizacaoDaRota): TenantCtx {
  return { organization_id: authz.org.orgId, source: "session", user_id: authz.user.id };
}
