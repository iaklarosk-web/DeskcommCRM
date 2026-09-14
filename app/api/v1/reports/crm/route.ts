/**
 * F13-T05 (ADR-034 §2) — GET /api/v1/reports/crm?from=&to=
 * O relatório comercial da organização (permissão `reports.read`): funil por
 * etapa com valor, ganhas/perdidas no período, por responsável, fila, tarefas
 * e pedidos por estado — tudo de `fn_crm_report`, com o período ecoado.
 */
import { z } from "zod";

import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { ctxDaRota, negarSemPermissao } from "@/src/crm/permissao-da-rota";
import { periodoPadrao, relatorioComercial } from "@/src/crm/relatorio";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const authz = await requireRole("agent", { requestId, resource: "crm_report", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  const negado = negarSemPermissao(authz, "reports.read", requestId);
  if (negado) return negado;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  if (!parsed.success) return fail("validation_failed", "Período inválido.", 422, { requestId, details: parsed.error.flatten() });
  const padrao = periodoPadrao();
  const periodo = { from: parsed.data.from ? new Date(parsed.data.from) : padrao.from, to: parsed.data.to ? new Date(parsed.data.to) : padrao.to };
  if (!(periodo.from < periodo.to)) return fail("validation_failed", "Período inválido.", 422, { requestId });
  return ok(await relatorioComercial(ctxDaRota(authz), periodo), { requestId });
}
