/**
 * O `TenantCtx` de sessão de uma rota de cobrança (F12-T04). O GATE fica na
 * própria rota — `requireRole("admin", …)`, visível ao AST de
 * `tests/unit/rotas-api-tem-gate-de-papel` — e este helper só traduz o que o
 * guarda devolveu. `/api/v1/billing/*` fica sempre aberto pelo acesso da
 * assinatura (a pessoa precisa poder pagar; `src/billing/acesso.ts`).
 */
import type { requireRole } from "@/lib/auth/require-role";
import type { TenantCtx } from "@/src/tenant-context";

type Autorizado = Extract<Awaited<ReturnType<typeof requireRole>>, { ok: true }>;

export function contextoDeCobranca(authz: Autorizado): TenantCtx {
  return {
    organization_id: authz.org.orgId,
    user_id: authz.user.id,
    role: authz.org.role,
    source: "session",
  };
}
