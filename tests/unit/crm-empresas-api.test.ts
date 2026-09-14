import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import * as collection from "@/app/api/v1/companies/route";
import * as entity from "@/app/api/v1/companies/[id]/route";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const ORG = "a2000000-0000-4000-8000-000000000001";
const USER = "a2000000-0000-4000-8000-000000000002";
const ID = "a2000000-0000-4000-8000-000000000003";
const OTHER_ORG = "a2000000-0000-4000-8000-000000000004";
const company = {
  id: ID,
  organization_id: ORG,
  legal_name: "Empresa fictícia",
  trade_name: null,
  cnpj: null,
};
let result: { data: unknown; error: { code: string } | null; count: number | null };
const query = {
  select: vi.fn(),
  eq: vi.fn(),
  ilike: vi.fn(),
  order: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  range: vi.fn(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
};
const from = vi.fn();
const context = () => ({ params: Promise.resolve({ id: ID }) });
function request(method: string, body?: unknown, queryString = ""): NextRequest {
  return new NextRequest(`http://localhost/api/v1/companies${queryString}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  result = { data: company, error: null, count: 1 };
  for (const method of ["select", "eq", "ilike", "order", "insert", "update", "delete"] as const) {
    query[method].mockReturnValue(query);
  }
  for (const method of ["range", "single", "maybeSingle"] as const)
    query[method].mockImplementation(async () => result);
  from.mockReturnValue(query);
  vi.mocked(createClient).mockResolvedValue({ from } as never);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER },
    org: { orgId: ORG },
  } as never);
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
});

describe("empresas de clientes — API autorizada", () => {
  it("lista com escopo e paginação completa, distinguindo total de página", async () => {
    result = { data: [company], error: null, count: 102 };
    const res = await collection.GET(request("GET", undefined, "?page=2&limit=50&search=Empresa"));
    expect(res.status).toBe(200);
    expect(requireRole).toHaveBeenCalledWith("viewer", expect.anything());
    expect(query.eq).toHaveBeenCalledWith("organization_id", ORG);
    expect(query.range).toHaveBeenCalledWith(50, 99);
    expect(await res.json()).toMatchObject({
      data: [company],
      meta: { page: 2, total: 102, has_more: true },
    });
  });

  it("erro de leitura não vira lista vazia nem zero empresas", async () => {
    result = { data: null, error: { code: "XX000" }, count: null };
    const res = await collection.GET(request("GET"));
    expect(res.status).toBe(500);
    expect(await res.json()).toHaveProperty("error.code", "internal_error");
  });

  it("cadastra no tenant da sessão e audita uma mutação", async () => {
    const res = await collection.POST(request("POST", { legal_name: " Empresa fictícia " }));
    expect(res.status).toBe(201);
    expect(requireRole).toHaveBeenCalledWith("agent", expect.anything());
    expect(query.insert).toHaveBeenCalledWith({
      legal_name: "Empresa fictícia",
      organization_id: ORG,
    });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, actorUserId: USER, resourceId: ID }),
    );
  });

  it("rejeita tenant/autoria e campos desconhecidos vindos do corpo", async () => {
    for (const field of ["organization_id", "created_by", "is_admin"]) {
      const res = await collection.POST(
        request("POST", { legal_name: "Empresa", [field]: OTHER_ORG }),
      );
      expect(res.status).toBe(422);
    }
    expect(query.insert).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("PATCH preserva omissão e usa escopo explícito de tenant e recurso", async () => {
    const res = await entity.PATCH(request("PATCH", { trade_name: null }), context());
    expect(res.status).toBe(200);
    expect(query.update).toHaveBeenCalledWith({ trade_name: null });
    expect(query.eq).toHaveBeenCalledWith("organization_id", ORG);
    expect(query.eq).toHaveBeenCalledWith("id", ID);
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("GET, PATCH e DELETE retornam 404 para id fora do tenant sem auditar efeito", async () => {
    result = { data: null, error: null, count: null };
    expect((await entity.GET(request("GET"), context())).status).toBe(404);
    expect(
      (await entity.PATCH(request("PATCH", { legal_name: "Mudança" }), context())).status,
    ).toBe(404);
    expect((await entity.DELETE(request("DELETE"), context())).status).toBe(404);
    expect(query.eq.mock.calls.filter(([key]) => key === "organization_id")).toEqual([
      ["organization_id", ORG],
      ["organization_id", ORG],
      ["organization_id", ORG],
    ]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("escritas recusam suporte somente leitura antes de acessar dados", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(fail("forbidden", "Somente leitura.", 403));
    expect((await collection.POST(request("POST", { legal_name: "Empresa" }))).status).toBe(403);
    expect(
      (await entity.PATCH(request("PATCH", { legal_name: "Empresa" }), context())).status,
    ).toBe(403);
    expect((await entity.DELETE(request("DELETE"), context())).status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("todas as portas recusam o gate negado sem consultar tabelas", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "Sem acesso.", 403),
    });
    const responses = [
      await collection.GET(request("GET")),
      await collection.POST(request("POST", { legal_name: "Empresa" })),
      await entity.GET(request("GET"), context()),
      await entity.PATCH(request("PATCH", { trade_name: null }), context()),
      await entity.DELETE(request("DELETE"), context()),
    ];
    expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("conflitos de CNPJ e exclusão vinculada são 409 sem auditoria falsa", async () => {
    result = { data: null, error: { code: "23505" }, count: null };
    expect((await collection.POST(request("POST", { legal_name: "Empresa" }))).status).toBe(409);
    expect(
      (await entity.PATCH(request("PATCH", { legal_name: "Empresa" }), context())).status,
    ).toBe(409);
    result.error = { code: "23503" };
    expect((await entity.DELETE(request("DELETE"), context())).status).toBe(409);
    expect(audit).not.toHaveBeenCalled();
  });

  it("rejeita id inválido, patch vazio e paginação abusiva", async () => {
    expect(
      (await entity.GET(request("GET"), { params: Promise.resolve({ id: "não-uuid" }) })).status,
    ).toBe(422);
    expect((await entity.PATCH(request("PATCH", {}), context())).status).toBe(422);
    expect((await collection.GET(request("GET", undefined, "?limit=9999"))).status).toBe(422);
    expect(createClient).not.toHaveBeenCalled();
  });
});
