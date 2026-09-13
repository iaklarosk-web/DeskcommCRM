import { NextRequest } from "next/server";
import { createClient as makeSupabase } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import type { AuthUser, ActiveOrg } from "@/lib/auth/types";

const { client, requireRole, auth, fetchMock } = vi.hoisted(() => ({
  client: vi.fn(),
  requireRole: vi.fn(),
  fetchMock: vi.fn(),
  auth: { user: {} as AuthUser, org: null as ActiveOrg | null },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: client }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole }));
vi.mock("@/lib/auth/server", () => ({
  requireAuth: async () => auth.user,
  resolveActiveOrg: async () => auth.org,
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/app/app/products/_client", () => ({ ProdutosClient: () => null }));

import { GET } from "@/app/api/v1/products/route";
import ProdutosPage from "@/app/app/products/page";
import {
  catalogQuerySchema,
  catalogSearchFilter,
  listCatalogPage,
} from "@/lib/catalogo/listar";

const ORG = "10000000-0000-4000-8000-000000000001";
const PRODUCT = {
  id: "20000000-0000-4000-8000-000000000001",
  nome: "Produto sintético",
  sale_unit: "caixa",
};
const sdk = () =>
  makeSupabase<Database>("http://catalog.example.invalid", "test", {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: fetchMock },
  });
const request = (query = "") =>
  new NextRequest(`http://app.example.invalid/api/v1/products${query}`);
function response(data: unknown[], count: number | null = data.length) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "content-type": "application/json",
      ...(count === null
        ? {}
        : { "content-range": `0-${Math.max(data.length - 1, 0)}/${count}` }),
    },
  });
}
const lastUrl = () => new URL(String(fetchMock.mock.lastCall?.[0]));

/** Leitor independente da gramática emitida: só quatro cláusulas simples, valores quoted. */
function literalPatterns(filter: string) {
  const parts = [
    ...filter.matchAll(
      /(nome|codigo|marca|categoria)\.imatch\.("(?:\\.|[^"\\])*")(?=,|$)/g,
    ),
  ];
  expect(parts.map((part) => part[0]).join(",")).toBe(filter);
  expect(parts.map((part) => part[1])).toEqual([
    "nome",
    "codigo",
    "marca",
    "categoria",
  ]);
  return parts.map((part) => JSON.parse(part[2]!) as string);
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.user = {
    id: "operator",
    idioma: "pt-BR",
    is_platform_admin: false,
    support: null,
  } as AuthUser;
  auth.org = { orgId: ORG, role: "manager" } as ActiveOrg;
  requireRole.mockImplementation(async () => ({
    ok: true,
    user: auth.user,
    org: auth.org,
  }));
  client.mockImplementation(async () => sdk());
  fetchMock.mockImplementation(async () => response([PRODUCT], 101));
});

