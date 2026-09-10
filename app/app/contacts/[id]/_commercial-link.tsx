"use client";

import Link from "next/link";
import * as React from "react";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiError, type ApiSuccess } from "@/lib/api/types";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/lib/i18n/IdiomaProvider";

type Company = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  cnpj: string | null;
};
type CompanyList = ApiSuccess<Company[]>;

interface Props {
  contactId: string;
  companyId: string | null;
  recurring: boolean;
  podeEditar: boolean;
  onSaved: () => void;
}

/** Vínculo opcional: consulta a empresa atual por id, nunca pela primeira página. */
export function CommercialLink({ contactId, companyId, recurring, podeEditar, onSaved }: Props) {
  const t = useT();
  const [selectedId, setSelectedId] = React.useState(companyId);
  const [selected, setSelected] = React.useState<Company | null>(null);
  const [search, setSearch] = React.useState("");
  const [results, setResults] = React.useState<Company[]>([]);
  const [loadingCompany, setLoadingCompany] = React.useState(Boolean(companyId));
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false);
  const [searchAttempt, setSearchAttempt] = React.useState(0);
  const [recurringValue, setRecurringValue] = React.useState(recurring);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  React.useEffect(() => {
    setSelectedId(companyId);
    setRecurringValue(recurring);
    if (!companyId) {
      setSelected(null);
      setLoadingCompany(false);
      return;
    }
    let active = true;
    setLoadingCompany(true);
    void apiClient
      .get<ApiSuccess<Company>>(`/api/v1/companies/${companyId}`)
      .then((response) => {
        if (active) setSelected(response.data);
      })
      .catch(() => {
        if (active) setSelected(null);
      })
      .finally(() => {
        if (active) setLoadingCompany(false);
      });
    return () => {
      active = false;
    };
  }, [contactId, companyId, recurring]);

  React.useEffect(() => {
    if (search.trim().length < 2) {
      setResults([]);
      setSearching(false);
      setSearchError(false);
      setHasMore(false);
      return;
    }
    let active = true;
    setSearching(true);
    setSearchError(false);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        search: search.trim(),
        page: "1",
        limit: "50",
      });
      void apiClient
        .get<CompanyList>(`/api/v1/companies?${params}`)
        .then((response) => {
          if (!active) return;
          setResults(response.data);
          setHasMore(response.meta?.has_more === true);
        })
        .catch(() => {
          if (!active) return;
          setResults([]);
          setHasMore(false);
          setSearchError(true);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search, searchAttempt]);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      await apiClient.patch(`/api/v1/contacts/${contactId}`, {
        company_id: selectedId,
        recurring: recurringValue,
      });
      setStatus("Vínculo comercial atualizado.");
      onSaved();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 422) {
        setStatus("Não foi possível usar esta empresa. Escolha outra e tente novamente.");
      } else {
        setStatus("Não foi possível salvar o vínculo comercial.");
        showApiError(cause);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4" data-testid="vinculo-comercial">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t("Vínculo comercial")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Empresa cliente e recorrência deste contato.")}
          </p>
        </div>
        {!selectedId && (
          <Link className="text-sm underline" href="/app/companies">
            {t("Abrir empresas clientes")}
          </Link>
        )}
      </div>

      <div className="mt-4 space-y-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground uppercase">{t("Empresa")}</p>
          {loadingCompany ? (
            <p className="mt-1">{t("Carregando empresa…")}</p>
          ) : selected ? (
            <p className="mt-1 font-medium" data-testid="empresa-vinculada">
              {selected.legal_name}
            </p>
          ) : selectedId ? (
            <p className="mt-1 text-error-fg">
              {t("Não foi possível carregar a empresa vinculada.")}
            </p>
          ) : (
            <p className="mt-1">{t("Nenhuma empresa vinculada.")}</p>
          )}
        </div>

        {podeEditar ? (
          <>
            <label className="block">
              {t("Buscar empresa por razão social")}
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                disabled={saving}
                className="mt-1 h-9 w-full rounded-md border px-3"
                placeholder={t("Digite ao menos 2 letras")}
                data-testid="buscar-empresa-vinculo"
              />
            </label>
            {searching ? (
              <p className="text-muted-foreground">{t("Buscando empresas…")}</p>
            ) : searchError ? (
              <p role="alert" className="text-error-fg">
                {t("Não foi possível buscar empresas.")}{" "}
                <button
                  type="button"
                  className="underline"
                  disabled={saving}
                  onClick={() => setSearchAttempt((value) => value + 1)}
                >
                  {t("Tentar novamente")}
                </button>
              </p>
            ) : results.length > 0 ? (
              <ul
                className="max-h-40 divide-y overflow-auto rounded-md border"
                data-testid="resultados-empresas"
              >
                {results.map((company) => (
                  <li key={company.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left hover:bg-muted"
                      disabled={saving}
                      onClick={() => {
                        setSelectedId(company.id);
                        setSelected(company);
                        setSearch("");
                        setResults([]);
                        setHasMore(false);
                      }}
                    >
                      {company.legal_name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : search.trim().length >= 2 ? (
              <p className="text-muted-foreground">{t("Nenhuma empresa encontrada.")}</p>
            ) : null}
            {hasMore && !searching && !searchError ? (
              <p className="text-muted-foreground">
                {t("Há mais resultados. Refine a busca por razão social.")}
              </p>
            ) : null}
            {selectedId ? (
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setSelectedId(null);
                  setSelected(null);
                }}
              >
                {t("Desvincular empresa")}
              </Button>
            ) : null}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={recurringValue}
                disabled={saving}
                onChange={(event) => setRecurringValue(event.target.checked)}
                data-testid="contato-recorrente"
              />
              {t("Cliente recorrente")}
            </label>
            <Button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              data-testid="salvar-vinculo-comercial"
            >
              {saving ? t("Salvando…") : t("Salvar vínculo comercial")}
            </Button>
          </>
        ) : (
          <p>{recurringValue ? t("Cliente recorrente.") : t("Cliente sem recorrência marcada.")}</p>
        )}
        {status ? (
          <p role="status" className="text-sm">
            {t(status)}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
