"use client";
/**
 * F13-T01 — editor das definições de campo por entidade. Lê e grava pela rota
 * `/api/v1/settings/crm-fields`; a lista é validada no servidor
 * (`validarDefinicoes`), e a tela mostra o motivo quando ela é recusada.
 */
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { useCrmFields, type CrmFieldsData } from "@/hooks/crm/useCrmFields";
import { ApiError } from "@/lib/api/types";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/lib/i18n/IdiomaProvider";
import type { CustomFieldDef } from "@/lib/schemas/settings";

type Entidade = "contacts" | "companies";
const TIPOS: CustomFieldDef["type"][] = ["text", "textarea", "number", "date", "select", "multiselect", "boolean", "email", "phone", "url"];

const RASCUNHO_VAZIO = { key: "", label: "", type: "text" as CustomFieldDef["type"], required: false, options: "" };

export function CrmFieldsClient() {
  const t = useT();
  const queryClient = useQueryClient();
  const consulta = useCrmFields();
  const defs = consulta.data ?? null;
  const erro = consulta.isError;
  const [salvando, setSalvando] = React.useState<Entidade | null>(null);
  const [rascunho, setRascunho] = React.useState<Record<Entidade, typeof RASCUNHO_VAZIO>>({
    contacts: { ...RASCUNHO_VAZIO },
    companies: { ...RASCUNHO_VAZIO },
  });
  const carregar = () => consulta.refetch();

  async function gravar(entidade: Entidade, fields: CustomFieldDef[]) {
    setSalvando(entidade);
    try {
      const r = await apiClient.put<{ data: { fields: CustomFieldDef[] } }>("/api/v1/settings/crm-fields", { entity: entidade, fields });
      queryClient.setQueryData<CrmFieldsData>(["crm-fields"], (atual) => (atual ? { ...atual, [entidade]: r.data.fields } : atual));
      toast.success(t("Campos salvos."));
      return true;
    } catch (e) {
      if (e instanceof ApiError) showApiError(e);
      else toast.error(t("Não foi possível salvar os campos."));
      return false;
    } finally {
      setSalvando(null);
    }
  }

  async function adicionar(entidade: Entidade) {
    if (!defs) return;
    const d = rascunho[entidade];
    const nova: CustomFieldDef = {
      key: d.key.trim(),
      label: d.label.trim(),
      type: d.type,
      required: d.required,
      ...(d.type === "select" || d.type === "multiselect"
        ? { options: d.options.split(",").map((o) => o.trim()).filter(Boolean).map((o) => ({ value: o, label: o })) }
        : {}),
    };
    if (await gravar(entidade, [...defs[entidade], nova])) {
      setRascunho((r) => ({ ...r, [entidade]: { ...RASCUNHO_VAZIO } }));
    }
  }

  async function remover(entidade: Entidade, key: string) {
    if (!defs) return;
    await gravar(entidade, defs[entidade].filter((f) => f.key !== key));
  }

  if (erro) {
    return (
      <div className="rounded-lg border p-4 text-sm" data-testid="crm-fields-erro">
        {t("Não foi possível carregar os campos.")}{" "}
        <Button variant="outline" size="sm" onClick={() => void carregar()}>{t("Tentar de novo")}</Button>
      </div>
    );
  }
  if (!defs) return <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {(["contacts", "companies"] as Entidade[]).map((entidade) => {
        const d = rascunho[entidade];
        const lista = defs[entidade];
        return (
          <section key={entidade} className="rounded-lg border bg-card p-4" data-testid={`crm-fields-${entidade}`}>
            <h2 className="font-medium">{entidade === "contacts" ? t("Contatos") : t("Empresas")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("Campos definidos")}: <span data-testid={`crm-fields-${entidade}-total`}>{lista.length}</span>
            </p>
            <ul className="mt-3 space-y-2">
              {lista.length === 0 ? (
                <li className="text-sm text-muted-foreground">{t("Nenhum campo definido.")}</li>
              ) : (
                lista.map((f) => (
                  <li key={f.key} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm" data-testid={`crm-field-${entidade}-${f.key}`}>
                    <span>
                      <span className="font-medium">{f.label}</span>{" "}
                      <span className="text-muted-foreground">({f.key} · {f.type}{f.required ? ` · ${t("obrigatório")}` : ""})</span>
                    </span>
                    <Button variant="ghost" size="sm" disabled={salvando === entidade} onClick={() => void remover(entidade, f.key)} data-testid={`remover-campo-${entidade}-${f.key}`}>
                      {t("Remover")}
                    </Button>
                  </li>
                ))
              )}
            </ul>
            <form
              className="mt-4 grid gap-2 sm:grid-cols-2"
              data-testid={`novo-campo-${entidade}`}
              onSubmit={(e) => {
                e.preventDefault();
                void adicionar(entidade);
              }}
            >
              <label className="text-sm">
                {t("Chave")}
                <input required pattern="[A-Za-z][A-Za-z0-9_]*" maxLength={40} value={d.key} onChange={(e) => setRascunho((r) => ({ ...r, [entidade]: { ...d, key: e.target.value } }))} className="mt-1 h-9 w-full rounded-md border px-3" data-testid={`novo-campo-${entidade}-key`} />
              </label>
              <label className="text-sm">
                {t("Rótulo")}
                <input required maxLength={80} value={d.label} onChange={(e) => setRascunho((r) => ({ ...r, [entidade]: { ...d, label: e.target.value } }))} className="mt-1 h-9 w-full rounded-md border px-3" data-testid={`novo-campo-${entidade}-label`} />
              </label>
              <label className="text-sm">
                {t("Tipo")}
                <select value={d.type} onChange={(e) => setRascunho((r) => ({ ...r, [entidade]: { ...d, type: e.target.value as CustomFieldDef["type"] } }))} className="mt-1 h-9 w-full rounded-md border px-3" data-testid={`novo-campo-${entidade}-type`}>
                  {TIPOS.map((tipo) => (
                    <option key={tipo} value={tipo}>{tipo}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-end gap-2 text-sm">
                <input type="checkbox" checked={d.required} onChange={(e) => setRascunho((r) => ({ ...r, [entidade]: { ...d, required: e.target.checked } }))} data-testid={`novo-campo-${entidade}-required`} />
                {t("Obrigatório")}
              </label>
              {(d.type === "select" || d.type === "multiselect") && (
                <label className="text-sm sm:col-span-2">
                  {t("Opções (separadas por vírgula)")}
                  <input value={d.options} onChange={(e) => setRascunho((r) => ({ ...r, [entidade]: { ...d, options: e.target.value } }))} className="mt-1 h-9 w-full rounded-md border px-3" data-testid={`novo-campo-${entidade}-options`} />
                </label>
              )}
              <div className="sm:col-span-2">
                <Button type="submit" size="sm" disabled={salvando === entidade} data-testid={`adicionar-campo-${entidade}`}>
                  {salvando === entidade ? t("Salvando…") : t("Adicionar campo")}
                </Button>
              </div>
            </form>
          </section>
        );
      })}
    </div>
  );
}
