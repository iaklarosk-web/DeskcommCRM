/**
 * F13-T03 (ADR-034 §2) — GET /api/v1/crm/opportunities/queue?pipeline_id=
 * A fila: oportunidades abertas sem dono, na ordem de chegada, com os
 * elegíveis e o modo de distribuição da organização.
 */
import { z } from "zod";

import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { elegiveis, fila } from "@/src/crm/oportunidades";
import { ctxDaRota } from "@/src/crm/permissao-da-rota";
import { getSetting } from "@/src/tenant-config/settings";

export const dynamic = "force-dynamic";

const querySchema = z.object({ pipeline_id: z.string().uuid().optional() });

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const authz = await requireRole("agent", { requestId, resource: "crm_opportunity_queue", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  if (!parsed.success) return fail("validation_failed", "Parâmetros inválidos.", 422, { requestId });
  const ctx = ctxDaRota(authz);
  const [itens, candidatos, modo] = await Promise.all([fila(ctx, parsed.data.pipeline_id), elegiveis(ctx), getSetting(ctx, "crm.distribution")]);
  return ok(
    { mode: modo, queue_size: itens.length, eligible: candidatos.map((c) => ({ user_id: c.userId, open: c.currentLoad })), items: itens },
    { requestId },
  );
}
