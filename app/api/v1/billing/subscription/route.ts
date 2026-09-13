/**
 * `GET /api/v1/billing/subscription` (F12-T04) — a assinatura da organização
 * ativa, o plano, o acesso que ela permite e as faturas. É a MESMA leitura que
 * a página `/app/billing` faz: a prova de F12-T08 compara tela e rota.
 */
import { getRequestId } from "@/lib/api/request-id";
import { requireRole } from "@/lib/auth/require-role";
import { fail, ok } from "@/lib/api/wrappers";
import { acessoDe, lerAssinaturaEm, listarFaturasEm, obterPlano, PlanoDesconhecido } from "@/src/billing";
import { withTenant } from "@/src/tenant-context";

import { contextoDeCobranca } from "../_ctx";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const authz = await requireRole("admin", { requestId, resource: "billing", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  const auth = { ctx: contextoDeCobranca(authz), user: authz.user };
  try {
    const dados = await withTenant(auth.ctx, async (db) => {
      const assinatura = await lerAssinaturaEm(db, auth.ctx);
      const faturas = await listarFaturasEm(db, auth.ctx);
      const plano = assinatura === null ? null : await obterPlano(assinatura.plan_code);
      return { assinatura, faturas, plano };
    });
    const acesso = acessoDe(
      dados.assinatura === null
        ? null
        : { status: dados.assinatura.status, plan_code: dados.assinatura.plan_code, grace_until: dados.assinatura.grace_until },
    );
    return ok({ subscription: dados.assinatura, plan: dados.plano, access: acesso, invoices: dados.faturas }, { requestId });
  } catch (erro) {
    if (erro instanceof PlanoDesconhecido) return fail("state_conflict", "O plano da assinatura não existe mais no catálogo.", 409, { requestId });
    return fail("internal_error", "Não foi possível ler a assinatura.", 500, { requestId });
  }
}
