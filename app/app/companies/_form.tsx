"use client";

import * as React from "react";

import { CustomFieldsEditor, type CustomFieldDef } from "@/components/contacts/CustomFieldsEditor";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/IdiomaProvider";
import type { CompanyDraft } from "./_types";

interface Props {
  initial: CompanyDraft;
  saving: boolean;
  title: string;
  submitLabel: string;
  /** F13-T01: as definições da organização (crm.fields.companies), lidas pela página no servidor. */
  definicoes?: CustomFieldDef[];
  onCancel: () => void;
  onSubmit: (draft: CompanyDraft) => void;
}

/** Formulário compartilhado por criação e edição; CNPJ fica livre para a máscara. */
export function CompanyForm({ initial, saving, title, submitLabel, definicoes = [], onCancel, onSubmit }: Props) {
  const t = useT();
  const [draft, setDraft] = React.useState(initial);

  React.useEffect(() => setDraft(initial), [initial]);

  return (
    <form
      className="rounded-lg border bg-card p-4"
      data-testid="form-empresa"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      <h2 className="font-medium">{title}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">
          {t("Razão social")}
          <input
            required
            maxLength={200}
            disabled={saving}
            value={draft.legal_name}
            onChange={(event) => setDraft({ ...draft, legal_name: event.target.value })}
            className="mt-1 h-9 w-full rounded-md border px-3"
            data-testid="empresa-razao-social"
          />
        </label>
        <label className="text-sm">
          {t("Nome de fantasia")} <span className="text-muted-foreground">{t("(opcional)")}</span>
          <input
            maxLength={200}
            disabled={saving}
            value={draft.trade_name}
            onChange={(event) => setDraft({ ...draft, trade_name: event.target.value })}
            className="mt-1 h-9 w-full rounded-md border px-3"
            data-testid="empresa-nome-fantasia"
          />
        </label>
        <label className="text-sm">
          {t("CNPJ")} <span className="text-muted-foreground">{t("(opcional)")}</span>
          <input
            maxLength={18}
            disabled={saving}
            value={draft.cnpj}
            onChange={(event) => setDraft({ ...draft, cnpj: event.target.value })}
            placeholder="00.000.000/0000-00"
            className="mt-1 h-9 w-full rounded-md border px-3"
            data-testid="empresa-cnpj"
          />
        </label>
      </div>
      {definicoes.length > 0 && (
        <div className="mt-4" data-testid="empresa-campos-configuraveis">
          <h3 className="text-sm font-medium">{t("Campos do cadastro")}</h3>
          <CustomFieldsEditor
            className="mt-2"
            fields={definicoes}
            mode="contact"
            value={draft.custom_fields}
            disabled={saving}
            onChange={(custom_fields) => setDraft({ ...draft, custom_fields })}
          />
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <Button type="submit" disabled={saving} data-testid="salvar-empresa">
          {saving ? t("Salvando…") : submitLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          {t("Cancelar")}
        </Button>
      </div>
    </form>
  );
}
