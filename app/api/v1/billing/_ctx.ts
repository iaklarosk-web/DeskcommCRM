/**
 * O que toda rota de cobrança do `tenant_admin` faz antes de ler ou escrever
 * (F12-T04): `requireRole("admin")` — o gate que carrega o MFA de sessão e,
 * desde a F12-T04, o acesso da assinatura (`/api/v1/billing/*` fica sempre
 * aberto para que a pessoa possa pagar) — e o `TenantCtx` de sessão.
 */
import { requireRole } from "@/lib/auth/require-role";
import type { TenantCtx } from "@/src/tenant-context";

export async function contextoDeCobranca(requestId: string, resource: string) {
  const authz = await requireRole("admin", { requestId, resource, allowPlatformAdmin: false });
  if (!authz.ok) return { ok: false as const, response: authz.response };
  const ctx: TenantCtx = {
    organization_id: authz.org.orgId,
    user_id: authz.user.id,
    role: authz.org.role,
    source: "session",
  };
  return { ok: true as const, ctx, user: authz.user };
}
