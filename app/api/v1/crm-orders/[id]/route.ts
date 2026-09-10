import { z } from "zod";
import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { ORDER_DETAIL_COLUMNS, presentOrder } from "../_read";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = getRequestId(_req);
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success)
    return fail("validation_failed", "Identificador inválido.", 422, { requestId });
  const authz = await requireRole("viewer", { requestId, resource: "crm_orders" });
  if (!authz.ok) return authz.response;
  const db = await createClient();
  const { data, error } = await db
    .from("crm_orders")
    .select(ORDER_DETAIL_COLUMNS)
    .eq("organization_id", authz.org.orgId)
    .eq("id", parsed.data)
    .maybeSingle();
  if (error)
    return fail("internal_error", "Não foi possível carregar o pedido.", 500, { requestId });
  if (!data) return fail("not_found", "Pedido não encontrado.", 404, { requestId });
  try {
    return ok(presentOrder(data), { requestId });
  } catch {
    return fail("internal_error", "Não foi possível apresentar o pedido.", 500, { requestId });
  }
}
