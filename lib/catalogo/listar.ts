import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/lib/database.types";
import { COLUNAS_DO_PRODUTO } from "@/lib/schemas/produtos";

export const catalogQuerySchema = z
  .object({
    busca: z
      .string()
      .trim()
      .max(200)
      .regex(/^[^\u0000-\u001f\u007f]*$/)
      .default(""),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    // Preserva o tamanho máximo herdado para seletores existentes; a tela usa 50.
    limit: z.coerce.number().int().min(1).max(500).default(500),
  })
  .strict();

/** Substring literal: imatch não converte * em %, ao contrário de ilike no PostgREST.
 * Primeiro escapa a regex PostgreSQL; depois, o valor entre aspas da gramática REST.
 */
export function catalogSearchFilter(search: string): string {
  const pattern = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quoted = `"${pattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return ["nome", "codigo", "marca", "categoria"]
    .map((key) => `${key}.imatch.${quoted}`)
    .join(",");
}

/** Leitor com client de sessão; organizationId deve vir da organização ativa. */
export function listCatalogPage(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  query: z.infer<typeof catalogQuerySchema>,
) {
  let builder = supabase
    .from("catalog_products")
    .select(COLUNAS_DO_PRODUTO, { count: "exact" })
    .eq("organization_id", organizationId);
  if (query.busca) builder = builder.or(catalogSearchFilter(query.busca));
  return builder
    .order("ativo", { ascending: false })
    .order("nome")
    .order("id")
    .range((query.page - 1) * query.limit, query.page * query.limit - 1);
}
