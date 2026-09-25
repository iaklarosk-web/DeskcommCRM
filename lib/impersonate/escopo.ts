/**
 * ESCOPO do acompanhamento (F11-T02, ADR-030 §4) — módulo PURO, sem
 * `next/headers` nem Supabase, porque o diálogo do administrador (client
 * component) precisa do enum e o guarda de rota (servidor) precisa de
 * `rotaNoEscopo`. `lib/impersonate/support.ts` reexporta os dois.
 * Espelho do CHECK `platform_support_sessions_scope_check` (9024).
 */
export const ESCOPOS_DO_SUPORTE = ["all", "inbox", "crm", "settings", "billing"] as const;
export type EscopoDoSuporte = (typeof ESCOPOS_DO_SUPORTE)[number];

/**
 * Prefixos de rota que cada escopo alcança (ADR-030 §4). `all` alcança tudo
 * (só leitura); rota fora do escopo é 403 `support_scope`. Rotas de sessão e
 * de saída do acompanhamento ficam sempre abertas — a pessoa precisa conseguir
 * sair.
 */
const ROTAS_POR_ESCOPO: Readonly<Record<Exclude<EscopoDoSuporte, "all">, readonly string[]>> = {
  inbox: ["/api/v1/inbox/", "/api/v1/conversations/", "/api/v1/messages/", "/api/v1/realtime/"],
  crm: ["/api/v1/contacts/", "/api/v1/contacts", "/api/v1/crm/", "/api/v1/catalog/", "/api/v1/companies/"],
  settings: ["/api/v1/settings/", "/api/v1/team", "/api/v1/team/"],
  billing: ["/api/v1/billing/"],
};
const SEMPRE_NO_ESCOPO = ["/api/v1/auth/", "/api/v1/admin/impersonate/end", "/api/v1/organizations/switch"];

export function rotaNoEscopo(scope: EscopoDoSuporte, caminho: string | null): boolean {
  if (scope === "all" || caminho === null) return true;
  if (SEMPRE_NO_ESCOPO.some((p) => caminho.startsWith(p))) return true;
  return ROTAS_POR_ESCOPO[scope].some((p) => caminho === p || caminho.startsWith(p));
}

