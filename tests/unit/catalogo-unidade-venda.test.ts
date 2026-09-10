import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { lerPlanilha } from "@/lib/catalogo/planilha";
import { produtoCreateSchema, produtoPatchSchema } from "@/lib/schemas/produtos";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const ORG = "22222222-2222-4222-8222-222222222222";
const BASE = { codigo: "CX-01", nome: "Suco", preco_cents: 1200 };

describe("contrato da unidade de venda", () => {
  it("aceita rótulo curto, omite sem preencher legado e aceita null para limpar", () => {
    expect(produtoCreateSchema.parse({ ...BASE, sale_unit: "cx" }).sale_unit).toBe("cx");
    expect(produtoCreateSchema.parse(BASE)).not.toHaveProperty("sale_unit");
    expect(produtoPatchSchema.parse({ sale_unit: null })).toEqual({ sale_unit: null });
  });

  it("recusa unidade vazia ou acima de 32 caracteres; não converte nomes em regra comercial", () => {
    expect(produtoCreateSchema.safeParse({ ...BASE, sale_unit: " " }).success).toBe(false);
    expect(produtoCreateSchema.safeParse({ ...BASE, sale_unit: "x".repeat(33) }).success).toBe(false);
  });

  it("planilha ausente preserva, célula vazia limpa e valor é rótulo literal", () => {
    const sem = lerPlanilha("codigo,nome,preco\nA,Água,1.00");
    const limpa = lerPlanilha("codigo,nome,preco,unidade\nA,Água,1.00,");
    const literal = lerPlanilha("codigo,nome,preco,unidade\nA,Água,1.00,caixa");
    if ("erro" in sem || "erro" in limpa || "erro" in literal) throw new Error("fixture inválida");
    expect(sem.produtos[0]).not.toHaveProperty("sale_unit");
    expect(limpa.produtos[0]?.sale_unit).toBeNull();
    expect(literal.produtos[0]?.sale_unit).toBe("caixa");
  });

  it("coluna desconhecida fica declarada no relatório, sem virar unidade", () => {
    const lido = lerPlanilha("codigo,nome,preco,medida misteriosa\nA,Água,1.00,litro");
    if ("erro" in lido) throw new Error("fixture inválida");
    expect(lido.colunasIgnoradas).toEqual(["medida misteriosa"]);
    expect(lido.produtos[0]).not.toHaveProperty("sale_unit");
  });
});

describe("PATCH /api/v1/products/[id] — unidade", () => {
  let patch: Record<string, unknown> | null;
  let filters: Array<[string, string]>;
  const produtoExistente = { id: "p", ativo: false, controla_estoque: true, quantidade: 17 };

  beforeEach(() => {
    vi.clearAllMocks(); patch = null; filters = [];
    vi.mocked(requireSupportWrite).mockResolvedValue(null);
    vi.mocked(requireRole).mockResolvedValue({ ok: true, user: { id: "u" }, org: { orgId: ORG } } as never);
    vi.mocked(createClient).mockResolvedValue({
      from: () => ({
        update: (updated: Record<string, unknown>) => { patch = updated; return {
          eq: (key: string, value: string) => { filters.push([key, value]); return { eq: (k: string, v: string) => { filters.push([k, v]); return { select: () => ({ maybeSingle: async () => ({ data: { ...produtoExistente, ...updated }, error: null }) }) }; } }; },
        }; },
      }),
    } as never);
  });

  it("null limpa e omissão não manda a coluna; PATCH cruza a org ativa", async () => {
    const { PATCH } = await import("@/app/api/v1/products/[id]/route");
    const req = (body: object) => new NextRequest("http://x/api/v1/products/outro-tenant", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await PATCH(req({ sale_unit: null }), { params: Promise.resolve({ id: "outro-tenant" }) })).status).toBe(200);
    expect(patch).toEqual({ sale_unit: null });
    expect(filters).toContainEqual(["organization_id", ORG]);
    expect((await PATCH(req({ nome: "Suco novo" }), { params: Promise.resolve({ id: "outro-tenant" }) })).status).toBe(200);
    expect(patch).not.toHaveProperty("sale_unit");
  });

  it("editar a unidade não reativa nem altera o estoque já existente", async () => {
    const { PATCH } = await import("@/app/api/v1/products/[id]/route");
    const res = await PATCH(new NextRequest("http://x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ sale_unit: "caixa" }) }), { params: Promise.resolve({ id: "p" }) });
    expect(res.status).toBe(200);
    expect(patch).toEqual({ sale_unit: "caixa" });
    expect(await res.json()).toMatchObject({ data: { ativo: false, controla_estoque: true, quantidade: 17, sale_unit: "caixa" } });
  });

  it("suporte somente leitura é bloqueado antes da escrita", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(new Response("bloqueado", { status: 403 }) as never);
    const { PATCH } = await import("@/app/api/v1/products/[id]/route");
    const res = await PATCH(new NextRequest("http://x", { method: "PATCH", body: JSON.stringify({ sale_unit: "un" }) }), { params: Promise.resolve({ id: "p" }) });
    expect(res.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("recusa sale_unit inválida antes de tocar no catálogo", async () => {
    const { PATCH } = await import("@/app/api/v1/products/[id]/route");
    const res = await PATCH(new NextRequest("http://x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ sale_unit: "x".repeat(33) }) }), { params: Promise.resolve({ id: "p" }) });
    expect(res.status).toBe(422);
    expect(patch).toBeNull();
  });
});
