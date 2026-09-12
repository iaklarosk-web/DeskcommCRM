import { requireSupportWrite } from "@/lib/impersonate/support";
import { getRequestId } from "@/lib/api/request-id";
/**
 * GET  /api/v1/products — o catálogo da organização ativa.
 * POST /api/v1/products — cadastra um produto.
 *
 * Escrita exige `manager`: preço de venda não se altera com papel de leitura, e
 * é o motivo de este catálogo não morar na tabela da Nuvemshop, cuja policy é
 * org-flat sem checagem de papel.
 */
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { catalogQuerySchema, listCatalogPage } from "@/lib/catalogo/listar";
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";
import { COLUNAS_DO_PRODUTO, produtoCreateSchema } from "@/lib/schemas/produtos";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = getRequestId(req);
  const authz = await requireRole("viewer", {
    requestId,
    resource: "catalog_products",
  });
  if (!authz.ok) return authz.response;

  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const params = req.nextUrl.searchParams;
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) {
    return fail("validation_failed", t("Filtros inválidos."), 422, {
      requestId,
    });
  }
  const parsed = catalogQuerySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success)
    return fail("validation_failed", t("Filtros inválidos."), 422, {
      requestId,
    });
  const supabase = await createClient();
  const { data, error, count } = await listCatalogPage(supabase, authz.org.orgId, parsed.data);
  if (error || count === null)
    return fail("internal_error", t("Erro ao listar os produtos."), 500, {
      requestId,
    });
  const { page, limit } = parsed.data;
  return ok(data ?? [], {
    requestId,
    meta: { page, limit, total: count, has_more: page * limit < count },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = getRequestId(req);
  const authz = await requireRole("manager", {
    requestId,
    resource: "catalog_products",
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = produtoCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();
  // A moeda vem da organização, nunca do corpo — ver `moedaDaOrganizacao()`.
  const moeda = await moedaDaOrganizacao(supabase, authz.org.orgId);
  const { data, error } = await supabase
    .from("catalog_products")
    .insert({
      ...parsed.data,
      moeda,
      organization_id: authz.org.orgId,
      origem: "manual",
    })
    .select(COLUNAS_DO_PRODUTO)
    .single();

  if (error) {
    // 23505 = já existe produto com este código nesta organização. A recusa
    // nomeia o campo porque quem lê é quem digitou.
    if (error.code === "23505") {
      return fail("conflict", t("Já existe um produto com esse código."), 409, {
        requestId,
      });
    }
    return fail("internal_error", "Erro ao salvar o produto.", 500, {
      requestId,
    });
  }

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "catalog_product.created",
    resourceType: "catalog_products",
    resourceId: (data as unknown as { id: string }).id,
    requestId,
  });

  return ok(data, { requestId, status: 201 });
}
