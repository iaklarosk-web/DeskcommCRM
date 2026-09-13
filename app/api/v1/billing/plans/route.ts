/**
 * `GET /api/v1/billing/plans` (F12-T04) — o catálogo de planos ativos, com
 * `source` para a tela dizer "placeholder" onde é placeholder (D14).
 */
import { getRequestId } from "@/lib/api/request-id";
import { requireRole } from "@/lib/auth/require-role";
import { fail, ok } from "@/lib/api/wrappers";
import { listarPlanos } from "@/src/billing";

import { contextoDeCobranca } from "../_ctx";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const authz = await requireRole("admin", { requestId, resource: "billing_plans", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  const auth = { ctx: contextoDeCobranca(authz), user: authz.user };
  try {
    return ok({ plans: await listarPlanos() }, { requestId });
  } catch {
    return fail("internal_error", "Não foi possível ler os planos.", 500, { requestId });
  }
}
