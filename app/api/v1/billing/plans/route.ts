/**
 * `GET /api/v1/billing/plans` (F12-T04) — o catálogo de planos ativos, com
 * `source` para a tela dizer "placeholder" onde é placeholder (D14).
 */
import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { listarPlanos } from "@/src/billing";

import { contextoDeCobranca } from "../_ctx";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const auth = await contextoDeCobranca(requestId, "billing_plans");
  if (!auth.ok) return auth.response;
  try {
    return ok({ plans: await listarPlanos() }, { requestId });
  } catch {
    return fail("internal_error", "Não foi possível ler os planos.", 500, { requestId });
  }
}
