import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { companyCreateSchema } from "@/src/crm/companies/schema";

export const dynamic = "force-dynamic";

const querySchema = z
  .object({
    search: z.string().trim().max(200).default(""),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const COLUMNS = "id,organization_id,legal_name,trade_name,cnpj,created_at,updated_at";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return fail("validation_failed", "Filtros inválidos.", 422, { requestId });
  const authz = await requireRole("viewer", { requestId, resource: "crm_companies" });
  if (!authz.ok) return authz.response;
  const { search, page, limit } = parsed.data;
  const supabase = await createClient();
  let query = supabase
    .from("crm_companies")
    .select(COLUMNS, { count: "exact" })
    .eq("organization_id", authz.org.orgId);
  if (search) query = query.ilike("legal_name", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
  const { data, error, count } = await query
    .order("legal_name")
    .order("id")
    .range((page - 1) * limit, page * limit - 1);
  if (error || count === null)
    return fail("internal_error", "Não foi possível listar as empresas.", 500, { requestId });
  return ok(data ?? [], {
    requestId,
    meta: { page, limit, total: count, has_more: count !== null && page * limit < count },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const parsed = companyCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_failed", "Dados da empresa inválidos.", 422, { requestId });
  const authz = await requireRole("agent", { requestId, resource: "crm_companies" });
  if (!authz.ok) return authz.response;
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_companies")
    .insert({ ...parsed.data, organization_id: authz.org.orgId })
    .select(COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505")
      return fail("conflict", "Já existe uma empresa com esse CNPJ.", 409, { requestId });
    return fail("internal_error", "Não foi possível cadastrar a empresa.", 500, { requestId });
  }
  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "crm_company.created",
    resourceType: "crm_companies",
    resourceId: data.id,
    requestId,
  });
  return ok(data, { requestId, status: 201 });
}
