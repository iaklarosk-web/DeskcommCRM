"use client";

import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/types";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/lib/i18n/IdiomaProvider";

import { CompanyForm } from "./_form";
import {
  companyBody,
  EMPTY_COMPANY,
  type Company,
  type CompanyDraft,
  type CompanyListResponse,
} from "./_types";

const LIMIT = 50;

function draftFrom(company: Company): CompanyDraft {
  return {
    legal_name: company.legal_name,
    trade_name: company.trade_name ?? "",
    cnpj: company.cnpj ?? "",
  };
}

export function CompaniesClient({ podeEditar }: { podeEditar: boolean }) {
  const t = useT();
  const [companies, setCompanies] = React.useState<Company[]>([]);
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [total, setTotal] = React.useState<number | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [form, setForm] = React.useState<"new" | Company | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState<Company | null>(null);
  const [refresh, setRefresh] = React.useState(0);
  const activeRequest = React.useRef<AbortController | null>(null);

  const load = React.useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
      });
      if (search.trim()) params.set("search", search.trim());
      const response = await apiClient.get<CompanyListResponse>(`/api/v1/companies?${params}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setCompanies(response.data);
      setTotal(response.meta?.total ?? null);
      setHasMore(response.meta?.has_more ?? false);
    } catch {
      if (controller.signal.aborted) return;
      setError(true);
      setCompanies([]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [page, search]);

  React.useEffect(() => {
    void load();
    return () => activeRequest.current?.abort();
  }, [load, refresh]);

  function buscar(value: string) {
    setSearch(value);
    setPage(1);
  }

  async function save(draft: CompanyDraft) {
    setSaving(true);
    try {
      const body = companyBody(draft);
      if (form === "new") {
        await apiClient.post("/api/v1/companies", body);
        toast.success(t("Empresa cadastrada."));
      } else if (form) {
        await apiClient.patch(`/api/v1/companies/${form.id}`, body);
        toast.success(t("Empresa atualizada."));
      }
      setForm(null);
      setRefresh((value) => value + 1);
    } catch (cause) {
      showApiError(cause);
    } finally {
      setSaving(false);
    }
  }

  async function remove(company: Company) {
    setDeleting(company);
    try {
      await apiClient.delete(`/api/v1/companies/${company.id}`);
      toast.success(t("Empresa excluída."));
      setRefresh((value) => value + 1);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        toast.error(
          t("Não é possível excluir: esta empresa possui clientes ou pedidos vinculados."),
        );
      } else {
        showApiError(cause);
      }
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-6" data-testid="tela-empresas">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("Empresas clientes")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Organize as empresas atendidas pela sua equipe.")}
          </p>
        </div>
        {podeEditar ? (
          <Button
            disabled={saving || deleting !== null}
            onClick={() => setForm("new")}
            data-testid="nova-empresa"
          >
            {t("Nova empresa")}
          </Button>
        ) : null}
      </header>

      <div className="mb-4 flex gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => buscar(event.target.value)}
          placeholder={t("Buscar por razão social")}
          className="h-9 w-full max-w-sm rounded-md border px-3 text-sm"
          data-testid="busca-empresa"
        />
      </div>

      {form && podeEditar ? (
        <div className="mb-5">
          <CompanyForm
            initial={form === "new" ? EMPTY_COMPANY : draftFrom(form)}
            saving={saving}
            title={form === "new" ? t("Nova empresa") : t("Editar empresa")}
            submitLabel={form === "new" ? t("Cadastrar empresa") : t("Salvar alterações")}
            onCancel={() => setForm(null)}
            onSubmit={(draft) => void save(draft)}
          />
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-2" data-testid="empresas-carregando">
          {[1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-16 w-full" />
          ))}
        </div>
      ) : error ? (
        <section className="rounded-lg border p-8 text-center" data-testid="empresas-erro">
          <p className="font-medium">{t("Não foi possível carregar as empresas.")}</p>
          <Button className="mt-3" variant="outline" onClick={() => void load()}>
            {t("Tentar novamente")}
          </Button>
        </section>
      ) : companies.length === 0 ? (
        <section
          className="rounded-lg border border-dashed p-8 text-center"
          data-testid="empresas-vazio"
        >
          <p className="font-medium">{t("Nenhuma empresa cliente encontrada.")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {search
              ? t("Tente outra razão social.")
              : t("Cadastre uma empresa para organizar seus clientes.")}
          </p>
        </section>
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="lista-empresas">
          {companies.map((company) => (
            <li
              key={company.id}
              className="flex items-center gap-4 p-4"
              data-testid={`empresa-${company.id}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{company.legal_name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {company.trade_name ?? t("Sem nome de fantasia")}
                  {company.cnpj ? ` · ${t("CNPJ")} ${company.cnpj}` : ""}
                </p>
              </div>
              {podeEditar ? (
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={saving || deleting !== null}
                    onClick={() => setForm(company)}
                  >
                    {t("Editar")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={saving || deleting !== null}
                    onClick={() => void remove(company)}
                  >
                    {deleting?.id === company.id ? t("Excluindo…") : t("Excluir")}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && (page > 1 || hasMore) ? (
        <nav
          className="mt-4 flex items-center justify-between"
          aria-label={t("Paginação de empresas")}
        >
          <Button
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage((value) => value - 1)}
          >
            {t("Anterior")}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t("Página")} {page}
            {total !== null ? ` ${t("de")} ${Math.max(1, Math.ceil(total / LIMIT))}` : ""}
          </span>
          <Button
            variant="outline"
            disabled={!hasMore}
            onClick={() => setPage((value) => value + 1)}
          >
            {t("Próxima")}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
