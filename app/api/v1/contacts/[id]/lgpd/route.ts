/**
 * POST /api/v1/contacts/[id]/lgpd — F06-T03, LGPD mínima (§5.18, §7.7).
 *
 * Corpo: `{ "action": "export" | "delete" }`. Só o `tenant_admin` (papel
 * `admin`, ADR-003). A rota não sabe apagar nem exportar: ela chama o catálogo
 * (`execute`, D17), que audita todo desfecho em `audit_events` com
 * `resource_type=contacts` e o id do contato. Recusa do catálogo vira 403
 * com o motivo em enum; contato inexistente vira 404.
 *
 * O caminho de exclusão é IRREVERSÍVEL por desenho: nada aqui pede
 * confirmação porque o executor é humano (D33 não confirma humano) — a
 * confirmação é da tela que chama, não do servidor.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { execute } from "@/src/actions";
import type { TenantCtx } from "@/src/tenant-context";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({ action: z.enum(["export", "delete"]) });
const ACOES = { export: "export_customer_data", delete: "delete_customer_data" } as const;

export async function POST(req: NextRequest, contexto: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = getRequestId(req);
  const authz = await requireRole("admin", { requestId, resource: "contacts", allowPlatformAdmin: false });
  if (!authz.ok) return authz.response;

  const { id } = await contexto.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("validation_failed", "Identificador do contato inválido.", 422, { requestId });
  }
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) {
    return fail("validation_failed", "Informe action: export ou delete.", 422, { requestId });
  }

  const ctx: TenantCtx = { organization_id: authz.org.orgId, user_id: authz.user.id, role: authz.org.role, source: "session" };
  const resultado = await execute(ctx, { kind: "human", user_id: authz.user.id }, ACOES[corpo.data.action], { contact_id: id }, { requestId });

  if (resultado.status === "denied") {
    const naoExiste = resultado.detalhe === "contact_not_found";
    return fail(naoExiste ? "not_found" : "forbidden", naoExiste ? "Contato não encontrado." : `Ação recusada: ${resultado.reason}.`, naoExiste ? 404 : 403, { requestId });
  }
  if (resultado.status !== "executed") {
    return fail("conflict", "A ação ficou pendente, o que não é esperado para executor humano.", 409, { requestId });
  }
  return ok(resultado.output, { requestId });
}
