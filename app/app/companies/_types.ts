export interface Company {
  id: string;
  legal_name: string;
  trade_name: string | null;
  cnpj: string | null;
  /** F13-T01: valores dos campos configuráveis (definições em crm.fields.companies). */
  custom_fields?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CompanyListResponse {
  data: Company[];
  meta?: { total?: number | null; page?: number; limit?: number; has_more?: boolean };
}

export interface CompanyDraft {
  legal_name: string;
  trade_name: string;
  cnpj: string;
  custom_fields: Record<string, unknown>;
}

export const EMPTY_COMPANY: CompanyDraft = { legal_name: "", trade_name: "", cnpj: "", custom_fields: {} };

export function companyBody(draft: CompanyDraft) {
  return {
    legal_name: draft.legal_name.trim(),
    trade_name: draft.trade_name.trim() || null,
    cnpj: draft.cnpj.trim() || null,
    custom_fields: draft.custom_fields,
  };
}
