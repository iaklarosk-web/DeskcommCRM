import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock("@/lib/api/client", () => ({ apiClient: { get, post } }));
// O histórico tem sua própria suíte; as filas de GET abaixo medem o comando e a releitura.
vi.mock("@/app/app/orders/_history", () => ({ OrderHistory: () => null }));
// Notas e tarefas têm sua própria suíte; aqui a fila de GET mede o pedido.
vi.mock("@/components/crm/CrmNotes", () => ({ CrmNotes: () => null }));
vi.mock("@/components/crm/LinkedOrderTasks", () => ({
  LinkedOrderTasks: () => null,
}));
vi.mock("@/components/crm/TaskHistory", () => ({ TaskHistory: () => null }));
vi.mock("@/components/crm/OrderChecks", () => ({ OrderChecks: () => null }));
vi.mock("@/hooks/crm/useCrmAuthorNames", () => ({
  useCrmAuthorNames: () => ({}),
}));

// Identidade comercial tem suíte própria; aqui a fila de GET mede somente o comando.
vi.mock("@/components/crm/OrderContactIdentity", () => ({
  OrderContactIdentity: () => null,
}));
vi.mock("@/components/crm/OrderCommercialFields", () => ({
  OrderCommercialFields: () => null,
}));
vi.mock("@/hooks/contacts/useContact", () => ({
  useContact: (id: string) => ({
    data: {
      data: {
        id,
        is_anonymized: false,
        is_merged_into: null,
        company_id: null,
      },
    },
  }),
}));

import { OrderDetailClient } from "@/app/app/orders/[id]/_client";
import { OrdersClient } from "@/app/app/orders/_client";
import {
  matchedQuantity,
  parseMoneyInput,
  quantityInput,
} from "@/app/app/orders/_presentation";
import { newItem, OrderForm } from "@/app/app/orders/_form";

const order = {
  id: "11111111-1111-4111-8111-111111111111",
  contact_id: "22222222-2222-4222-8222-222222222222",
  company_id: null,
  company_name: null,
  source: "ui" as const,
  channel: null,
  delivery_date: null,
  status: "draft" as const,
  revision: 1,
  currency: null,
  total_cents: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  confirmed_at: null,
  items: [],
  pending: [{ code: "quantity_missing" }],
};

function OrderFormHarness({
  onItemsChange,
}: {
  onItemsChange: (items: ReturnType<typeof newItem>[]) => void;
}) {
  const [items, setItems] = React.useState([newItem()]);
  return (
    <OrderForm
      contactId=""
      onContactChange={vi.fn()}
      items={items}
      onItemsChange={(next) => {
        onItemsChange(next);
        setItems(next);
      }}
      disabled={false}
    />
  );
}

