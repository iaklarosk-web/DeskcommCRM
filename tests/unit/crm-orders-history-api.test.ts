import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { requireRole, createClient } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
import { GET } from "@/app/api/v1/crm-orders/[id]/events/route";
const ORG = "11111111-1111-4111-8111-111111111111",
  ID = "22222222-2222-4222-8222-222222222222";
function db(order: unknown, events: unknown) {
  const e = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    lt: vi.fn(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(events).then(resolve),
  };
  for (const key of ["select", "eq", "order", "limit", "lt"] as const) e[key].mockReturnValue(e);
  const o = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue(order) };
  o.select.mockReturnValue(o);
  o.eq.mockReturnValue(o);
  return { from: vi.fn((table: string) => (table === "crm_orders" ? o : e)), e, o };
}

beforeEach(() => {
  vi.resetAllMocks();
  requireRole.mockResolvedValue({ ok: true, org: { orgId: ORG } });
});
describe("histórico API", () => {
  it("filtra org, pagina cursor e não vaza pedido", async () => {
    const x = db(
      { data: { id: ID }, error: null },
      {
        data: [
          { id: "1", order_revision: 3 },
          { id: "2", order_revision: 2 },
          { id: "3", order_revision: 1 },
        ],
        error: null,
      },
    );
    createClient.mockResolvedValue(x);
    const r = await GET(new NextRequest(`http://x/api?limit=2&before_revision=4`), {
      params: Promise.resolve({ id: ID }),
    });
    expect(r.status).toBe(200);
    expect(x.e.eq).toHaveBeenCalledWith("organization_id", ORG);
    expect(x.o.eq).toHaveBeenCalledWith("organization_id", ORG);
    expect(x.e.eq).toHaveBeenCalledWith("order_id", ID);
    expect(x.e.lt).toHaveBeenCalledWith("order_revision", 4);
    expect(await r.json()).toMatchObject({ meta: { has_more: true, before_revision: 2 } });
  });
  it("retorna 404 foreign e 500 de erro", async () => {
    let x = db({ data: null, error: null }, { data: [], error: null });
    createClient.mockResolvedValue(x);
    expect(
      (await GET(new NextRequest("http://x"), { params: Promise.resolve({ id: ID }) })).status,
    ).toBe(404);
    x = db({ data: { id: ID }, error: null }, { data: null, error: { code: "x" } });
    createClient.mockResolvedValue(x);
    expect(
      (await GET(new NextRequest("http://x"), { params: Promise.resolve({ id: ID }) })).status,
    ).toBe(500);
  });
});
