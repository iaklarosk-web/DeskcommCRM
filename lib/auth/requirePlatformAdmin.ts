/**
 * Server guard for /admin/* (Super-Admin Platform sub-product).
 *
 * Flow:
 *  1. Validate JWT via getUser() (NEVER getSession on backend per CLAUDE.md).
 *  2. Confirm row in platform_admins (active = no revoked_at).
 *  3. Enforce MFA AAL2 if `mfa_required` (default true for platform admins).
 *
 * Redirects:
 *  - no user        → /login?next=/admin
 *  - no row         → /admin/forbidden
 *  - aal1 + required → /login/mfa?next=/admin
 *  - query FALHOU   → estoura (auth_permissions_unavailable), nunca /admin/forbidden
 *
 * The middleware already does an early `fn_is_platform_admin` RPC check;
 * this helper performs the authoritative server-side validation inside the
 * /admin layout (where redirects are cheap, DB calls are allowed in Node
 * runtime, and we have access to AAL state).
 */
import { redirect } from "next/navigation";
import { logger } from "@/lib/logger";
import type { User } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { registrarRequisicao } from "@/src/obs/log";

export interface PlatformAdminInfo {
  user_id: string;
  scope: string;
  mfa_required: boolean;
}

export interface PlatformAdminContext {
  user: User;
  platformAdmin: PlatformAdminInfo;
}

export async function requirePlatformAdmin(): Promise<PlatformAdminContext> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/admin");
  }

  // platform_admins RLS: only platform admins read; non-admins get null → forbid.
  const { data: paRow, error: paErro } = await supabase
    .from("platform_admins")
    .select("user_id, scope, mfa_required, revoked_at")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .maybeSingle();

  /**
   * FALHA ALTO, não baixo — o mesmo princípio de `lib/auth/server.ts` (incidente
   * de 2026-07-30), no caminho que ficou de fora daquela correção.
   *
   * `data: null` é AMBÍGUO nesta consulta: é o que a RLS devolve para quem NÃO é
   * admin e é também o que sobra quando a query quebra. Descartar o `error` faz
   * um defeito de infraestrutura chegar ao operador como decisão de autorização.
   *
   * Medido em produção (21–22/09/2026): o pool do PostgREST travou
   * (`PGRST003: Timed out acquiring connection from connection pool`) e ficou 36 h
   * sem servir; o proprietário — platform_admin ativo, `mfa_required=false` —
   * recebeu "Acesso negado: esta área é restrita a administradores da plataforma
   * com MFA ativo". A tela acusava permissão e MFA; a causa era um container.
   * Conserto da infra: `docker restart crm-prod-rest`. Conserto do código: este.
   */
  if (paErro) {
    logger.error("[admin] não foi possível resolver o platform_admin", {
      user_id: user.id,
      onde: "platform_admins",
      code: paErro.code,
      message: paErro.message,
    });
    throw new Error(
      `auth_permissions_unavailable: ${paErro.code ?? "sem-codigo"}: ${paErro.message} — ` +
        `o acesso de administrador NÃO pôde ser resolvido; a sessão NÃO foi rebaixada ` +
        `por decisão de autorização.`,
    ); // MUTANT: admin-guard-falha-alto
  }

  if (!paRow) {
    redirect("/admin/forbidden");
  }

  if (paRow.mfa_required) {
    const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalData?.currentLevel !== "aal2") {
      redirect("/login/mfa?next=/admin");
    }
  }

  // F06-T01: a linha `api.request` da superfície de administração. Sem
  // organização por desenho — o escopo diz por quê.
  try {
    const hdrs = await headers();
    const path = hdrs.get("x-pathname");
    if (path?.startsWith("/api/")) {
      registrarRequisicao({
        request_id: hdrs.get("x-request-id") ?? `sem-request-id:${crypto.randomUUID()}`,
        organization_id: null,
        scope: "platform_admin",
        outcome: "allowed",
        path,
        method: hdrs.get("x-request-method"),
        actor_id: user.id,
        status: 200,
      });
    }
  } catch {
    /* fora de request scope: nada a correlacionar */
  }

  return {
    user,
    platformAdmin: {
      user_id: paRow.user_id,
      scope: paRow.scope,
      mfa_required: paRow.mfa_required,
    },
  };
}
