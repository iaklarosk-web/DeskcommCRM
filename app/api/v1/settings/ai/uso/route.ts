/**
 * A porta HTTP do USO de IA do `tenant_admin` (F05-T09, §5.3, D14/D15).
 *
 * `GET /api/v1/settings/ai/uso?desde=YYYY-MM-DD&ate=YYYY-MM-DD` — sem datas,
 * o mês civil corrente (UTC). Responde por `resumoDeUso`, a MESMA leitura que a
 * página servida faz: a prova de F05-T09 compara o valor exibido na tela com o
 * que esta rota devolve, e as duas têm de ler o mesmo `sum(ai_usage_events)`.
 *
 * `requireRole("admin")` porque é o gate que carrega o MFA de sessão; a tabela
 * é `service_only` (D35) e só é alcançada pelo servidor, via `withTenant`.
 */
import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { mesDe, PeriodoInvalido, periodoDeDatas, resumoDeUso } from "@/src/entitlement";
import type { TenantCtx } from "@/src/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const authz = await requireRole("admin", {
    requestId,
    resource: "ai_usage",
    allowPlatformAdmin: false,
  });
  if (!authz.ok) return authz.response;
  const ctx: TenantCtx = {
    organization_id: authz.org.orgId,
    user_id: authz.user.id,
    role: authz.org.role,
    source: "session",
  };

  const url = new URL(req.url);
  const desde = url.searchParams.get("desde");
  const ate = url.searchParams.get("ate");
  try {
    const periodo = desde !== null && ate !== null ? periodoDeDatas(desde, ate) : mesDe(new Date());
    return ok(await resumoDeUso(ctx, periodo), { requestId });
  } catch (erro) {
    if (erro instanceof PeriodoInvalido) {
      return fail("validation_failed", "Período inválido: use desde=YYYY-MM-DD&ate=YYYY-MM-DD.", 422, {
        requestId,
      });
    }
    return fail("internal_error", "Não foi possível ler o uso de IA.", 500, { requestId });
  }
}
