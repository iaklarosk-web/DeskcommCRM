import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, post, patch, del, toast } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api/client", () => ({ apiClient: { get, post, patch, delete: del } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { CompaniesClient } from "@/app/app/companies/_client";
import { ApiError } from "@/lib/api/types";

const company = {
  id: "11111111-1111-4111-8111-111111111111",
  legal_name: "Comercial Aurora Ltda.",
  trade_name: null,
  cnpj: null,
  created_at: "2026-09-09T00:00:00.000Z",
  updated_at: "2026-09-09T00:00:00.000Z",
};

function lista(data = [company]) {
  return { data, meta: { page: 1, limit: 50, total: data.length, has_more: false } };
}

describe("EmpresasClient", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("distingue carregamento, falha e lista vazia", async () => {
    let resolve!: (value: ReturnType<typeof lista>) => void;
    get.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const primeira = render(<CompaniesClient podeEditar />);
    expect(screen.getByTestId("empresas-carregando")).toBeInTheDocument();
    resolve(lista([]));
    expect(await screen.findByTestId("empresas-vazio")).toBeInTheDocument();

    primeira.unmount();
    get.mockRejectedValueOnce(new Error("falha"));
    render(<CompaniesClient podeEditar />);
    expect(await screen.findByTestId("empresas-erro")).toHaveTextContent(
      "Não foi possível carregar",
    );
  });

  it("viewer consulta, mas não recebe ações de escrita", async () => {
    get.mockResolvedValueOnce(lista());
    render(<CompaniesClient podeEditar={false} />);
    expect(await screen.findByTestId(`empresa-${company.id}`)).toHaveTextContent(
      company.legal_name,
    );
    expect(screen.queryByTestId("nova-empresa")).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excluir" })).not.toBeInTheDocument();
  });

  it("permite campos opcionais vazios e explica o conflito de vínculos ao excluir", async () => {
    get.mockResolvedValue(lista());
    post.mockResolvedValueOnce({ data: company });
    del.mockRejectedValueOnce(new ApiError(409, "conflict", undefined, "r", "vinculada"));
    render(<CompaniesClient podeEditar />);
    await screen.findByTestId(`empresa-${company.id}`);

    fireEvent.click(screen.getByTestId("nova-empresa"));
    fireEvent.change(screen.getByTestId("empresa-razao-social"), {
      target: { value: "Nova Ltda." },
    });
    fireEvent.click(screen.getByTestId("salvar-empresa"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/v1/companies", {
        legal_name: "Nova Ltda.",
        trade_name: null,
        cnpj: null,
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Excluir" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Não é possível excluir: esta empresa possui clientes ou pedidos vinculados.",
      ),
    );
  });

  it("uma busca antiga não substitui o resultado da busca atual", async () => {
    let resolveOld!: (value: ReturnType<typeof lista>) => void;
    let resolveNew!: (value: ReturnType<typeof lista>) => void;
    get.mockReturnValueOnce(
      new Promise((done) => {
        resolveOld = done;
      }),
    );
    get.mockReturnValueOnce(
      new Promise((done) => {
        resolveNew = done;
      }),
    );
    render(<CompaniesClient podeEditar={false} />);
    fireEvent.change(screen.getByTestId("busca-empresa"), { target: { value: "Atual" } });
    const current = { ...company, legal_name: "Atual Ltda." };
    await act(async () => {
      resolveNew(lista([current]));
    });
    expect(await screen.findByTestId(`empresa-${company.id}`)).toHaveTextContent("Atual Ltda.");
    await act(async () => {
      resolveOld(lista());
    });
    expect(screen.getByTestId(`empresa-${company.id}`)).toHaveTextContent("Atual Ltda.");
    expect(screen.queryByText(company.legal_name)).not.toBeInTheDocument();
  });

  it("salvar não permite trocar o formulário pendente e recarrega a busca vigente", async () => {
    get.mockResolvedValue(lista());
    let resolvePost!: (value: unknown) => void;
    post.mockReturnValueOnce(
      new Promise((done) => {
        resolvePost = done;
      }),
    );
    render(<CompaniesClient podeEditar />);
    await screen.findByTestId(`empresa-${company.id}`);
    fireEvent.click(screen.getByTestId("nova-empresa"));
    fireEvent.change(screen.getByTestId("empresa-razao-social"), { target: { value: "Nova" } });
    fireEvent.click(screen.getByTestId("salvar-empresa"));
    expect(screen.getByTestId("nova-empresa")).toBeDisabled();
    expect(screen.getByTestId("empresa-razao-social")).toBeDisabled();
    fireEvent.change(screen.getByTestId("busca-empresa"), { target: { value: "Busca atual" } });
    await act(async () => {
      resolvePost({ data: company });
    });
    await waitFor(() => expect(screen.queryByTestId("salvar-empresa")).not.toBeInTheDocument());
    expect(get.mock.calls.at(-1)?.[0]).toContain("search=Busca+atual");
  });
});
