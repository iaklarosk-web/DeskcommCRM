import { z } from "zod";
import { getRequestId } from "@/lib/api/request-id";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { createCrmNoteSchema } from "@/src/crm/work/contracts";
import { createCrmNote } from "@/src/crm/work/service";
import { decodeWorkCursor, workFailure, workListSchema, workPage } from "@/src/crm/work/api";

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
    resource: "crm_notes",
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
    .from("crm_notes")
    .select("id,contact_id,order_id,body,actor_user_id,created_at,redacted_at")
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
    return fail("internal_error", "Não foi possível listar as notas.", 500, {
      requestId,
    });
  const page = workPage(result.data ?? [], parsed.data.limit);
  return ok(page.data, { requestId, meta: page.meta });
}

export async function POST(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  const parsed = createCrmNoteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_failed", "Revise os dados da nota.", 422, {
      requestId,
    });
  const authz = await requireRole("agent", {
    requestId,
    resource: "crm_notes",
  });
  if (!authz.ok) return authz.response;
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  if (authz.user.support)
    return fail(
      "forbidden",
      "Notas não podem ser criadas durante acompanhamento de suporte.",
      403,
      { requestId },
    );
  try {
    const saved = await createCrmNote(
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
    return ok(saved.note, {
      requestId,
      status: saved.replayed ? 200 : 201,
      meta: { replayed: saved.replayed },
    });
  } catch (error) {
    return workFailure(error, requestId);
  }
}
