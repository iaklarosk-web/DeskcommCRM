import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDailyOrderReport, requireRole, logger } = vi.hoisted(() => ({
  getDailyOrderReport: vi.fn(),
  requireRole: vi.fn(),
  logger: { error: vi.fn() },
}));

vi.mock("@/src/crm/orders/daily", async (importOriginal) => ({
  ...(await importOriginal()),
  getDailyOrderReport,
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole }));
vi.mock("@/lib/logger", () => ({ logger }));

import { GET } from "@/app/api/v1/crm-orders/daily/route";
import { DailyOrderReportError } from "@/src/crm/orders/daily";

const ORG = "10000000-0000-4000-8000-000000000001";
const USER = "20000000-0000-4000-8000-000000000001";
const SUPPORT = "30000000-0000-4000-8000-000000000001";
const report = {
  criteria: {
    date: "2026-09-10",
    basis: "delivery_date",
    timezone: "America/Sao_Paulo",
    organization: { id: "10000000-0000-4000-8000-000000000001", name: "Empresa fictícia A" },
    statuses_included: ["confirmed", "in_production", "delivered"],
  },
  generated_at: "2026-09-10T12:00:00.000Z",
  denominators: {
    matching_orders: 0,
    eligible_orders: 0,
    included_orders: 0,
    pending_orders: 0,
    excluded_status_orders: { draft: 0, cancelled: 0 },
    included_items: 0,
    groups: 0,
  },
  orders: [],
  groups: [],
  currency_totals: [],
};

const request = (query: string) => new Request(`http://localhost/api/v1/crm-orders/daily${query}`);

beforeEach(() => {
  vi.resetAllMocks();
  requireRole.mockResolvedValue({
    ok: true,
    user: { id: USER, support: { id: SUPPORT } },
    org: { orgId: ORG, role: "viewer" },
  });
  getDailyOrderReport.mockResolvedValue(report);
});

describe("API do relatório diário de pedidos", () => {
  it.each([
    "",
    "?date=2026-09-10",
    "?basis=delivery_date",
    "?date=10-09-2026&basis=delivery_date",
    "?date=2026-09-10&basis=updated_at",
    "?date=2026-09-10&basis=delivery_date&page=1",
  ])("exige somente date+basis explícitos: %s", async (query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(422);
    expect(requireRole).not.toHaveBeenCalled();
    expect(getDailyOrderReport).not.toHaveBeenCalled();
  });

  it("usa tenant e suporte confiáveis e nega bypass direto de plataforma", async () => {
    const response = await GET(request("?date=2026-09-10&basis=delivery_date"));
    expect(response.status).toBe(200);
    expect(requireRole).toHaveBeenCalledWith(
      "viewer",
      expect.objectContaining({
        resource: "crm_orders_daily",
        allowPlatformAdmin: false,
      }),
    );
    expect(getDailyOrderReport).toHaveBeenCalledWith(
      {
        organization_id: ORG,
        user_id: USER,
        role: "viewer",
        source: "session",
      },
      { support_session_id: SUPPORT },
      { date: "2026-09-10", basis: "delivery_date" },
    );
  });

  it("preserva negação do guard e mapeia a negação transacional", async () => {
    const denied = new Response(null, { status: 403 });
    requireRole.mockResolvedValueOnce({ ok: false, response: denied });
    expect(await GET(request("?date=2026-09-10&basis=created_at"))).toBe(denied);
    expect(getDailyOrderReport).not.toHaveBeenCalled();

    requireRole.mockResolvedValueOnce({
      ok: true,
      user: { id: USER },
      org: { orgId: ORG, role: "viewer" },
    });
    getDailyOrderReport.mockRejectedValueOnce(new DailyOrderReportError("forbidden_tenant", 403));
    expect((await GET(request("?date=2026-09-10&basis=created_at"))).status).toBe(403);
  });
});
