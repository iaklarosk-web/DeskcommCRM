import { z } from "zod";
import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { decodeWorkCursor, workListSchema, workPage } from "@/src/crm/work/api";

export const dynamic = "force-dynamic";
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = getRequestId(req);
  const id = z.uuid().safeParse((await ctx.params).id);
  const parsed = workListSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!id.success || !parsed.success)
    return fail("validation_failed", "Parâmetros inválidos.", 422, {
      requestId,
    });
  const cursor = parsed.data.cursor ? decodeWorkCursor(parsed.data.cursor) : null;
  if (parsed.data.cursor && !cursor)
    return fail("validation_failed", "Página inválida.", 422, { requestId });
  const authz = await requireRole("viewer", {
    requestId,
    resource: "crm_tasks",
  });
  if (!authz.ok) return authz.response;
  const db = await createClient();
  const order = await db
    .from("crm_orders")
    .select("id")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id.data)
    .maybeSingle();
  if (order.error)
    return fail("internal_error", "Não foi possível consultar o pedido.", 500, {
      requestId,
    });
  if (!order.data) return fail("not_found", "Pedido não encontrado.", 404, { requestId });
  let query = db
    .from("crm_tasks")
    .select(
      "id,order_id,contact_id,title,description,due_date,priority,status,assigned_to,created_by,created_at,updated_at,revision",
    )
    .eq("organization_id", authz.org.orgId)
    .eq("order_id", id.data)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(parsed.data.limit + 1);
  if (cursor)
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  const result = await query;
  if (result.error)
    return fail("internal_error", "Não foi possível listar as tarefas.", 500, {
      requestId,
    });
  const page = workPage(result.data ?? [], parsed.data.limit);
  return ok(page.data, { requestId, meta: page.meta });
}
