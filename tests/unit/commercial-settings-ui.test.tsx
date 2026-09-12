import * as React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommercialProfile } from "@/src/tenant-config/commercial-contract";
import { CommercialSettingsClient } from "@/app/app/settings/commercial/_client";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  orgId: "tenant-a",
}));
vi.mock("@/lib/api/client", () => ({ apiClient: mocks }));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ activeOrg: { orgId: mocks.orgId } }),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (value: string) => value }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({
  useTagDeIdioma: () => "pt-BR",
}));
const ENDPOINT = "/api/v1/settings/commercial";
const AT = "2026-09-09T15:00:00.000Z";
function profile(canWrite = true): CommercialProfile {
  const missing = <T,>(value: T) => ({
    present: false as const,
    value,
    source: "default" as const,
    updated_at: null,
  });
  return {
    settings: {
      "business.phone": missing(null),
      "business.address": missing(null),
      "business.hours": missing(null),
      "business.delivery_days": missing([]),
      "business.delivery_regions": missing([]),
      "business.cancellation_policy": missing(null),
    },
    organization: {
      legal_name: "Empresa fictícia",
      display_name: "Nome vigente",
      cnpj: null,
      timezone: "America/Sao_Paulo",
      currency: "BRL",
      legacy_timezone: { status: "absent" },
    },
    branding: {
      app_name: null,
      accent_hex: null,
      logo_path: null,
      legacy_name: { status: "absent" },
      legacy_primary_color: { status: "absent" },
    },
    legacy_logo_url: { status: "absent" },
    capabilities: {
      can_write_commercial: canWrite,
      can_edit_organization: false,
      can_edit_branding: false,
    },
  };
}
const persisted = <T,>(value: T) => ({
  value,
  present: true as const,
  source: "tenant_admin" as const,
  updated_at: AT,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.orgId = "tenant-a";
  mocks.get.mockResolvedValue({ data: profile() });
});
const input = (name = "Telefone comercial") => screen.getByLabelText(name, { exact: true });
async function ready() {
  await screen.findByLabelText("Telefone comercial", { exact: true });
}
function save() {
  fireEvent.click(screen.getByRole("button", { name: "Salvar dados comerciais" }));
}