describe("leitor compartilhado e fronteira HTTP do SDK", () => {
  it.each([
    ["AB*CD", "ABqualquerCD"],
    ["100%_A", "100qualquerXA"],
    [String.raw`C:\loja\"(A),B.C:+?[^$]{2}|`, "C loja A B C"],
    ['x\",organization_id.neq.a,or(nome.eq.y)', "y"],
  ])(
    "busca %s permanece literal após serialização real do SDK",
    async (search, nonmatch) => {
      await listCatalogPage(
        sdk(),
        ORG,
        catalogQuerySchema.parse({ busca: search, page: 2, limit: 50 }),
      );
      const url = lastUrl();
      expect(url.pathname).toBe("/rest/v1/catalog_products");
      expect(url.searchParams.get("organization_id")).toBe(`eq.${ORG}`);
      expect(url.searchParams.get("order")).toBe("ativo.desc,nome.asc,id.asc");
      expect(url.searchParams.get("offset")).toBe("50");
      expect(url.searchParams.get("limit")).toBe("50");
      const filter = url.searchParams.get("or")!;
      expect(filter.startsWith("(") && filter.endsWith(")")).toBe(true);
      const patterns = literalPatterns(filter.slice(1, -1));
      for (const pattern of patterns) {
        const regex = new RegExp(pattern, "i");
        expect(regex.test(`prefixo ${search} sufixo`)).toBe(true);
        expect(regex.test(nonmatch)).toBe(false);
      }
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("não permite regex do operador entrar como expressão executável", () => {
    const patterns = literalPatterns(catalogSearchFilter("(a+)+$"));
    for (const pattern of patterns) {
      expect(new RegExp(pattern).test("(a+)+$")).toBe(true);
      expect(new RegExp(pattern).test("aaaaa")).toBe(false);
    }
  });
});

describe("GET catálogo paginado", () => {
  it("preserva array data e limite padrão 500 dos seletores existentes", async () => {
    const result = await GET(request());
    expect(result.status).toBe(200);
    const json = await result.json();
    expect(json.data).toEqual([PRODUCT]);
    expect(json.meta).toMatchObject({
      page: 1,
      limit: 500,
      total: 101,
      has_more: false,
    });
    expect(lastUrl().searchParams.get("limit")).toBe("500");
    expect(lastUrl().searchParams.has("or")).toBe(false);
    expect(requireRole).toHaveBeenCalledWith(
      "viewer",
      expect.objectContaining({ resource: "catalog_products" }),
    );
  });

  it("filtra antes da paginação e expõe continuação da segunda página", async () => {
    const result = await GET(request("?busca=Produto&page=2&limit=50"));
    expect(result.status).toBe(200);
    const json = await result.json();
    expect(json.data).toEqual([PRODUCT]);
    expect(json.meta).toMatchObject({
      page: 2,
      limit: 50,
      total: 101,
      has_more: true,
    });
    expect(lastUrl().searchParams.get("offset")).toBe("50");
    expect(lastUrl().searchParams.get("or")).toContain('nome.imatch."Produto"');
  });

  it.each([
    "?organization_id=other",
    "?page=0",
    "?limit=501",
    "?page=2&page=3",
    "?busca=%00",
    `?busca=${"x".repeat(201)}`,
  ])("recusa query inválida %s antes de consultar", async (query) => {
    expect((await GET(request(query))).status).toBe(422);
    expect(client).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("nega leitura antes da consulta se a guarda falhar", async () => {
    requireRole.mockResolvedValue({
      ok: false,
      response: new Response("forbidden", { status: 403 }),
    });
    expect((await GET(request())).status).toBe(403);
    expect(client).not.toHaveBeenCalled();
  });

  it("count ausente não vira total zero nem sucesso de catálogo vazio", async () => {
    fetchMock.mockResolvedValue(response([], null));
    const result = await GET(request());
    expect(result.status).toBe(500);
    expect((await result.json()).error.message).toBe(
      "Erro ao listar os produtos.",
    );
  });

  it("falha PostgREST retorna erro da API, sem fingir lista vazia", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ message: "query failed", code: "PGRST100" }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await GET(request());
    expect(result.status).toBe(500);
    expect(await result.json()).not.toHaveProperty("data");
  });
});

describe("SSR usa a mesma consulta e separa erro de vazio", () => {
  it("pede página de 50 na org ativa e carrega os dados e metadados para a UI", async () => {
    const page = await ProdutosPage({
      searchParams: Promise.resolve({ busca: "Caixa", page: "2" }),
    });
    expect(page.props).toMatchObject({
      inicial: [PRODUCT],
      erro: null,
      buscaInicial: "Caixa",
      pagina: 2,
      limite: 50,
      total: 101,
      podeEditar: true,
    });
    expect(lastUrl().searchParams.get("organization_id")).toBe(`eq.${ORG}`);
    expect(lastUrl().searchParams.get("limit")).toBe("50");
    expect(lastUrl().searchParams.get("offset")).toBe("50");
  });

  it.each(["support_readonly", "expired", "platform_viewer", "viewer"])(
    "SSR não oferece escrita para %s",
    async (mode) => {
      auth.org!.role = "admin";
      if (mode === "support_readonly")
        auth.user.support = {
          access_mode: "support_readonly",
          status: "active",
        } as AuthUser["support"];
      if (mode === "expired")
        auth.user.support = {
          access_mode: "full",
          status: "expired",
        } as AuthUser["support"];
      if (mode === "viewer" || mode === "platform_viewer") {
        auth.org!.role = "viewer";
        auth.user.is_platform_admin = mode === "platform_viewer";
      }
      const page = await ProdutosPage({ searchParams: Promise.resolve({}) });
      expect(page.props.podeEditar).toBe(false);
    },
  );

  it("suporte full ativo continua seguindo o rank permitido pelas APIs legadas", async () => {
    auth.user.support = {
      access_mode: "full",
      status: "active",
    } as AuthUser["support"];
    const page = await ProdutosPage({ searchParams: Promise.resolve({}) });
    expect(page.props.podeEditar).toBe(true);
  });

  it("SSR com count nulo mostra erro mesmo quando as linhas vieram vazias", async () => {
    fetchMock.mockResolvedValue(response([], null));
    const page = await ProdutosPage({ searchParams: Promise.resolve({}) });
    expect(page.props.erro).toBe("Erro ao listar os produtos.");
  });

  it("SSR com filtros inválidos não consulta nem apresenta ausência como sucesso", async () => {
    const page = await ProdutosPage({
      searchParams: Promise.resolve({ page: "-1" }),
    });
    expect(page.props.erro).toBe("Filtros inválidos.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
