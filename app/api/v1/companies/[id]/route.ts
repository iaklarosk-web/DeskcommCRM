import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { companyPatchSchema } from "@/src/crm/companies/schema";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();
const COLUMNS = "id,organization_id,legal_name,trade_name,cnpj,created_at,updated_at";

export async function GET(_req: NextRequest, context: RouteContext): Promise<Response> {
  const requestId = randomUUID();
  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return fail("validation_failed", "Identificador inválido.", 422, { requestId });
  const authz = await requireRole("viewer", { requestId, resource: "crm_companies" });
  if (!authz.ok) return authz.response;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_companies")
    .select(COLUMNS)
    .eq("organization_id", authz.org.orgId)
    .eq("id", id.data)
    .maybeSingle();
  if (error)
    return fail("internal_error", "Não foi possível consultar a empresa.", 500, { requestId });
  if (!data) return fail("not_found", "Empresa não encontrada.", 404, { requestId });
  return ok(data, { requestId });
}

export async function PATCH(req: NextRequest, context: RouteContext): Promise<Response> {
  const requestId = randomUUID();
  const id = idSchema.safeParse((await context.params).id);
  const parsed = companyPatchSchema.safeParse(await req.json().catch(() => null));
  if (!id.success || !parsed.success || Object.keys(parsed.data).length === 0) {
    return fail("validation_failed", "Alteração da empresa inválida.", 422, { requestId });
  }
  const authz = await requireRole("agent", { requestId, resource: "crm_companies" });
  if (!authz.ok) return authz.response;
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_companies")
    .update(parsed.data)
    .eq("organization_id", authz.org.orgId)
    .eq("id", id.data)
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    if (error.code === "23505")
      return fail("conflict", "Já existe uma empresa com esse CNPJ.", 409, { requestId });
    return fail("internal_error", "Não foi possível alterar a empresa.", 500, { requestId });
  }
  if (!data) return fail("not_found", "Empresa não encontrada.", 404, { requestId });
  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "crm_company.updated",
    resourceType: "crm_companies",
    resourceId: data.id,
    requestId,
  });
  return ok(data, { requestId });
}

export async function DELETE(_req: NextRequest, context: RouteContext): Promise<Response> {
  const requestId = randomUUID();
  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return fail("validation_failed", "Identificador inválido.", 422, { requestId });
  const authz = await requireRole("agent", { requestId, resource: "crm_companies" });
  if (!authz.ok) return authz.response;
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_companies")
    .delete()
    .eq("organization_id", authz.org.orgId)
    .eq("id", id.data)
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23503")
      return fail("conflict", "Esta empresa possui clientes ou pedidos vinculados.", 409, {
        requestId,
      });
    return fail("internal_error", "Não foi possível excluir a empresa.", 500, { requestId });
  }
  if (!data) return fail("not_found", "Empresa não encontrada.", 404, { requestId });
  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "crm_company.deleted",
    resourceType: "crm_companies",
    resourceId: data.id,
    requestId,
  });
  return ok({ id: id.data }, { requestId });
}
