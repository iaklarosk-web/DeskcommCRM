"use client";
/**
 * F13-T01 (ADR-034 §2) — as definições de campo por ORGANIZAÇÃO
 * (`/api/v1/settings/crm-fields`). Quem edita contato ou empresa lê daqui; o
 * contato ainda soma as definições do funil padrão (herdadas), porque o valor
 * das duas listas mora na mesma coluna `contacts.custom_fields`.
 */
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { CustomFieldDef } from "@/lib/schemas/settings";

export interface CrmFieldsData {
  contacts: CustomFieldDef[];
  companies: CustomFieldDef[];
}

export function useCrmFields(enabled = true) {
  return useQuery({
    queryKey: ["crm-fields"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<CrmFieldsData> => {
      const res = await apiClient.get<{ data: CrmFieldsData }>("/api/v1/settings/crm-fields");
      return res.data;
    },
  });
}

/** Funil primeiro, organização depois; chave repetida fica com a do funil. */
export function unirDefinicoes(doFunil: CustomFieldDef[], daOrganizacao: CustomFieldDef[]): CustomFieldDef[] {
  const vistas = new Set(doFunil.map((f) => f.key));
  return [...doFunil, ...daOrganizacao.filter((f) => !vistas.has(f.key))];
}
