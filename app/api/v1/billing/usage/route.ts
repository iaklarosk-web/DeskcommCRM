/**
 * `GET /api/v1/billing/usage` (F12-T04) — uso por capability no período do
 * ciclo (ou mês civil), com limite e restante do plano. Tela contra banco.
 */
import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { lerAssinaturaEm, mesCivil, obterPlano, usoPorCapabilityEm, type Periodo } from "@/src/billing";
import { withTenant } from "@/src/tenant-context";

import { contextoDeCobranca } from "../_ctx";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const auth = await contextoDeCobranca(requestId, "billing_usage");
  if (!auth.ok) return auth.response;
  try {
    const dados = await withTenant(auth.ctx, async (db) => {
      const assinatura = await lerAssinaturaEm(db, auth.ctx);
      const plano = assinatura === null ? null : await obterPlano(assinatura.plan_code);
      const periodo: Periodo =
        assinatura?.current_period_start && assinatura.current_period_end
          ? { desde: assinatura.current_period_start, ate: assinatura.current_period_end }
          : mesCivil();
      const usage = await usoPorCapabilityEm(db, auth.ctx, periodo, plano?.limits ?? {});
      return { periodo, usage, plan_code: plano?.code ?? null };
    });
    return ok(dados, { requestId });
  } catch {
    return fail("internal_error", "Não foi possível ler o uso.", 500, { requestId });
  }
}
