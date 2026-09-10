"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

type Company = { id: string; legal_name: string };
export type OrderCompanySnapshot = { id: string; name: string };

interface Props {
  suggestedCompanyId: string | null;
  company: OrderCompanySnapshot | null;
  onCompanyChange: (company: OrderCompanySnapshot | null) => void;
  channel: string;
  onChannelChange: (channel: string) => void;
  disabled: boolean;
}

/** Nunca grava a sugestão automaticamente; a escolha copia o nome naquele momento. */
export function OrderCommercialFields({
  suggestedCompanyId,
  company,
  onCompanyChange,
  channel,
  onChannelChange,
  disabled,
}: Props) {
  const t = useT();
  const { activeOrg } = useAuth();
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  React.useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  const suggestion = useQuery({
    queryKey: [
      "order-company-suggestion",
      activeOrg?.orgId,
      suggestedCompanyId,
    ],
    enabled: Boolean(activeOrg && suggestedCompanyId),
    retry: false,
    queryFn: ({ signal }) =>
      apiClient.get<{ data: Company }>(
        `/api/v1/companies/${suggestedCompanyId}`,
        { signal },
      ),
  });
  const results = useQuery({
    queryKey: ["order-company-search", activeOrg?.orgId, search],
    enabled: Boolean(activeOrg) && search.length >= 2,
    retry: false,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ search, page: "1", limit: "50" });
      return apiClient.get<{ data: Company[]; meta?: { has_more?: boolean } }>(
        `/api/v1/companies?${params}`,
        { signal },
      );
    },
  });
  const suggested = !suggestion.isError ? suggestion.data?.data : null;
  const searching = searchInput.trim() !== search || results.isFetching;

  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">
        {t("Empresa e canal do pedido")}
      </legend>
      <p className="text-sm text-muted-foreground">
        {t(
          "Empresa e canal são opcionais. O nome escolhido fica registrado neste pedido.",
        )}
      </p>
      {suggestedCompanyId &&
        (suggestion.isError ? (
          <div>
            <p role="alert">
              {t("Não foi possível carregar a empresa vinculada.")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void suggestion.refetch()}
            >
              {t("Recarregar empresa do contato")}
            </Button>
          </div>
        ) : suggested ? (
          <div className="space-y-1 text-sm">
            <p>
              {t("Sugestão do cadastro do contato")}: {suggested.legal_name}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onCompanyChange({
                  id: suggested.id,
                  name: suggested.legal_name,
                })
              }
            >
              {t("Usar empresa do contato")}
            </Button>
          </div>
        ) : (
          <p role="status">{t("Carregando empresa…")}</p>
        ))}
      <label className="grid gap-1 text-sm">
        {t("Buscar empresa por razão social")}
        <Input
          type="search"
          value={searchInput}
          placeholder={t("Digite ao menos 2 letras")}
          onChange={(event) => setSearchInput(event.target.value)}
        />
      </label>
      {searchInput.trim().length >= 2 &&
        (searching ? (
          <p role="status">{t("Buscando empresas…")}</p>
        ) : results.isError ? (
          <div>
            <p role="alert">{t("Não foi possível buscar empresas.")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void results.refetch()}
            >
              {t("Tentar novamente")}
            </Button>
          </div>
        ) : results.data?.data.length === 0 ? (
          <p>{t("Nenhuma empresa encontrada.")}</p>
        ) : (
          <ul aria-label={t("Resultados de empresas")}>
            {results.data?.data.map((option) => (
              <li key={option.id}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    onCompanyChange({ id: option.id, name: option.legal_name });
                    setSearchInput("");
                  }}
                >
                  {option.legal_name}
                </Button>
              </li>
            ))}
            {results.data?.meta?.has_more && (
              <li className="text-sm">
                {t("Há mais empresas. Refine a busca pela razão social.")}
              </li>
            )}
          </ul>
        ))}
      {company ? (
        <div className="space-y-2">
          <label className="grid gap-1 text-sm">
            {t("Nome da empresa no pedido")}
            <Input
              value={company.name}
              maxLength={200}
              onChange={(event) =>
                onCompanyChange({ ...company, name: event.target.value })
              }
            />
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onCompanyChange(null)}
          >
            {t("Remover empresa do pedido")}
          </Button>
        </div>
      ) : (
        <p className="text-sm">{t("Pedido sem empresa selecionada.")}</p>
      )}
      <label className="grid gap-1 text-sm">
        {t("Canal declarado (opcional)")}
        <Input
          value={channel}
          maxLength={64}
          onChange={(event) => onChannelChange(event.target.value)}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {t("Informe o canal combinado. Deixe em branco se não souber.")}
      </p>
    </fieldset>
  );
}