describe("leitura e edição comercial pelo DTO persistido", () => {
  it("erro de validação mantém as regiões digitadas para correção", async () => {
    mocks.patch.mockRejectedValue({ status: 400 });
    render(<CommercialSettingsClient />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar região" }));
    fireEvent.change(screen.getByLabelText("Região 1", { exact: true }), {
      target: { value: "  " },
    });
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Revise os dados informados e os limites dos campos.",
    );
    expect(screen.getByLabelText("Região 1", { exact: true })).toHaveValue("  ");
    expect(screen.getByRole("button", { name: "Salvar dados comerciais" })).toBeEnabled();
  });

  it("envio pendente bloqueia um segundo submit e alterações até a releitura", async () => {
    let complete!: (value: { data: CommercialProfile }) => void;
    mocks.patch.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    render(<CommercialSettingsClient />);
    await ready();
    fireEvent.change(input(), { target: { value: "ramal 8" } });
    save();
    expect(input()).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Editar dados comerciais" }));
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    const saved = profile();
    saved.settings["business.phone"] = persisted("ramal 8");
    await act(async () => complete({ data: saved }));
    expect(input()).toHaveValue("ramal 8");
    expect(screen.getByRole("button", { name: "Salvar dados comerciais" })).toBeDisabled();
  });

  it("separa erro de ausência e recarrega pela mesma rota", async () => {
    mocks.get.mockRejectedValueOnce(new Error("offline"));
    render(<CommercialSettingsClient />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível carregar os dados comerciais.",
    );
    expect(screen.queryByText("Não informado")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await ready();
    expect(screen.getAllByText("Não informado")).toHaveLength(6);
    expect(mocks.get.mock.calls.map(([url]) => url)).toEqual([ENDPOINT, ENDPOINT]);
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("GET negado não exibe formulário nem dados canônicos", async () => {
    mocks.get.mockRejectedValue({ status: 403 });
    render(<CommercialSettingsClient />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Você não tem acesso aos dados comerciais desta organização.",
    );
    expect(screen.queryByLabelText("Telefone comercial", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Empresa fictícia")).not.toBeInTheDocument();
  });

  it("envia só seis campos alterados e usa o retorno canônico, sem ecoar o rascunho", async () => {
    const saved = profile();
    saved.settings = {
      "business.phone": persisted("ramal 12"),
      "business.address": persisted("Rua Teste"),
      "business.hours": persisted("08–18"),
      "business.delivery_days": persisted([0]),
      "business.delivery_regions": persisted(["Centro, norte"]),
      "business.cancellation_policy": persisted("Revisão humana"),
    };
    mocks.patch.mockResolvedValue({ data: saved });
    render(<CommercialSettingsClient />);
    await ready();
    expect(screen.getByRole("button", { name: "Salvar dados comerciais" })).toBeDisabled();
    fireEvent.change(input(), { target: { value: " ramal 12 " } });
    fireEvent.change(input("Endereço comercial"), {
      target: { value: "Rua Teste" },
    });
    fireEvent.change(input("Horário de atendimento"), {
      target: { value: "08–18" },
    });
    fireEvent.change(input("Política de cancelamento"), {
      target: { value: "Revisão humana" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Domingo" }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar região" }));
    fireEvent.change(screen.getByLabelText("Região 1", { exact: true }), {
      target: { value: "Centro, norte" },
    });
    save();
    await screen.findByText("Dados comerciais salvos.");
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.patch.mock.calls[0]?.slice(0, 2)).toEqual([
      ENDPOINT,
      {
        settings: {
          "business.phone": " ramal 12 ",
          "business.address": "Rua Teste",
          "business.hours": "08–18",
          "business.delivery_days": [0],
          "business.delivery_regions": ["Centro, norte"],
          "business.cancellation_policy": "Revisão humana",
        },
      },
    ]);
    expect(input()).toHaveValue("ramal 12");
    expect(screen.getByRole("button", { name: "Salvar dados comerciais" })).toBeDisabled();
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it("limpa null e [] explicitamente sem materializar os outros defaults", async () => {
    const initial = profile();
    initial.settings["business.phone"] = persisted("ramal 2");
    initial.settings["business.delivery_days"] = persisted([0]);
    mocks.get.mockResolvedValue({ data: initial });
    mocks.patch.mockResolvedValue({ data: profile() });
    render(<CommercialSettingsClient />);
    await ready();
    fireEvent.change(input(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Domingo" }));
    save();
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(1));
    expect(mocks.patch.mock.calls[0]?.[1]).toEqual({
      settings: { "business.phone": null, "business.delivery_days": [] },
    });
  });

  it("erro de salvar preserva digitação e permite retry sem incluir metadados ou aliases", async () => {
    mocks.patch
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: profile() });
    render(<CommercialSettingsClient />);
    await ready();
    fireEvent.change(input(), { target: { value: "ramal 5" } });
    save();
    await screen.findByRole("alert");
    expect(input()).toHaveValue("ramal 5");
    save();
    await screen.findByText("Dados comerciais salvos.");
    expect(mocks.patch.mock.calls.map((call) => call[1])).toEqual([
      { settings: { "business.phone": "ramal 5" } },
      { settings: { "business.phone": "ramal 5" } },
    ]);
  });

  it("permissão revogada bloqueia novo envio, mantendo o rascunho até recarga explícita", async () => {
    mocks.patch.mockRejectedValue({ status: 403 });
    render(<CommercialSettingsClient />);
    await ready();
    fireEvent.change(input(), { target: { value: "ramal 6" } });
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("Sua permissão de escrita mudou.");
    expect(input()).toHaveValue("ramal 6");
    expect(input()).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Salvar dados comerciais" }),
    ).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole("form", { name: "Editar dados comerciais" }));
    expect(mocks.patch).toHaveBeenCalledTimes(1);
  });

  it("viewer ou suporte readonly lê os dados sem salvar ou acessar editores herdados", async () => {
    mocks.get.mockResolvedValue({ data: profile(false) });
    render(<CommercialSettingsClient />);
    await ready();
    expect(screen.getByText("Nome vigente")).toBeVisible();
    expect(input()).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Salvar dados comerciais" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Revisar em Organização" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Revisar em Marca" })).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole("form", { name: "Editar dados comerciais" }));
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("conflitos são diagnósticos textuais; logo antigo não gera URL, imagem ou adoção", async () => {
    const initial = profile();
    initial.organization.legacy_timezone = {
      status: "conflicts",
      value: "UTC",
      source: "seed",
      updated_at: AT,
    };
    initial.branding.app_name = "Marca atual";
    initial.branding.legacy_name = {
      status: "conflicts",
      value: "Marca antiga",
      source: "seed",
      updated_at: AT,
    };
    initial.legacy_logo_url = {
      status: "unsupported_url",
      source: "seed",
      updated_at: AT,
    };
    initial.capabilities.can_edit_organization = true;
    initial.capabilities.can_edit_branding = true;
    mocks.get.mockResolvedValue({ data: initial });
    const { container } = render(<CommercialSettingsClient />);
    await ready();
    expect(screen.getByRole("link", { name: "Revisar em Organização" })).toHaveAttribute(
      "href",
      "/app/settings/tenant",
    );
    expect(screen.getByRole("link", { name: "Revisar em Marca" })).toHaveAttribute(
      "href",
      "/app/settings/marca",
    );
    expect(screen.getByText("Configuração antiga: Marca antiga")).toBeVisible();
    expect(screen.getByText("Valor em uso: Marca atual")).toBeVisible();
    expect(screen.getByText(/Existe uma referência antiga de logo/)).toBeVisible();
    expect(container.querySelectorAll("img, iframe, a[href^='http']")).toHaveLength(0);
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("não descarta edições por recarga sem decisão explícita", async () => {
    render(<CommercialSettingsClient />);
    await ready();
    fireEvent.change(input(), { target: { value: "rascunho" } });
    fireEvent.click(screen.getByRole("button", { name: "Recarregar dados" }));
    expect(mocks.get).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Manter alterações" }));
    expect(input()).toHaveValue("rascunho");
    fireEvent.click(screen.getByRole("button", { name: "Recarregar dados" }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar alterações e recarregar" }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    await ready();
    expect(input()).toHaveValue("");
  });

  it("mudar tenant descarta rascunho e resposta tardia do tenant anterior", async () => {
    let resolveFirst!: (value: { data: CommercialProfile }) => void;
    mocks.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const view = render(<CommercialSettingsClient />);
    mocks.orgId = "tenant-b";
    const second = profile();
    second.organization.display_name = "Empresa B";
    mocks.get.mockResolvedValue({ data: second });
    view.rerender(<CommercialSettingsClient />);
    await ready();
    await act(async () => resolveFirst({ data: profile() }));
    expect(screen.getByText("Empresa B")).toBeVisible();
    expect(screen.queryByText("Nome vigente")).not.toBeInTheDocument();
    expect(mocks.get.mock.calls[0]?.[1].signal.aborted).toBe(true);
  });

  it("legado fora dos limites permanece intacto quando só outro campo é editado", async () => {
    const initial = profile();
    initial.settings["business.cancellation_policy"] = persisted("x".repeat(2100));
    initial.settings["business.delivery_regions"] = persisted(["", "Centro", "Centro"]);
    mocks.get.mockResolvedValue({ data: initial });
    mocks.patch.mockResolvedValue({ data: initial });
    render(<CommercialSettingsClient />);
    await ready();
    fireEvent.change(input(), { target: { value: "ramal 1" } });
    save();
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(1));
    expect(mocks.patch.mock.calls[0]?.[1]).toEqual({
      settings: { "business.phone": "ramal 1" },
    });
    expect(input("Política de cancelamento")).toHaveValue("x".repeat(2100));
    expect(
      within(screen.getByRole("group", { name: "Regiões de entrega" })).getAllByRole("textbox"),
    ).toHaveLength(3);
  });
});
