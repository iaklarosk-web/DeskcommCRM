import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: { get, post } }));

import { DailyOrdersClient } from "@/app/app/orders/daily/_client";
import { OrderChecks } from "@/components/crm/OrderChecks";

const item = {
  id: "33333333-3333-4333-8333-333333333333",
  product_name: "Produto",
  requested_text: "Produto",
  quantity: "2.000",
  sale_unit: "cx",
};
const report = {
  criteria: {
    date: "2026-09-09",
    basis: "delivery_date" as const,
    timezone: "America/Sao_Paulo",
    organization: { id: "10000000-0000-4000-8000-000000000001", name: "Empresa fictícia A" },
    statuses_included: ["confirmed"],
  },
  generated_at: "2026-09-09T12:00:00.000Z",
  denominators: {
    matching_orders: 2,
    eligible_orders: 2,
    included_orders: 2,
    pending_orders: 0,
    excluded_status_orders: { draft: 1, cancelled: 0 },
    included_items: 2,
    groups: 1,
  },
  groups: [
    {
      kind: "catalog" as const,
      product_id: "p",
      description: "Produto",
      sale_unit: "cx",
      currency: "BRL",
      quantity: "2.000",
      total_cents: "1234",
    },
  ],
  currency_totals: [{ currency: "BRL", total_cents: "1234" }],
  orders: [
    {
      order_id: "11111111-1111-4111-8111-111111111111",
      revision: 7,
      status: "confirmed",
      delivery_date: "2026-09-09",
      created_at: "2026-09-08T12:00:00.000Z",
      contact: { id: "c", current_name: "Ana" },
      company: { id: null, name_snapshot: null },
      pending: [],
      included_in_totals: true,
      items: [
        {
          id: item.id,
          position: 1,
          requested_text: "Produto",
          product_name_snapshot: "Produto",
          sale_unit_snapshot: "cx",
          quantity: "2.000",
        },
      ],
    },
  ],
};

describe("pedidos do dia e conferência", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("print", vi.fn());
  });

  it("exige critério antes de consultar", () => {
    render(<DailyOrdersClient />);
    expect(get).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Consultar" })).toBeDisabled();
  });

  it("imprime as 501 linhas do DTO já carregado sem nova consulta", async () => {
    const completeReport = {
      ...report,
      orders: Array.from({ length: 501 }, (_, index) => ({
        ...report.orders[0],
        order_id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
        contact: { id: `c-${index}`, current_name: `Ana ${index}` },
      })),
    };
    get.mockResolvedValueOnce({ data: completeReport });
    render(<DailyOrdersClient />);
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-09-09" } });
    fireEvent.change(screen.getByLabelText("Critério obrigatório"), {
      target: { value: "delivery_date" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Consultar" }));
    await screen.findByText("Ana 500 · Pedido 11111111-1111-4111-8111-000000000500");
    expect(screen.getAllByRole("link")).toHaveLength(502);
    expect(screen.getAllByText(/Produto · 2 cx/)).toHaveLength(502);
    fireEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(window.print).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledOnce();
  });

  it("apresenta erro e permite repetir a lista diária", async () => {
    get
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: { ...report, groups: [], orders: [] } });
    render(<DailyOrdersClient />);
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-09-09" } });
    fireEvent.change(screen.getByLabelText("Critério obrigatório"), {
      target: { value: "created_at" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Consultar" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await screen.findByText("Nenhum item elegível neste recorte.");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("mantém conferência somente leitura sem oferecer POST", async () => {
    get.mockResolvedValueOnce({
      data: {
        order_id: "o",
        order_revision: 7,
        items: [
          { item_id: item.id, checked_quantity: "0.000", state: "pending", order_revision: 7 },
        ],
        history: [],
        next_before_sequence: null,
      },
    });
    render(<OrderChecks orderId="o" revision={7} canEdit={false} items={[item]} />);
    await screen.findByText(/Pendente/);
    expect(screen.queryByRole("button", { name: "Registrar conferência" })).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("envia a quantidade na mesma unidade, com revisão e chave idempotente", async () => {
    get.mockResolvedValue({
      data: {
        order_id: "o",
        order_revision: 7,
        items: [
          { item_id: item.id, checked_quantity: "1.000", state: "partial", order_revision: 7 },
        ],
        history: [],
        next_before_sequence: null,
      },
    });
    post.mockResolvedValue({ data: {} });
    render(<OrderChecks orderId="o" revision={7} canEdit items={[item]} />);
    await screen.findByRole("button", { name: "Registrar conferência" });
    fireEvent.change(screen.getByLabelText("Quantidade conferida"), { target: { value: "2,000" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar conferência" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/api/v1/crm-orders/o/checks",
        expect.objectContaining({
          expected_revision: 7,
          item_id: item.id,
          checked_quantity: "2.000",
        }),
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      ),
    );
  });

  it("pede recarga após revisão vencida", async () => {
    get.mockResolvedValueOnce({
      data: {
        order_id: "o",
        order_revision: 7,
        items: [
          { item_id: item.id, checked_quantity: "0.000", state: "pending", order_revision: 7 },
        ],
        history: [],
        next_before_sequence: null,
      },
    });
    post.mockRejectedValueOnce({ status: 409 });
    render(<OrderChecks orderId="o" revision={7} canEdit items={[item]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar conferência" }));
    expect(
      await screen.findByText("O pedido mudou. Recarregue antes de conferir."),
    ).toBeInTheDocument();
  });
});
