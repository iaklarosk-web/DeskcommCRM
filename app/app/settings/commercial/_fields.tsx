"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import type { CommercialValues } from "./_values";

const DAYS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];
const TEXT_FIELDS = [
  ["business.address", "Endereço comercial", 500],
  ["business.hours", "Horário de atendimento", 500],
  ["business.cancellation_policy", "Política de cancelamento", 2000],
] as const;

type Key = keyof CommercialValues;
export function CommercialFields({
  values,
  present,
  disabled,
  onChange,
}: {
  values: CommercialValues;
  present: Record<Key, boolean>;
  disabled: boolean;
  onChange: <K extends Key>(key: K, value: CommercialValues[K]) => void;
}) {
  const t = useT();
  function state(key: Key) {
    const value = values[key];
    return !present[key]
      ? t("Não informado")
      : value === null || value.length === 0
        ? t("Sem valor definido")
        : t("Configurado");
  }
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="sr-only">{t("Campos comerciais")}</legend>
      <label className="grid gap-1 text-sm">
        <span>{t("Telefone comercial")}</span>
        <Input
          aria-label={t("Telefone comercial")}
          type="tel"
          maxLength={80}
          value={values["business.phone"] ?? ""}
          onChange={(event) => onChange("business.phone", event.target.value || null)}
        />
        <span className="text-xs text-muted-foreground">{state("business.phone")}</span>
        <span className="text-xs text-muted-foreground">{t("Limite de caracteres")}: 80</span>
      </label>
      {TEXT_FIELDS.map(([key, label, limit]) => (
        <label key={key} className="grid gap-1 text-sm">
          <span>{t(label)}</span>
          <textarea
            aria-label={t(label)}
            maxLength={limit}
            className="min-h-20 rounded-md border bg-background p-2"
            value={values[key] ?? ""}
            onChange={(event) => onChange(key, event.target.value || null)}
          />
          <span className="text-xs text-muted-foreground">{state(key)}</span>
          <span className="text-xs text-muted-foreground">
            {t("Limite de caracteres")}: {limit}
          </span>
        </label>
      ))}
      <fieldset className="space-y-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t("Dias de entrega")}</legend>
        <div className="flex flex-wrap gap-3">
          {DAYS.map((day, index) => (
            <label key={day} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={values["business.delivery_days"].includes(index)}
                onChange={(event) =>
                  onChange(
                    "business.delivery_days",
                    [
                      ...new Set(
                        event.target.checked
                          ? [...values["business.delivery_days"], index]
                          : values["business.delivery_days"].filter((value) => value !== index),
                      ),
                    ].sort((a, b) => a - b),
                  )
                }
              />
              {t(day)}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{state("business.delivery_days")}</p>
      </fieldset>
      <fieldset className="space-y-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t("Regiões de entrega")}</legend>
        <p className="text-xs text-muted-foreground">{state("business.delivery_regions")}</p>
        <p className="text-xs text-muted-foreground">
          {t("Até 50 regiões diferentes, com 1 a 120 caracteres cada.")}
        </p>
        {values["business.delivery_regions"].map((region, index) => (
          <div className="flex items-end gap-2" key={index}>
            <label className="grid flex-1 gap-1 text-sm">
              <span>
                {t("Região")} {index + 1}
              </span>
              <Input
                maxLength={120}
                value={region}
                onChange={(event) =>
                  onChange(
                    "business.delivery_regions",
                    values["business.delivery_regions"].map((value, position) =>
                      position === index ? event.target.value : value,
                    ),
                  )
                }
              />
            </label>
            <Button
              type="button"
              variant="outline"
              aria-label={`${t("Remover região")} ${index + 1}`}
              onClick={() =>
                onChange(
                  "business.delivery_regions",
                  values["business.delivery_regions"].filter((_, position) => position !== index),
                )
              }
            >
              {t("Remover")}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={values["business.delivery_regions"].length >= 50}
          onClick={() =>
            onChange("business.delivery_regions", [...values["business.delivery_regions"], ""])
          }
        >
          {t("Adicionar região")}
        </Button>
      </fieldset>
      <p className="text-sm text-muted-foreground">
        {t(
          "Esses dados descrevem o atendimento. Não alteram pedidos já confirmados nem criam regras automáticas de entrega ou cancelamento.",
        )}
      </p>
    </fieldset>
  );
}
