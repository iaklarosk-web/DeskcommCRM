import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommercialFields } from "@/app/app/settings/commercial/_fields";
import {
  COMMERCIAL_KEYS,
  commercialPatch,
  type CommercialValues,
} from "@/app/app/settings/commercial/_values";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (value: string) => value }));
const empty = (): CommercialValues => ({
  "business.phone": null,
  "business.address": null,
  "business.hours": null,
  "business.delivery_days": [],
  "business.delivery_regions": [],
  "business.cancellation_policy": null,
});
const presence = (value: boolean) =>
  Object.fromEntries(COMMERCIAL_KEYS.map((key) => [key, value])) as Record<
    keyof CommercialValues,
    boolean
  >;

describe("seis campos comerciais sem regra inventada", () => {
  it("limita novas regiões a 50 e normaliza dias somente após edição explícita", () => {
    const onChange = vi.fn();
    render(
      <CommercialFields
        values={{
          ...empty(),
          "business.delivery_days": [5, 1, 1],
          "business.delivery_regions": Array.from({ length: 50 }, (_, index) => `Região ${index}`),
        }}
        present={presence(true)}
        disabled={false}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("button", { name: "Adicionar região" })).toBeDisabled();
    expect(screen.getByLabelText("Região 1", { exact: true })).toHaveAttribute("maxlength", "120");
    expect(screen.getByLabelText("Horário de atendimento", { exact: true })).toHaveAttribute(
      "maxlength",
      "500",
    );
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Domingo" }));
    expect(onChange).toHaveBeenLastCalledWith("business.delivery_days", [0, 1, 5]);
  });

  it("distingue ausência de vazio explicitamente persistido sem pré-selecionar dias", () => {
    const view = render(
      <CommercialFields
        values={empty()}
        present={presence(false)}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Não informado")).toHaveLength(6);
    expect(screen.getAllByRole("checkbox")).toHaveLength(7);
    for (const checkbox of screen.getAllByRole("checkbox")) expect(checkbox).not.toBeChecked();
    view.rerender(
      <CommercialFields
        values={empty()}
        present={presence(true)}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Sem valor definido")).toHaveLength(6);
    expect(screen.queryByText("Não informado")).not.toBeInTheDocument();
  });

  it("domingo corresponde a zero e remover uma região preserva a pontuação das outras", () => {
    const onChange = vi.fn();
    render(
      <CommercialFields
        values={{
          ...empty(),
          "business.delivery_regions": ["Centro, norte", "Bairro (A)"],
        }}
        present={presence(true)}
        disabled={false}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Domingo" }));
    expect(onChange).toHaveBeenLastCalledWith("business.delivery_days", [0]);
    fireEvent.click(screen.getByRole("button", { name: "Remover região 2" }));
    expect(onChange).toHaveBeenLastCalledWith("business.delivery_regions", ["Centro, norte"]);
  });

  it("permite limpar nullable e aplica limites novos sem inferir formato do telefone", () => {
    const onChange = vi.fn();
    render(
      <CommercialFields
        values={{ ...empty(), "business.phone": "ramal 9" }}
        present={presence(true)}
        disabled={false}
        onChange={onChange}
      />,
    );
    const phone = screen.getByLabelText("Telefone comercial", { exact: true });
    expect(phone).toHaveValue("ramal 9");
    expect(phone).not.toHaveAttribute("pattern");
    expect(phone).toHaveAttribute("maxlength", "80");
    fireEvent.change(phone, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith("business.phone", null);
    expect(screen.getByLabelText("Política de cancelamento", { exact: true })).toHaveAttribute(
      "maxlength",
      "2000",
    );
    expect(screen.getByLabelText("Endereço comercial", { exact: true })).toHaveAttribute(
      "maxlength",
      "500",
    );
  });

  it("fieldset readonly desabilita textos, dias e controles de coleção", () => {
    render(
      <CommercialFields
        values={{ ...empty(), "business.delivery_regions": ["Centro"] }}
        present={presence(true)}
        disabled
        onChange={vi.fn()}
      />,
    );
    for (const input of screen.getAllByRole("textbox")) expect(input).toBeDisabled();
    for (const checkbox of screen.getAllByRole("checkbox")) expect(checkbox).toBeDisabled();
    expect(screen.getByRole("button", { name: "Adicionar região" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remover região 1" })).toBeDisabled();
  });

  it("patch não materializa defaults pendentes nem normaliza o legado não editado", () => {
    const baseline = {
      ...empty(),
      "business.phone": "",
      "business.delivery_days": [5, 1, 1],
      "business.delivery_regions": ["", "Centro, norte", "Centro, norte"],
    };
    expect(commercialPatch(baseline, { ...baseline })).toEqual({});
    expect(
      commercialPatch(baseline, {
        ...baseline,
        "business.address": " Rua fictícia ",
      }),
    ).toEqual({ "business.address": " Rua fictícia " });
    expect(
      commercialPatch(baseline, {
        ...baseline,
        "business.phone": null,
        "business.delivery_days": [],
      }),
    ).toEqual({ "business.phone": null, "business.delivery_days": [] });
  });
});
