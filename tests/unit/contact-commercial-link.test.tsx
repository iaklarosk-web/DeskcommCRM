import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { api, audit } = vi.hoisted(() => ({
  api: { get: vi.fn(), patch: vi.fn() },
  audit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/api/client", () => ({ apiClient: api }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { CommercialLink } from "@/app/app/contacts/[id]/_commercial-link";
import { patchContactHandler } from "@/app/api/v1/contacts/_handler";
import { ApiError } from "@/lib/api/types";
import { contactPatchSchema } from "@/lib/schemas/contacts";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTACT = "22222222-2222-4222-8222-222222222222";
const COMPANY = "33333333-3333-4333-8333-333333333333";
let companyBelongsToOrg = true;
let written: Record<string, unknown> | null = null;

function db() {
  const contact = {
    id: CONTACT, organization_id: ORG, is_anonymized: false, tags: [], email: null,
    phone_number: null, name: "Ana", display_name: "Ana", consent: {}, custom_fields: {},
    company_id: null, recurring: true,
  };
  return {
    from: (table: string) => {
      if (table === "crm_companies") {
        const chain = { eq: () => chain, maybeSingle: async () => ({ data: companyBelongsToOrg ? { id: COMPANY } : null, error: null }) };
        return { select: () => chain };
      }
      const selected = { eq: () => selected, maybeSingle: async () => ({ data: contact, error: null }) };
      const updated = {
        eq: () => updated,
        select: () => updated,
        maybeSingle: async () => ({ data: { ...contact, ...written }, error: null }),
      };
      return {
        select: () => selected,
        update: (value: Record<string, unknown>) => { written = value; return updated; },
      };
    },
    rpc: () => ({ then: (done: (value: { error: null }) => unknown) => done({ error: null }) }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  companyBelongsToOrg = true;
  written = null;
});

describe("contrato comercial do PATCH de contato", () => {
  it("omissão preserva; null desvincula e false é recorrência válida", () => {
    expect(contactPatchSchema.parse({ name: "Ana" })).not.toHaveProperty("company_id");
    expect(contactPatchSchema.parse({ company_id: null, recurring: false })).toMatchObject({ company_id: null, recurring: false });
    expect(contactPatchSchema.safeParse({ recurring: "false" }).success).toBe(false);
  });

  it("vincula empresa da org e grava false sem reescrever os outros campos", async () => {
    await patchContactHandler(db() as never, { organization_id: ORG, actor: { type: "user", id: "u" }, requestId: "r" }, CONTACT, { company_id: COMPANY, recurring: false });
    expect(written).toMatchObject({ company_id: COMPANY, recurring: false });
    expect(written).not.toHaveProperty("phone_number");
    expect(written).not.toHaveProperty("consent");
  });

  it("empresa de outra organização vira 422 sem atualizar e sem revelar existência", async () => {
    companyBelongsToOrg = false;
    await expect(patchContactHandler(db() as never, { organization_id: ORG, actor: { type: "user", id: "u" }, requestId: "r" }, CONTACT, { company_id: COMPANY })).rejects.toMatchObject({ status: 422, code: "validation_failed" });
    expect(written).toBeNull();
  });
});

describe("Vínculo comercial na ficha", () => {
  it("viewer lê o vínculo, inclusive empresa fora da primeira página, sem controles de escrita", async () => {
    api.get.mockResolvedValueOnce({ data: { id: COMPANY, legal_name: "Empresa 51", trade_name: null, cnpj: null } });
    render(<CommercialLink contactId={CONTACT} companyId={COMPANY} recurring podeEditar={false} onSaved={vi.fn()} />);
    expect(await screen.findByTestId("empresa-vinculada")).toHaveTextContent("Empresa 51");
    expect(api.get).toHaveBeenCalledWith(`/api/v1/companies/${COMPANY}`);
    expect(screen.queryByTestId("buscar-empresa-vinculo")).not.toBeInTheDocument();
    expect(screen.getByText("Cliente recorrente.")).toBeInTheDocument();
  });

  it("mantém valores tentados e mostra erro quando o PATCH falha", async () => {
    api.patch.mockRejectedValueOnce(new ApiError(422, "validation_failed", undefined, "r", "inválida"));
    render(<CommercialLink contactId={CONTACT} companyId={null} recurring={false} podeEditar onSaved={vi.fn()} />);
    fireEvent.click(screen.getByTestId("contato-recorrente"));
    fireEvent.click(screen.getByTestId("salvar-vinculo-comercial"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Escolha outra"));
    expect(screen.getByTestId("contato-recorrente")).toBeChecked();
    expect(screen.getByRole("link", { name: "Abrir empresas clientes" })).toHaveAttribute("href", "/app/companies");
  });

  it("limpar busca pendente encerra carregamento e resposta antiga não vence", async () => {
    vi.useFakeTimers();
    let resolve!: (value: { data: Array<{ id: string; legal_name: string; trade_name: null; cnpj: null }> }) => void;
    api.get.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    try {
      render(<CommercialLink contactId={CONTACT} companyId={null} recurring={false} podeEditar onSaved={vi.fn()} />);
      fireEvent.change(screen.getByTestId("buscar-empresa-vinculo"), { target: { value: "Au" } });
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      expect(screen.getByText("Buscando empresas…")).toBeInTheDocument();
      fireEvent.change(screen.getByTestId("buscar-empresa-vinculo"), { target: { value: "" } });
      expect(screen.queryByText("Buscando empresas…")).not.toBeInTheDocument();
      await act(async () => { resolve({ data: [{ id: COMPANY, legal_name: "Antiga", trade_name: null, cnpj: null }] }); });
      expect(screen.queryByTestId("resultados-empresas")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("erro de busca não finge vazio, permite retry e avisa quando 50 não bastam", async () => {
    vi.useFakeTimers();
    api.get.mockRejectedValueOnce(new Error("rede")).mockResolvedValueOnce({
      data: [{ id: COMPANY, legal_name: "Aurora", trade_name: null, cnpj: null }],
      meta: { has_more: true },
    });
    try {
      render(<CommercialLink contactId={CONTACT} companyId={null} recurring={false} podeEditar onSaved={vi.fn()} />);
      fireEvent.change(screen.getByTestId("buscar-empresa-vinculo"), { target: { value: "Au" } });
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível buscar empresas");
      expect(screen.queryByText("Nenhuma empresa encontrada.")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      expect(screen.getByTestId("resultados-empresas")).toHaveTextContent("Aurora");
      expect(screen.getByText("Há mais resultados. Refine a busca por razão social.")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sincroniza recorrência nova e bloqueia o rascunho durante salvamento", async () => {
    let reject!: (reason: unknown) => void;
    api.patch.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const { rerender } = render(<CommercialLink contactId={CONTACT} companyId={null} recurring={false} podeEditar onSaved={vi.fn()} />);
    rerender(<CommercialLink contactId={CONTACT} companyId={null} recurring podeEditar={false} onSaved={vi.fn()} />);
    expect(await screen.findByText("Cliente recorrente.")).toBeInTheDocument();
    rerender(<CommercialLink contactId={CONTACT} companyId={null} recurring={false} podeEditar onSaved={vi.fn()} />);
    fireEvent.click(screen.getByTestId("contato-recorrente"));
    fireEvent.click(screen.getByTestId("salvar-vinculo-comercial"));
    expect(screen.getByTestId("buscar-empresa-vinculo")).toBeDisabled();
    expect(screen.getByTestId("contato-recorrente")).toBeDisabled();
    await act(async () => { reject(new ApiError(422, "validation_failed", undefined, "r")); });
    expect(screen.getByTestId("contato-recorrente")).toBeChecked();
  });
});
