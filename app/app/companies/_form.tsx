"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/IdiomaProvider";
import type { CompanyDraft } from "./_types";

interface Props {
  initial: CompanyDraft;
  saving: boolean;
  title: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (draft: CompanyDraft) => void;
}

/** Formulário compartilhado por criação e edição; CNPJ fica livre para a máscara. */
export function CompanyForm({ initial, saving, title, submitLabel, onCancel, onSubmit }: Props) {
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
