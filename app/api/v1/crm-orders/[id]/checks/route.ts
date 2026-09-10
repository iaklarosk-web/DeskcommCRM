import { z } from "zod";
import { getRequestId } from "@/lib/api/request-id";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { OrderAuthorizationError } from "@/src/crm/orders/authorization";
import {
  orderCheckCommandSchema,
  orderCheckListQuerySchema,
  orderChecksViewSchema,
} from "@/src/crm/orders/checks-contracts";
import { OrderCheckServiceError, recordOrderCheck } from "@/src/crm/orders/checks-service";

export const dynamic = "force-dynamic";
const orderIdSchema = z.uuid().transform((id) => id.toLowerCase());

const messages: Record<string, string> = {
  order_not_found: "Pedido não encontrado.",
  item_not_found: "Item não encontrado nesta revisão do pedido.",
  revision_conflict: "O pedido mudou. Recarregue antes de conferir.",
  idempotency_conflict: "Esta solicitação já foi usada com outros dados. Recarregue o pedido.",
  ordered_quantity_unavailable:
    "Informe a quantidade pedida antes de registrar uma quantidade conferida.",
  checked_quantity_exceeds_ordered: "A quantidade conferida não pode exceder a quantidade pedida.",
  sale_unit_unavailable: "Informe a unidade de venda antes de registrar uma quantidade conferida.",
  contact_unavailable: "O cliente deste pedido não está disponível.",
};

function commandFailure(error: unknown, requestId: string): Response {
  if (error instanceof OrderAuthorizationError)
    return fail("forbidden", "Você não tem permissão para conferir este pedido.", 403, {
      requestId,
    });
  if (error instanceof OrderCheckServiceError)
    return fail(
      error.code,
      messages[error.code] ?? "Não foi possível registrar a conferência.",
      error.status,
      { requestId },
    );
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (["23503", "23505", "23514", "40001", "40P01"].includes(code))
    return fail(
      "concurrent_operation",
      "Os dados mudaram ao mesmo tempo. Recarregue e tente novamente.",
      409,
      { requestId },
    );
  logger.error("crm_order_check_failed", { requestId });
  return fail("internal_error", "Não foi possível registrar a conferência.", 500, { requestId });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = getRequestId(req);
  const orderId = orderIdSchema.safeParse((await params).id);
  const query = orderCheckListQuerySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!orderId.success || !query.success)
    return fail("validation_failed", "Parâmetros inválidos.", 422, {
      requestId,
    });
  const authz = await requireRole("viewer", {
    requestId,
    resource: "crm_order_checks",
    allowPlatformAdmin: false,
  });
  if (!authz.ok) return authz.response;
  if (authz.user.is_platform_admin && !authz.user.support)
    return fail("forbidden", "A conferência exige vínculo com a organização.", 403, { requestId });
  const db = await createClient();
  const result = await db.rpc("fn_crm_order_checks", {
    p_org: authz.org.orgId,
    p_order: orderId.data,
    p_limit: query.data.limit,
    p_before_sequence: query.data.before_sequence ?? null,
  });
  if (result.error) {
    logger.error("crm_order_checks_read_failed", { requestId });
    return fail("internal_error", "Não foi possível carregar a conferência.", 500, { requestId });
  }
  if (result.data === null) return fail("not_found", "Pedido não encontrado.", 404, { requestId });
  const presented = orderChecksViewSchema.safeParse(result.data);
  if (!presented.success) {
    logger.error("crm_order_checks_shape_invalid", { requestId });
    return fail("internal_error", "Não foi possível apresentar a conferência.", 500, { requestId });
  }
  return ok(presented.data, { requestId });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = getRequestId(req);
  const orderId = orderIdSchema.safeParse((await params).id);
  const command = orderCheckCommandSchema.safeParse(await req.json().catch(() => null));
  if (!orderId.success || !command.success)
    return fail("validation_failed", "Revise os dados da conferência.", 422, {
      requestId,
      details: command.success ? undefined : command.error.flatten().fieldErrors,
    });
  const authz = await requireRole("agent", {
    requestId,
    resource: "crm_order_checks",
    allowPlatformAdmin: false,
  });
  if (!authz.ok) return authz.response;
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  if (authz.user.support)
    return fail(
      "forbidden",
      "Pedidos não podem ser conferidos durante acompanhamento de suporte.",
      403,
      { requestId },
    );
  try {
    const result = await recordOrderCheck(
      {
        organization_id: authz.org.orgId,
        user_id: authz.user.id,
        role: authz.org.role,
        source: "session",
      },
      { type: "human", user_id: authz.user.id },
      orderId.data,
      command.data,
      { requestId },
    );
    return ok(result.check, {
      requestId,
      status: result.replayed ? 200 : 201,
      meta: { replayed: result.replayed },
    });
  } catch (error) {
    return commandFailure(error, requestId);
  }
}
