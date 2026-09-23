import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: { get } }));
import { OrderHistory } from "@/app/app/orders/_history";
const event = {
  id: "event-private-id",
  order_id: "order",
  order_revision: 3,
  event_type: "order_confirmed",
  changes: { redacted: true },
  actor_type: "user",
  actor_id: "private-actor-id",
  created_at: "2026-01-01T00:00:00Z",
};
describe("histórico de pedidos", () => {
  beforeEach(() => vi.resetAllMocks());
  it("traduz evento humano e informa redação sem expor UUID ou JSON", async () => {
    get.mockResolvedValue({ data: [event], meta: { has_more: false, before_revision: null } });
    render(<OrderHistory orderId="order" revision={3} />);
    await screen.findByText("Pedido confirmado", { exact: false });
    expect(screen.getByText("Detalhes indisponíveis após anonimização.")).toBeInTheDocument();
    expect(screen.queryByText(/private-/)).toBeNull();
  });
  it("pagina sem duplicar e permite retry após falha", async () => {
    get
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValueOnce({ data: [event], meta: { has_more: true, before_revision: 3 } })
      .mockResolvedValueOnce({
        data: [event, { ...event, id: "two", order_revision: 2 }],
        meta: { has_more: false, before_revision: null },
      });
    render(<OrderHistory orderId="order" revision={3} />);
    fireEvent.click(await screen.findByRole("button", { name: "Tentar novamente" }));
    await screen.findByText("Pedido confirmado", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(screen.getAllByText(/Pedido confirmado/)).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });
  it("abandona resposta antiga quando muda pedido", async () => {
    let resolve: (value: unknown) => void = () => {
      throw new Error("requisição ainda não iniciou");
    };
    get.mockReturnValueOnce(new Promise((r) => (resolve = r))).mockResolvedValueOnce({
      data: [{ ...event, id: "new", event_type: "order_cancelled" }],
      meta: { has_more: false, before_revision: null },
    });
    const v = render(<OrderHistory orderId="old" revision={1} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    v.rerender(<OrderHistory orderId="new" revision={1} />);
    resolve({ data: [event], meta: { has_more: false, before_revision: null } });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await screen.findByText("Pedido cancelado", { exact: false });
    expect(screen.queryByText("Pedido confirmado", { exact: false })).toBeNull();
  });
  it("após nova revisão falhar, retry começa sem cursor antigo", async () => {
    get
      .mockResolvedValueOnce({ data: [event], meta: { has_more: true, before_revision: 3 } })
      .mockRejectedValueOnce(new Error("falha na revisão nova"))
      .mockResolvedValueOnce({
        data: [{ ...event, order_revision: 4, event_type: "order_edited" }],
        meta: { has_more: false, before_revision: null },
      });
    const view = render(<OrderHistory orderId="order" revision={3} />);
    await screen.findByRole("button", { name: "Carregar mais" });
    view.rerender(<OrderHistory orderId="order" revision={4} />);
    fireEvent.click(await screen.findByRole("button", { name: "Tentar novamente" }));
    await screen.findByText(/Pedido alterado/);
    expect(get.mock.calls[2]?.[0]).toBe("/api/v1/crm-orders/order/events?limit=25");
    expect(screen.queryByText(/Pedido confirmado/)).toBeNull();
  });
});
