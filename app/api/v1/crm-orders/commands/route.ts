import { fail, ok } from "@/lib/api/wrappers";
import { getRequestId } from "@/lib/api/request-id";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { OrderAuthorizationError } from "@/src/crm/orders/authorization";
import { orderCommandSchema } from "@/src/crm/orders/commands";
import { OrderQuantityError } from "@/src/crm/orders/quantities";
import { executeOrderCommand, OrderServiceError } from "@/src/crm/orders/service";
import { OrderCommandError } from "@/src/crm/orders/state";

export const dynamic = "force-dynamic";

const messages: Record<string, string> = {
  order_not_found: "Pedido não encontrado.",
  order_incomplete: "Resolva as pendências antes de confirmar ou alterar este pedido.",
  idempotency_conflict: "Esta solicitação já foi usada com outros dados. Recarregue o pedido.",
  revision_conflict: "O pedido foi alterado por outra pessoa. Recarregue e confira as mudanças.",
  illegal_transition: "Esta mudança de situação não está disponível para o pedido.",
  order_terminal: "Pedidos entregues ou cancelados não podem ser editados.",
  duplicate_item: "Há itens ou posições repetidos no pedido.",
  contact_change_not_allowed:
    "O cliente do pedido não pode ser trocado. Cancele e crie outro pedido para corrigir.",
  contact_unavailable: "Escolha um cliente disponível nesta empresa.",
  company_unavailable: "Escolha uma empresa cliente disponível.",
  product_unavailable: "Um produto não está disponível nesta empresa.",
  order_redacted: "Os dados deste pedido foram anonimizados.",
};

export async function POST(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const parsed = orderCommandSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_failed", "Dados do pedido inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors,
    });
  const authz = await requireRole("agent", { requestId, resource: "crm_orders" });
  if (!authz.ok) return authz.response;
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  // O TenantContext desta fase não representa autoridade de suporte.
  // Mesmo suporte full não se transforma em membership/executor comum.
  if (authz.user.support)
    return fail(
      "forbidden",
      "Pedidos não podem ser alterados durante acompanhamento de suporte.",
      403,
      { requestId },
    );
  try {
    const result = await executeOrderCommand(
      {
        organization_id: authz.org.orgId,
        user_id: authz.user.id,
        role: authz.org.role,
        source: "session",
      },
      { type: "human", user_id: authz.user.id },
      parsed.data,
      { requestId },
    );
    return ok(result.order, {
      requestId,
      status: parsed.data.command === "create_draft" && !result.replayed ? 201 : 200,
      meta: { replayed: result.replayed },
    });
  } catch (error) {
    if (error instanceof OrderAuthorizationError)
      return fail("forbidden", "Você não tem permissão para alterar este pedido.", 403, {
        requestId,
      });
    if (error instanceof OrderServiceError)
      return fail(
        error.code,
        messages[error.code] ?? "Não foi possível concluir esta operação.",
        error.status,
        { requestId, details: error.details },
      );
    if (error instanceof OrderCommandError)
      return fail(
        error.code,
        messages[error.code] ?? "Operação não permitida.",
        error.code === "executor_denied" ? 403 : 409,
        { requestId },
      );
    if (error instanceof OrderQuantityError)
      return fail("validation_failed", "Revise as quantidades e os valores do pedido.", 422, {
        requestId,
      });
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (["23503", "23514", "23505"].includes(code))
      return fail("conflict", "Os dados vinculados mudaram. Recarregue e confira o pedido.", 409, {
        requestId,
      });
    if (["40P01", "40001"].includes(code))
      return fail(
        "concurrent_operation",
        "Outra operação ocorreu ao mesmo tempo. Confira o pedido e tente novamente.",
        409,
        { requestId },
      );
    logger.error("crm_order_command_failed", { requestId });
    return fail(
      "internal_error",
      "Não foi possível salvar o pedido. Você pode tentar novamente.",
      500,
      { requestId },
    );
  }
}
