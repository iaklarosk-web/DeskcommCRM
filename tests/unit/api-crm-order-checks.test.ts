import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRole, requireSupportWrite, recordOrderCheck, createClient } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  requireSupportWrite: vi.fn(),
  recordOrderCheck: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/src/crm/orders/checks-service", async (importOriginal) => ({
  ...(await importOriginal()),
  recordOrderCheck,
}));

import { GET, POST } from "@/app/api/v1/crm-orders/[id]/checks/route";
import { OrderCheckServiceError } from "@/src/crm/orders/checks-service";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ORDER = "33333333-3333-4333-8333-333333333333";
const ITEM = "44444444-4444-4444-8444-444444444444";
const EVENT = "55555555-5555-4555-8555-555555555555";
const KEY = "66666666-6666-4666-8666-666666666666";
const check = {
  event_id: EVENT,
  event_sequence: "8",
  order_id: ORDER,
  order_revision: 2,
  item_id: ITEM,
  ordered_quantity: "2.000",
  checked_quantity: "1.000",
  sale_unit: "kg",
  state: "partial",
  checked_by_user_id: USER,
  checked_at: "2026-09-09T18:00:00.000Z",
};

function request(method: "GET" | "POST", body?: unknown, query = "") {
  return new NextRequest(`http://localhost/api/v1/crm-orders/${ORDER}/checks${query}`, {
    method,
    ...(body
      ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
      : {}),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  requireRole.mockResolvedValue({
    ok: true,
    user: { id: USER, support: false },
    org: { orgId: ORG, role: "agent" },
  });
  requireSupportWrite.mockResolvedValue(null);
  recordOrderCheck.mockResolvedValue({ check, replayed: false });
  createClient.mockResolvedValue({
    rpc: vi.fn().mockResolvedValue({
      data: {
        order_id: ORDER,
        order_revision: 2,
        items: [],
        history: [check],
        next_before_sequence: null,
      },
      error: null,
    }),
  });
});

describe("API de conferência de pedido", () => {
  it("POST usa tenant/ator da sessão, corpo estrito e distingue criação de replay", async () => {
    const body = {
      idempotency_key: KEY,
      expected_revision: 2,
      item_id: ITEM,
      checked_quantity: "1.000",
    };
    let response = await POST(request("POST", body), { params: Promise.resolve({ id: ORDER }) });
    expect(response.status).toBe(201);
    expect(recordOrderCheck).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: ORG, user_id: USER, source: "session" }),
      { type: "human", user_id: USER },
      ORDER,
      body,
      expect.objectContaining({ requestId: expect.any(String) }),
    );
    recordOrderCheck.mockResolvedValueOnce({ check, replayed: true });
    response = await POST(request("POST", body), { params: Promise.resolve({ id: ORDER }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ meta: { replayed: true } });
    response = await POST(request("POST", { ...body, organization_id: ORG }), {
      params: Promise.resolve({ id: ORDER }),
    });
    expect(response.status).toBe(422);
    expect(recordOrderCheck).toHaveBeenCalledTimes(2);
  });

  it("nega viewer, acompanhamento de suporte e guarda de efeito antes do serviço", async () => {
    expect(
      (await POST(request("POST", {}), { params: Promise.resolve({ id: ORDER }) })).status,
    ).toBe(422);
    const body = {
      idempotency_key: KEY,
      expected_revision: 2,
      item_id: ITEM,
      checked_quantity: "1.000",
    };
    requireRole.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 403 }) });
    expect(
      (await POST(request("POST", body), { params: Promise.resolve({ id: ORDER }) })).status,
    ).toBe(403);
    requireRole.mockResolvedValueOnce({
      ok: true,
      user: { id: USER, support: { status: "active" } },
      org: { orgId: ORG, role: "admin" },
    });
    expect(
      (await POST(request("POST", body), { params: Promise.resolve({ id: ORDER }) })).status,
    ).toBe(403);
    const unavailable = new Response(null, { status: 503 });
    requireSupportWrite.mockResolvedValueOnce(unavailable);
    expect(await POST(request("POST", body), { params: Promise.resolve({ id: ORDER }) })).toBe(
      unavailable,
    );
    expect(recordOrderCheck).not.toHaveBeenCalled();
  });

  it("mapeia conflitos e pendências sem vazar erro interno", async () => {
    const body = {
      idempotency_key: KEY,
      expected_revision: 2,
      item_id: ITEM,
      checked_quantity: "1.000",
    };
    for (const [code, status] of [
      ["revision_conflict", 409],
      ["idempotency_conflict", 409],
      ["ordered_quantity_unavailable", 422],
      ["sale_unit_unavailable", 422],
      ["checked_quantity_exceeds_ordered", 422],
    ] as const) {
      recordOrderCheck.mockRejectedValueOnce(new OrderCheckServiceError(code, status));
      expect(
        (await POST(request("POST", body), { params: Promise.resolve({ id: ORDER }) })).status,
      ).toBe(status);
    }
  });

  it("GET passa tenant e paginação para a leitura única e retorna 404 sem pedido", async () => {
    const db = await createClient();
    const response = await GET(request("GET", undefined, "?limit=10&before_sequence=20"), {
      params: Promise.resolve({ id: ORDER }),
    });
    expect(response.status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith("fn_crm_order_checks", {
      p_org: ORG,
      p_order: ORDER,
      p_limit: 10,
      p_before_sequence: "20",
    });
    createClient.mockResolvedValueOnce({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }) });
    expect(
      (await GET(request("GET"), { params: Promise.resolve({ id: ORDER }) })).status,
    ).toBe(404);
  });

  it("GET nega plataforma direta mesmo quando ela também possui membership", async () => {
    requireRole.mockResolvedValueOnce({
      ok: true,
      user: { id: USER, is_platform_admin: true, support: false },
      org: { orgId: ORG, role: "agent" },
    });
    expect(
      (await GET(request("GET"), { params: Promise.resolve({ id: ORDER }) })).status,
    ).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });
});
