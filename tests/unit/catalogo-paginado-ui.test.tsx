// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Produto } from "@/lib/schemas/produtos";

const { push, refresh, post, patch, fetchMock } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  fetchMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/lib/api/client", () => ({ apiClient: { post, patch } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({
  showApiError: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ProdutosClient } from "@/app/app/products/_client";
const produto = {
  id: "10000000-0000-4000-8000-000000000001",
  codigo: "CX",
  nome: "Caixa",
  moeda: "BRL",
  preco_cents: 1299,
  sale_unit: "caixa",
  ativo: true,
  controla_estoque: false,
  quantidade: 0,
} as Produto;
const textos = {
  titulo: "Produtos",
  subtitulo: "Catálogo",
  vazio: "Nenhum produto cadastrado ainda",
  vazioDica: "Cadastre um produto",
};
const buscaLabel = "Buscar por nome, código, marca ou categoria";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("catálogo com busca e paginação no servidor", () => {
  it("erro distinto oferece retry e não mostra vazio nem linhas possivelmente antigas", () => {
    render(
      <ProdutosClient
        inicial={[produto]}
        erro="Erro ao listar os produtos."
        podeEditar={false}
        textos={textos}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Erro ao listar os produtos.",
    );
    expect(screen.queryByTestId("produtos-vazio")).not.toBeInTheDocument();
    expect(screen.queryByTestId("lista-produtos")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("buscar navega para a primeira página sem filtrar a amostra em memória", () => {
    render(
      <ProdutosClient
        inicial={[produto]}
        buscaInicial="Caixa"
        pagina={4}
        total={250}
        podeEditar={false}
        textos={textos}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: buscaLabel }), {
      target: { value: '  100%_A* "(x),y"  ' },
    });
    expect(screen.getByText("Caixa")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    const url = new URL(push.mock.lastCall![0], "https://app.example.invalid");
    expect(url.pathname).toBe("/app/products");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("busca")).toBe('100%_A* "(x),y"');
  });

  it("trocar de página preserva o filtro aplicado, mesmo com texto não enviado no campo", () => {
    render(
      <ProdutosClient
        inicial={[produto]}
        buscaInicial="Caixa"
        pagina={2}
        total={151}
        podeEditar={false}
        textos={textos}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: buscaLabel }), {
      target: { value: "Ainda não busquei" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    const url = new URL(push.mock.lastCall![0], "https://app.example.invalid");
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("busca")).toBe("Caixa");
  });

  it("atualização SSR sincroniza o campo de busca e preserva rascunho de produto", () => {
    const view = render(
      <ProdutosClient
        inicial={[produto]}
        buscaInicial="Caixa"
        pagina={1}
        total={80}
        podeEditar
        textos={textos}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Novo produto" }));
    fireEvent.change(screen.getByTestId("produto-nome"), {
      target: { value: "Rascunho não salvo" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: buscaLabel }), {
      target: { value: "Texto não aplicado" },
    });
    view.rerender(
      <ProdutosClient
        inicial={[produto]}
        buscaInicial="Outra"
        pagina={2}
        total={80}
        podeEditar
        textos={textos}
      />,
    );
    expect(screen.getByRole("textbox", { name: buscaLabel })).toHaveValue(
      "Outra",
    );
    expect(screen.getByTestId("produto-nome")).toHaveValue(
      "Rascunho não salvo",
    );
  });

  it("página posterior vazia não afirma que a busca inteira não encontrou produtos", () => {
    render(
      <ProdutosClient
        inicial={[]}
        buscaInicial="Caixa"
        pagina={3}
        total={60}
        podeEditar={false}
        textos={textos}
      />,
    );
    expect(screen.getByText("Nenhum produto nesta página")).toBeInTheDocument();
    expect(
      screen.queryByText("Nenhum produto encontrado"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(textos.vazio)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Próxima" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Anterior" }));
    expect(
      new URL(push.mock.lastCall![0], "http://x").searchParams.get("page"),
    ).toBe("2");
  });

  it("primeira página de busca vazia é diferente de catálogo sem cadastro e pode limpar filtro", () => {
    render(
      <ProdutosClient
        inicial={[]}
        buscaInicial="Inexistente"
        pagina={1}
        total={0}
        podeEditar={false}
        textos={textos}
      />,
    );
    expect(screen.getByText("Nenhum produto encontrado")).toBeInTheDocument();
    expect(screen.queryByText(textos.vazioDica)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Limpar busca" }));
    const url = new URL(push.mock.lastCall![0], "http://x");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.has("busca")).toBe(false);
  });

  it("viewer continua lendo valores e unidade sem criar/importar/alternar ativo", () => {
    render(
      <ProdutosClient inicial={[produto]} podeEditar={false} textos={textos} />,
    );
    expect(screen.getByTestId("produto-CX")).toHaveTextContent("caixa");
    expect(
      screen.queryByRole("button", { name: "Novo produto" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Importar planilha" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Desativar" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("arquivo-planilha")).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falha de salvar conserva dados da unidade e campos do produto", async () => {
    post.mockRejectedValue(new Error("offline"));
    render(<ProdutosClient inicial={[]} podeEditar textos={textos} />);
    fireEvent.click(screen.getByRole("button", { name: "Novo produto" }));
    fireEvent.change(screen.getByTestId("produto-codigo"), {
      target: { value: "CX2" },
    });
    fireEvent.change(screen.getByTestId("produto-nome"), {
      target: { value: "Caixa nova" },
    });
    fireEvent.change(screen.getByTestId("produto-preco"), {
      target: { value: "19,90" },
    });
    fireEvent.change(screen.getByTestId("produto-unidade-venda"), {
      target: { value: "caixa" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/v1/products",
        expect.objectContaining({
          codigo: "CX2",
          nome: "Caixa nova",
          preco_cents: 1990,
          sale_unit: "caixa",
        }),
      ),
    );
    expect(screen.getByTestId("produto-nome")).toHaveValue("Caixa nova");
    expect(screen.getByTestId("produto-unidade-venda")).toHaveValue("caixa");
    expect(refresh).not.toHaveBeenCalled();
  });
});