describe("pedidos UI", () => {
  beforeEach(() => vi.resetAllMocks());

  it("copia o snapshot do produto sem converter a quantidade", async () => {
    get.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/v1/products")) {
        return {
          data: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              nome: "Caixa",
              codigo: "CX",
              preco_cents: 1299,
              moeda: "BRL",
              sale_unit: "cx",
            },
          ],
        };
      }
      return { data: [] };
    });
    const change = vi.fn();
    render(<OrderFormHarness onItemsChange={change} />);

    fireEvent.change(screen.getByLabelText("Buscar produto"), {
      target: { value: "ca" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Caixa (CX)" }));
    fireEvent.change(screen.getByLabelText("Quantidade"), {
      target: { value: "1,5 cx" },
    });

    await waitFor(() =>
      expect(change).toHaveBeenLastCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            product_name: "Caixa",
            sale_unit: "cx",
            unit_price_cents: 1299,
            currency: "BRL",
          }),
        ]),
      ),
    );
    expect(screen.getByText("Unidade: cx")).toBeInTheDocument();
  });

  it("bloqueia todos os controles durante o salvamento", () => {
    render(
      <OrderForm
        contactId=""
        onContactChange={vi.fn()}
        items={[newItem()]}
        onItemsChange={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByLabelText("Buscar contato")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Adicionar item" }),
    ).toBeDisabled();
  });

  it("não confirma pedido com pendência humana", async () => {
    get.mockResolvedValue({ data: order });
    render(<OrderDetailClient orderId={order.id} podeEditar />);

    const confirm = await screen.findByRole("button", { name: "Confirmar" });
    expect(confirm).toBeDisabled();
    expect(screen.getByText("Revisão humana necessária")).toBeInTheDocument();
  });

  it("viewer lê o pedido mas não recebe comandos de escrita", async () => {
    get.mockResolvedValue({ data: { ...order, pending: [] } });
    render(<OrderDetailClient orderId={order.id} podeEditar={false} />);

    await screen.findByText("Pedido");
    expect(
      screen.queryByRole("button", { name: "Editar pedido" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirmar" }),
    ).not.toBeInTheDocument();
  });

  it("preserva decimal PT-BR, preço em centavos e recusa sufixo de unidade divergente", () => {
    expect(quantityInput("1.000")).toBe("1,000");
    expect(matchedQuantity("1,250 cx", "cx")).toBe("1.250");
    expect(matchedQuantity("1,250 kg", "cx")).toBeNull();
    expect(parseMoneyInput("19,90")).toBe(1990);
    expect(parseMoneyInput("19,999")).toBeNull();
  });

  it("pedido terminal não oferece novas mutações", async () => {
    get.mockResolvedValue({
      data: { ...order, status: "delivered", pending: [] },
    });
    render(<OrderDetailClient orderId={order.id} podeEditar />);
    await screen.findByTestId("pedido-detalhe");
    expect(
      screen.queryByRole("button", { name: "Editar pedido" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cancelar pedido" }),
    ).not.toBeInTheDocument();
  });

  it("replay recebe leitura autoritativa antes de liberar o próximo comando", async () => {
    get
      .mockResolvedValueOnce({ data: { ...order, pending: [] } })
      .mockResolvedValueOnce({ data: { ...order, revision: 2, pending: [] } });
    post.mockResolvedValueOnce({
      data: { ...order, pending: [] },
      meta: { replayed: true },
    });
    render(<OrderDetailClient orderId={order.id} podeEditar />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it("cria rascunho com moeda BRL explícita", async () => {
    get.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/v1/crm-orders"))
        return { data: [], meta: { has_more: false } };
      if (path.startsWith("/api/v1/contacts"))
        return {
          data: [{ id: order.contact_id, display_name: "Ana", name: null }],
        };
      return { data: [] };
    });
    post.mockResolvedValue({ data: order, meta: { replayed: false } });
    render(<OrdersClient podeEditar />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo pedido" }));
    fireEvent.change(screen.getByLabelText("Buscar contato"), {
      target: { value: "An" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Ana" }));
    fireEvent.change(screen.getByLabelText("Moeda do pedido"), {
      target: { value: "brl" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remover item" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ currency: "BRL" }),
        expect.anything(),
      ),
    );
  });

  it("não descarta um item preenchido cuja descrição está vazia", async () => {
    get.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/v1/crm-orders"))
        return { data: [], meta: { has_more: false } };
      if (path.startsWith("/api/v1/contacts"))
        return {
          data: [{ id: order.contact_id, display_name: "Ana", name: null }],
        };
      return { data: [] };
    });
    render(<OrdersClient podeEditar />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo pedido" }));
    fireEvent.change(screen.getByLabelText("Buscar contato"), {
      target: { value: "An" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Ana" }));
    fireEvent.change(screen.getByLabelText("Quantidade"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(
      await screen.findByText(
        "Descreva os itens ou remova as linhas vazias antes de salvar.",
      ),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Quantidade")).toHaveValue("2");
  });

  it("falha da leitura fresca bloqueia ações até recarregar, sem reenviar POST", async () => {
    get
      .mockResolvedValueOnce({ data: { ...order, pending: [] } })
      .mockRejectedValueOnce(new Error("fresh failed"))
      .mockResolvedValueOnce({ data: { ...order, pending: [] } });
    post.mockResolvedValueOnce({
      data: { ...order, pending: [] },
      meta: { replayed: true },
    });
    render(<OrderDetailClient orderId={order.id} podeEditar />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await screen.findByRole("button", { name: "Recarregar pedido" });
    expect(
      screen.getByRole("button", { name: "Editar pedido" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Recarregar pedido" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Recarregar pedido" }),
      ).toBeNull(),
    );
    expect(post).toHaveBeenCalledTimes(1);
  });
});
