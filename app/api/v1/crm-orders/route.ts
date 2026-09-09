import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { ORDER_STATUSES } from "@/src/crm/orders/state";
import { ORDER_COLUMNS, presentOrderSummaries } from "./_read";

export const dynamic = "force-dynamic";
const querySchema = z.strictObject({
  status: z.union([z.enum(ORDER_STATUSES), z.literal("")]).optional(),
  delivery_date: z.union([z.iso.date(), z.literal("")]).optional(),
  contact_id: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return fail("validation_failed", "Filtros inválidos.", 422, { requestId });
  const authz = await requireRole("viewer", { requestId, resource: "crm_orders" });
  if (!authz.ok) return authz.response;
  const db = await createClient();
  const { page, limit, status, delivery_date, contact_id } = parsed.data;
  let query = db
    .from("crm_orders")
    .select(`${ORDER_COLUMNS},contact:contacts!crm_orders_contact_tenant_fkey(display_name,name)`, {
      count: "exact",
    })
    .eq("organization_id", authz.org.orgId);
  if (status) query = query.eq("status", status);
  if (delivery_date) query = query.eq("delivery_date", delivery_date);
  if (contact_id) query = query.eq("contact_id", contact_id);
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * limit, page * limit - 1);
  if (error || count === null)
    return fail("internal_error", "Não foi possível listar os pedidos.", 500, { requestId });
  try {
    return ok(presentOrderSummaries(data ?? []), {
      requestId,
      meta: { page, limit, total: count, has_more: page * limit < count },
    });
  } catch {
    return fail("internal_error", "Não foi possível apresentar os pedidos.", 500, { requestId });
  }
}
