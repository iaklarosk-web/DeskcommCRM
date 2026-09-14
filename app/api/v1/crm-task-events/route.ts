import { z } from "zod";
import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { decodeWorkCursor, workListSchema, workPage } from "@/src/crm/work/api";

export const dynamic = "force-dynamic";
const querySchema = workListSchema.extend({
  contact_id: z.uuid().transform((id) => id.toLowerCase()),
  order_id: z
    .uuid()
    .transform((id) => id.toLowerCase())
    .optional(),
});

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success)
    return fail("validation_failed", "Parâmetros inválidos.", 422, {
      requestId,
    });
  const cursor = parsed.data.cursor ? decodeWorkCursor(parsed.data.cursor) : null;
  if (parsed.data.cursor && !cursor)
    return fail("validation_failed", "Página inválida.", 422, { requestId });
  const authz = await requireRole("viewer", {
    requestId,
    resource: "crm_task_events",
  });
  if (!authz.ok) return authz.response;
  const db = await createClient();
  const org = authz.org.orgId;
  const contact = await db
    .from("contacts")
    .select("id")
    .eq("organization_id", org)
    .eq("id", parsed.data.contact_id)
    .maybeSingle();
  if (contact.error)
    return fail("internal_error", "Não foi possível consultar o cliente.", 500, { requestId });
  if (!contact.data) return fail("not_found", "Cliente não encontrado.", 404, { requestId });
  if (parsed.data.order_id) {
    const order = await db
      .from("crm_orders")
      .select("id")
      .eq("organization_id", org)
      .eq("id", parsed.data.order_id)
      .eq("contact_id", parsed.data.contact_id)
      .maybeSingle();
    if (order.error)
      return fail("internal_error", "Não foi possível consultar o pedido.", 500, { requestId });
    if (!order.data)
      return fail("not_found", "Pedido não encontrado para este cliente.", 404, { requestId });
  }
  let query = db
    .from("crm_task_events")
    .select(
      "id,task_id,order_id,contact_id,task_revision,event_type,from_status,to_status,actor_type,actor_id,created_at",
    )
    .eq("organization_id", org)
    .eq("contact_id", parsed.data.contact_id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(parsed.data.limit + 1);
  if (parsed.data.order_id) query = query.eq("order_id", parsed.data.order_id);
  if (cursor)
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  const result = await query;
  if (result.error)
    return fail("internal_error", "Não foi possível carregar o histórico de tarefas.", 500, {
      requestId,
    });
  const page = workPage(result.data ?? [], parsed.data.limit);
  return ok(page.data, { requestId, meta: page.meta });
}
