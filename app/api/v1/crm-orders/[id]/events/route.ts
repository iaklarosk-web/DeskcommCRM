import { z } from "zod";
import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const querySchema = z.strictObject({
  // Revisões são únicas por pedido e não dependem da precisão do timestamp.
  before_revision: z.coerce.number().int().min(1).max(2_147_483_647).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** Journal autorizado do pedido, paginado sem copiar eventos de outro domínio. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(req);
  const id = z.uuid().safeParse((await params).id);
  const query = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!id.success || !query.success)
    return fail("validation_failed", "Pedido ou filtros inválidos.", 422, { requestId });
  const authz = await requireRole("viewer", { requestId, resource: "crm_orders" });
  if (!authz.ok) return authz.response;
  const db = await createClient();
  const order = await db
    .from("crm_orders")
    .select("id")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id.data)
    .maybeSingle();
  if (order.error)
    return fail("internal_error", "Não foi possível carregar o histórico.", 500, { requestId });
  if (!order.data) return fail("not_found", "Pedido não encontrado.", 404, { requestId });
  let events = db
    .from("crm_order_events")
    .select("id,order_id,order_revision,event_type,changes,actor_type,actor_id,created_at")
    .eq("organization_id", authz.org.orgId)
    .eq("order_id", id.data)
    .order("order_revision", { ascending: false })
    .limit(query.data.limit + 1);
  if (query.data.before_revision !== undefined)
    events = events.lt("order_revision", query.data.before_revision);
  const { data, error } = await events;
  if (error)
    return fail("internal_error", "Não foi possível carregar o histórico.", 500, { requestId });
  const rows = data ?? [];
  const hasMore = rows.length > query.data.limit;
  const page = rows.slice(0, query.data.limit);
  return ok(page, {
    requestId,
    meta: {
      has_more: hasMore,
      before_revision: hasMore ? (page.at(-1)?.order_revision ?? null) : null,
    },
  });
}
