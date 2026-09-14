/**
 * Os NOMES do catálogo (§5.8), sem importar o catálogo.
 *
 * Existe por causa de um ciclo que custou um gate (f15-gate-01): o validador
 * de `tenant_settings` (`tenant-config/validators.ts`) precisa saber quais
 * nomes a chave `actions.policy` aceita; importar `catalog.ts` para isso
 * arrasta `conversation` → `settings` → `lib/env`, que valida o ambiente
 * inteiro na carga — e o CLI `scripts/create-tenant.ts` (ADR-029 §3) roda só
 * com `SUPABASE_DB_URL`. A lista aqui é a afirmação; `tests/unit/f15-t01-
 * politica-por-acao.test.ts` confere que ela é IGUAL aos nomes de
 * `ACTION_CATALOG` — desvio é vermelho, não silêncio.
 */
export const NOMES_DO_CATALOGO = [
  "get_customer",
  "search_products",
  "get_orders",
  "create_order",
  "update_order_quantity",
  "create_task",
  "transfer_to_human",
  "request_confirmation",
  "send_message",
  "resume_ai",
  "export_customer_data",
  "assign_owner",
  "delete_customer_data",
] as const;

export const MODOS_DA_POLITICA = ["allow", "approve", "block", "transfer"] as const;
export type ModoDaPolitica = (typeof MODOS_DA_POLITICA)[number];

/**
 * Validador do tipo `action_policy` de `tenant_settings`: objeto cujas chaves
 * são nomes do catálogo e cujos valores são um dos quatro modos. Devolve
 * `null` quando serve, ou uma frase de gente (padrão de `validators.ts`).
 */
export function validarPolitica(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "esperava objeto {<ação do catálogo>: allow|approve|block|transfer}";
  }
  for (const [nome, modo] of Object.entries(value as Record<string, unknown>)) {
    if (!(NOMES_DO_CATALOGO as readonly string[]).includes(nome)) return `ação fora do catálogo: ${nome}`;
    if (typeof modo !== "string" || !(MODOS_DA_POLITICA as readonly string[]).includes(modo)) {
      return `${nome}: esperava um de: ${MODOS_DA_POLITICA.join(", ")}`;
    }
  }
  return null;
}
