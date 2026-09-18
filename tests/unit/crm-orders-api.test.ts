import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRole, requireSupportWrite, executeOrderCommand, createClient } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  requireSupportWrite: vi.fn(),
  executeOrderCommand: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite }));
vi.mock("@/src/crm/orders/service", async (importOriginal) => ({
  ...(await importOriginal()),
  executeOrderCommand,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

import * as list from "@/app/api/v1/crm-orders/route";
import * as detail from "@/app/api/v1/crm-orders/[id]/route";
import * as commands from "@/app/api/v1/crm-orders/commands/route";
import { OrderServiceError } from "@/src/crm/orders/service";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const body = {
  command: "create_draft",
  idempotency_key: "key",
  contact_id: ID,
  company_id: null,
  company_name: null,
  channel: null,
  delivery_date: null,
  currency: null,
  items: [],
};
const order = {
  id: ID,
  contact_id: ID,
  company_id: null,
  company_name: null,
  source: "ui",
  channel: null,
  delivery_date: null,
  status: "draft",
  revision: 1,
  currency: null,
  total_cents: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  confirmed_at: null,
  items: [],
  pending: [],
};
function req(url: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: body ? "POST" : "GET",
    ...(body
      ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
      : {}),
  });
}
function chain(result: unknown) {
  const q = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    maybeSingle: vi.fn(),
  };
  for (const n of ["select", "eq", "order"] as const) q[n].mockReturnValue(q);
  q.range.mockResolvedValue(result);
  q.maybeSingle.mockResolvedValue(result);
  return q;
}
beforeEach(() => {
  vi.resetAllMocks();
  requireSupportWrite.mockResolvedValue(null);
  requireRole.mockResolvedValue({
    ok: true,
    user: { id: USER, support: false },
    org: { orgId: ORG, role: "agent" },
  });
  executeOrderCommand.mockResolvedValue({ order, replayed: false });
});

describe("API pedidos", () => {
  it("POST usa apenas sessão confiável, schema estrito e 201/200 de replay", async () => {
    let res = await commands.POST(req("/api/v1/crm-orders/commands", body));
    expect(res.status).toBe(201);
    expect(executeOrderCommand).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: ORG, user_id: USER, source: "session" }),
      { type: "human", user_id: USER },
      expect.objectContaining({ command: "create_draft" }),
      expect.anything(),
    );
    executeOrderCommand.mockResolvedValueOnce({ order, replayed: true });
    res = await commands.POST(req("/api/v1/crm-orders/commands", body));
    expect(res.status).toBe(200);
    res = await commands.POST(
      req("/api/v1/crm-orders/commands", { ...body, organization_id: ORG }),
    );
    expect(res.status).toBe(422);
    expect(executeOrderCommand).toHaveBeenCalledTimes(2);
  });
  it("nega viewer e suporte antes do serviço", async () => {
    requireRole.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await commands.POST(req("/api/v1/crm-orders/commands", body))).status).toBe(403);
    requireRole.mockResolvedValueOnce({
      ok: true,
      user: { id: USER, support: true },
      org: { orgId: ORG, role: "manager" },
    });
    expect((await commands.POST(req("/api/v1/crm-orders/commands", body))).status).toBe(403);
    expect(executeOrderCommand).not.toHaveBeenCalled();
  });
  it("respeita a guarda de efeito antes de executar o comando", async () => {
    const denied = new Response(null, { status: 503 });
    requireSupportWrite.mockResolvedValueOnce(denied);
    expect(await commands.POST(req("/api/v1/crm-orders/commands", body))).toBe(denied);
    expect(executeOrderCommand).not.toHaveBeenCalled();
  });
  it("mapeia conflitos, apagamento e validação", async () => {
    for (const [error, status] of [
      [new OrderServiceError("revision_conflict", 409), 409],
      [new OrderServiceError("order_redacted", 410), 410],
      [new OrderServiceError("contact_unavailable", 422), 422],
      [new OrderServiceError("contact_change_not_allowed", 422), 422],
    ] as const) {
      executeOrderCommand.mockRejectedValueOnce(error);
      expect((await commands.POST(req("/api/v1/crm-orders/commands", body))).status).toBe(status);
    }
  });
  it("GET usa tenant, paginação e não encontra id estrangeiro", async () => {
    const q = chain({
      data: [{ ...order, contact: { display_name: "Ana", name: null } }],
      error: null,
      count: 101,
    });
    createClient.mockResolvedValue({ from: vi.fn(() => q) });
    const res = await list.GET(req("/api/v1/crm-orders?page=2&limit=50") as never);
    expect(res.status).toBe(200);
    expect(q.eq).toHaveBeenCalledWith("organization_id", ORG);
    expect(q.range).toHaveBeenCalledWith(50, 99);
    expect(await res.json()).toMatchObject({
      meta: { total: 101, has_more: true },
      data: [{ contact_name: "Ana" }],
    });
    const foreign = chain({ data: null, error: null });
    createClient.mockResolvedValue({ from: vi.fn(() => foreign) });
    expect(
      (await detail.GET(req("/api/v1/crm-orders/" + ID), { params: Promise.resolve({ id: ID }) }))
        .status,
    ).toBe(404);
    expect(foreign.eq).toHaveBeenCalledWith("organization_id", ORG);
  });
});
