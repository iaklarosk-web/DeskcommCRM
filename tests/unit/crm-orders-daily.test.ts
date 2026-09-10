import { describe, expect, it } from "vitest";

import { presentDailyOrderReport } from "@/src/crm/orders/daily";

const CONTACT = "10000000-0000-4000-8000-000000000001";
const PRODUCT = "20000000-0000-4000-8000-000000000001";

const uuid = (prefix: number, value: number) =>
  `${prefix.toString().padStart(8, "0")}-0000-4000-8000-${value.toString().padStart(12, "0")}`;

function item(position: number, overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(30, position),
    position,
    requested_text: "Item solicitado",
    product_id: PRODUCT,
    product_name_snapshot: "Produto combinado",
    sale_unit_snapshot: "un",
    quantity: "1.000",
    unit_price_cents: 100,
    currency_snapshot: "BRL",
    line_total_cents: 100,
    ...overrides,
  };
}

function order(index: number, overrides: Record<string, unknown> = {}) {
  return {
    order_id: uuid(40, index),
    revision: 2,
    status: "confirmed",
    source: "ui",
    channel: null,
    delivery_date: "2026-09-10",
    created_at: "2026-09-10T12:00:00.000Z",
    contact_id: CONTACT,
    contact_name: "Contato fictício",
    company_id: null,
    company_name_snapshot: null,
    currency: "BRL",
    total_cents: 100,
    items: [item(index)],
    ...overrides,
  };
}

const row = (candidates: unknown[]) => ({
  authorized: true,
  timezone: "America/Sao_Paulo",
  organization: { id: "10000000-0000-4000-8000-000000000001", name: "Empresa fictícia A" },
  generated_at: "2026-09-10T15:00:00.000Z",
  candidates,
});
const query = { date: "2026-09-10", basis: "delivery_date" as const };

describe("relatório diário de pedidos", () => {
  it("preserva e agrega mais de 500 itens sem truncamento", () => {
    const items = Array.from({ length: 501 }, (_, index) => item(index + 1));
    const report = presentDailyOrderReport(row([order(1, { total_cents: 50_100, items })]), query);

    expect(report.orders).toHaveLength(1);
    expect(report.orders[0]?.items).toHaveLength(501);
    expect(report.denominators).toMatchObject({
      matching_orders: 1,
      eligible_orders: 1,
      included_orders: 1,
      pending_orders: 0,
      included_items: 501,
      groups: 1,
    });
    expect(report.groups[0]).toMatchObject({
      quantity: "501.000",
      total_cents: "50100",
      items: 501,
      orders: 1,
    });
  });

  it("separa descrição, unidade, moeda e item sem produto; pendência não soma", () => {
    const candidates = [
      order(1, {
        total_cents: 300,
        items: [item(1, { quantity: "1.500", unit_price_cents: 200, line_total_cents: 300 })],
      }),
      order(2, {
        total_cents: 200,
        items: [
          item(2, { sale_unit_snapshot: "kg", unit_price_cents: 200, line_total_cents: 200 }),
        ],
      }),
      order(3, {
        status: "delivered",
        total_cents: 100,
        items: [
          item(3, {
            requested_text: "Serviço avulso",
            product_id: null,
            product_name_snapshot: null,
            quantity: "2.000",
            unit_price_cents: 50,
            line_total_cents: 100,
          }),
        ],
      }),
      order(4, {
        currency: "USD",
        total_cents: 100,
        items: [item(4, { currency_snapshot: "USD" })],
      }),
      order(5, {
        status: "in_production",
        items: [item(5, { product_name_snapshot: "Outro nome combinado" })],
      }),
      order(6, {
        status: "confirmed",
        total_cents: null,
        items: [item(6, { line_total_cents: null })],
      }),
      order(7, { status: "draft" }),
      order(8, { status: "cancelled" }),
    ];
    const report = presentDailyOrderReport(row(candidates), query);

    expect(report.criteria).toEqual({
      date: "2026-09-10",
      basis: "delivery_date",
      timezone: "America/Sao_Paulo",
      organization: { id: "10000000-0000-4000-8000-000000000001", name: "Empresa fictícia A" },
      statuses_included: ["confirmed", "in_production", "delivered"],
    });
    expect(report.denominators).toEqual({
      matching_orders: 8,
      eligible_orders: 6,
      included_orders: 5,
      pending_orders: 1,
      excluded_status_orders: { draft: 1, cancelled: 1 },
      included_items: 5,
      groups: 5,
    });
    expect(
      report.groups.map((group) => [
        group.kind,
        group.description,
        group.sale_unit,
        group.currency,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["catalog", "Outro nome combinado", "un", "BRL"],
        ["catalog", "Produto combinado", "un", "BRL"],
        ["unlinked", "Serviço avulso", "un", "BRL"],
        ["catalog", "Produto combinado", "kg", "BRL"],
        ["catalog", "Produto combinado", "un", "USD"],
      ]),
    );
    expect(report.currency_totals).toEqual([
      { currency: "BRL", total_cents: "700" },
      { currency: "USD", total_cents: "100" },
    ]);
    expect(report.orders.find((entry) => entry.order_id === uuid(40, 6))).toMatchObject({
      included_in_totals: false,
      pending: expect.arrayContaining([
        { code: "total_required" },
        { code: "line_total_required", item_id: uuid(30, 6) },
      ]),
    });
  });

  it("falha fechado quando a autorização transacional não produz organização", () => {
    expect(() =>
      presentDailyOrderReport(
        { ...row([]), authorized: false, timezone: null },
        { date: "2026-09-10", basis: "created_at" },
      ),
    ).toThrow("forbidden_tenant");
  });
});
