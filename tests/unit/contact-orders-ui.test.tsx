import * as React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Contact } from "@/lib/types/contacts";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: { get, post } }));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "operator" },
    activeOrg: { orgId: "org", role: "agent" },
  }),
}));
vi.mock("@/components/feedback/ApiErrorToast", () => ({
  showApiError: vi.fn(),
}));

import { ContactOrders } from "@/components/crm/ContactOrders";
import { OrderContactIdentity } from "@/components/crm/OrderContactIdentity";
import { OrdersClient } from "@/app/app/orders/_client";
import { initialOrderContact } from "@/app/app/orders/_initial-contact";

const CONTACT = "10000000-0000-4000-8000-000000000001";
const SECOND = "10000000-0000-4000-8000-000000000002";
const COMPANY = "30000000-0000-4000-8000-000000000001";
const OTHER_COMPANY = "30000000-0000-4000-8000-000000000002";
const ORDER = "20000000-0000-4000-8000-000000000001";
const contact = {
  id: CONTACT,
  name: "Contato sintético",
  display_name: null,
  phone_number: "+5511000000000",
  company_id: COMPANY,
  is_anonymized: false,
  is_merged_into: null,
} as Contact;
const order = {
  id: ORDER,
  contact_id: CONTACT,
  contact_name: "Contato sintético",
  status: "draft",
  delivery_date: "2026-09-15",
  total_cents: null,
  currency: null,
};
const page = (data: unknown[] = [], has_more = false) => ({
  data,
  meta: { page: 1, limit: 25, total: data.length, has_more },
});
function mount(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}
function draft() {
  return within(screen.getByRole("region", { name: "Novo pedido" }));
}
async function fillItem() {
  await screen.findByRole("link", { name: "Contato sintético" });
  fireEvent.change(screen.getByLabelText("Descrição solicitada"), {
    target: { value: "Item em revisão" },
  });
}
function defaults() {
  get.mockImplementation(async (path: string) => {
    if (path === `/api/v1/contacts/${CONTACT}`) return { data: contact };
    if (path === `/api/v1/contacts/${SECOND}`)
      return {
        data: {
          ...contact,
          id: SECOND,
          name: "Segundo contato",
          company_id: null,
        },
      };
    if (path === `/api/v1/companies/${COMPANY}`)
      return { data: { id: COMPANY, legal_name: "Empresa original" } };
    if (path.startsWith("/api/v1/companies?"))
      return page([{ id: OTHER_COMPANY, legal_name: "Outra empresa" }]);
    if (path.startsWith("/api/v1/contacts?"))
      return {
        data: [
          { ...contact, id: SECOND, name: "Segundo contato", company_id: null },
        ],
      };
    return page();
  });
  post.mockResolvedValue({ data: order, meta: { replayed: false } });
}
beforeEach(() => {
  vi.resetAllMocks();
  defaults();
});

describe("pedidos vinculados ao contato", () => {
  it("pagina com o contato em todas as consultas e dá acesso ao pedido existente", async () => {
    get
      .mockResolvedValueOnce(page([order], true))
      .mockResolvedValueOnce(page([{ ...order, id: SECOND }], false));
    mount(<ContactOrders contactId={CONTACT} canCreate />);
    expect(
      await screen.findByRole("link", { name: /Pedido 20000000/ }),
    ).toHaveAttribute("href", `/app/orders/${ORDER}`);
    expect(
      screen.getByRole("link", { name: "Novo pedido para este contato" }),
    ).toHaveAttribute("href", `/app/orders?new=1&contact_id=${CONTACT}`);
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await screen.findByRole("link", { name: /Pedido 10000000/ });
    expect(
      get.mock.calls.map(([path]) =>
        new URL(path, "https://example.invalid").searchParams.get("contact_id"),
      ),
    ).toEqual([CONTACT, CONTACT]);
    expect(
      get.mock.calls.map(([path]) =>
        new URL(path, "https://example.invalid").searchParams.get("page"),
      ),
    ).toEqual(["1", "2"]);
    expect(screen.getByRole("button", { name: "Próxima" })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it("falha tem recarga e não vira lista vazia; viewer não tem atalho de criação", async () => {
    get
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page());
    mount(<ContactOrders contactId={CONTACT} canCreate={false} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível carregar pedidos.",
    );
    expect(
      screen.queryByText("Nenhum pedido encontrado."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Novo pedido para este contato" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await screen.findByText("Nenhum pedido encontrado.");
  });

  it("troca de contato descarta resposta tardia e reinicia a paginação", async () => {
    let resolveFirst!: (value: unknown) => void;
    get
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(page());
    const view = mount(<ContactOrders contactId={CONTACT} canCreate={false} />);
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ContactOrders contactId={SECOND} canCreate={false} />
      </QueryClientProvider>,
    );
    await screen.findByText("Nenhum pedido encontrado.");
    await act(async () => resolveFirst(page([order])));
    expect(
      screen.queryByRole("link", { name: /Pedido 20000000/ }),
    ).not.toBeInTheDocument();
    expect(get.mock.lastCall?.[0]).toContain(`contact_id=${SECOND}&page=1`);
  });

  it("pré-seleção exige pedido novo e UUID único válido", () => {
    expect(initialOrderContact({ new: "1", contact_id: CONTACT })).toBe(
      CONTACT,
    );
    expect(initialOrderContact({ new: "0", contact_id: CONTACT })).toBe("");
    expect(
      initialOrderContact({ new: "1", contact_id: [CONTACT, SECOND] }),
    ).toBe("");
    expect(initialOrderContact({ new: "1", contact_id: "../../outro" })).toBe(
      "",
    );
  });

  it("identidade anonimizada nunca mostra nome ou telefone residual", async () => {
    get.mockResolvedValue({ data: { ...contact, is_anonymized: true } });
    mount(<OrderContactIdentity contactId={CONTACT} />);
    expect(
      await screen.findByRole("link", { name: "Contato anonimizado" }),
    ).toHaveAttribute("href", `/app/contacts/${CONTACT}`);
    expect(screen.queryByText("Contato sintético")).not.toBeInTheDocument();
    expect(screen.queryByText(contact.phone_number!)).not.toBeInTheDocument();
  });

  it("identidade falha visivelmente e relê o contato pela rota existente", async () => {
    get
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: contact });
    mount(<OrderContactIdentity contactId={CONTACT} />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Recarregar contato" }));
    await screen.findByRole("link", { name: "Contato sintético" });
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      `/api/v1/contacts/${CONTACT}`,
      `/api/v1/contacts/${CONTACT}`,
    ]);
  });
});

describe("criação comercial explícita", () => {
  it("atalho preenche o contato real, mas empresa sugerida e canal continuam opcionais", async () => {
    mount(<OrdersClient podeEditar initialContactId={CONTACT} startCreating />);
    await fillItem();
    await screen.findByRole("button", { name: "Usar empresa do contato" });
    fireEvent.click(draft().getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      contact_id: CONTACT,
      company_id: null,
      company_name: null,
      channel: null,
    });
    expect(Object.keys(post.mock.calls[0]![1]).sort()).toEqual([
      "channel",
      "command",
      "company_id",
      "company_name",
      "contact_id",
      "currency",
      "delivery_date",
      "idempotency_key",
      "items",
    ]);
  });

  it("copia e permite editar o nome escolhido; rede preserva dados e UUID de retry", async () => {
    post
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce({ data: order, meta: { replayed: true } });
    mount(<OrdersClient podeEditar initialContactId={CONTACT} startCreating />);
    await fillItem();
    fireEvent.click(
      await screen.findByRole("button", { name: "Usar empresa do contato" }),
    );
    fireEvent.change(screen.getByLabelText("Nome da empresa no pedido"), {
      target: { value: " Nome combinado " },
    });
    fireEvent.change(screen.getByLabelText("Canal declarado (opcional)"), {
      target: { value: " Balcão " },
    });
    fireEvent.click(draft().getByRole("button", { name: "Salvar rascunho" }));
    await screen.findByText(
      "Não foi possível salvar. Seus dados continuam no formulário para tentar novamente.",
    );
    expect(screen.getByLabelText("Nome da empresa no pedido")).toHaveValue(
      " Nome combinado ",
    );
    fireEvent.click(draft().getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      company_id: COMPANY,
      company_name: "Nome combinado",
      channel: "Balcão",
      contact_id: CONTACT,
    });
    expect(post.mock.calls[1]?.[1]).toEqual(post.mock.calls[0]?.[1]);
    expect(post.mock.calls[1]?.[2]).toEqual({
      idempotencyKey: post.mock.calls[0]?.[1].idempotency_key,
    });
  });

  it("remover empresa permanece removido mesmo com a sugestão ainda visível", async () => {
    mount(<OrdersClient podeEditar initialContactId={CONTACT} startCreating />);
    await fillItem();
    fireEvent.click(
      await screen.findByRole("button", { name: "Usar empresa do contato" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remover empresa do pedido" }),
    );
    expect(
      screen.getByRole("button", { name: "Usar empresa do contato" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Nome da empresa no pedido"),
    ).not.toBeInTheDocument();
    fireEvent.click(draft().getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      company_id: null,
      company_name: null,
    });
  });

  it("trocar o contato limpa a escolha anterior sem trocar os itens digitados", async () => {
    mount(<OrdersClient podeEditar initialContactId={CONTACT} startCreating />);
    await fillItem();
    fireEvent.click(
      await screen.findByRole("button", { name: "Usar empresa do contato" }),
    );
    fireEvent.change(screen.getByLabelText("Buscar contato"), {
      target: { value: "Segundo" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Segundo contato" }),
    );
    await screen.findByRole("link", { name: "Segundo contato" });
    expect(
      screen.queryByLabelText("Nome da empresa no pedido"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Descrição solicitada")).toHaveValue(
      "Item em revisão",
    );
    fireEvent.click(draft().getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      contact_id: SECOND,
      company_id: null,
      company_name: null,
    });
  });

  it("permite escolher outra empresa e rejeita nome do snapshot vazio", async () => {
    mount(<OrdersClient podeEditar initialContactId={CONTACT} startCreating />);
    await fillItem();
    fireEvent.change(screen.getByLabelText("Buscar empresa por razão social"), {
      target: { value: "Outra" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Outra empresa" }),
    );
    fireEvent.change(screen.getByLabelText("Nome da empresa no pedido"), {
      target: { value: "  " },
    });
    fireEvent.click(draft().getByRole("button", { name: "Salvar rascunho" }));
    expect(
      await screen.findByText(
        "Informe o nome da empresa no pedido ou remova a empresa.",
      ),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Nome da empresa no pedido"), {
      target: { value: "Outra empresa" },
    });
    fireEvent.click(draft().getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      company_id: OTHER_COMPANY,
      company_name: "Outra empresa",
    });
  });

  it("erro no contato bloqueia criação até releitura; anonimizado também não recebe pedido", async () => {
    const normal = get.getMockImplementation()!;
    let attempts = 0;
    get.mockImplementation(async (path: string) => {
      if (path === `/api/v1/contacts/${CONTACT}`) {
        if (attempts++ === 0) throw new Error("offline");
        return { data: { ...contact, is_anonymized: true } };
      }
      return normal(path);
    });
    mount(<OrdersClient podeEditar initialContactId={CONTACT} startCreating />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Recarregar contato" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Este contato não pode receber novos pedidos.",
      ),
    );
    expect(
      draft().getByRole("button", { name: "Salvar rascunho" }),
    ).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it("viewer não abre o formulário mesmo recebendo o atalho de criação", async () => {
    mount(
      <OrdersClient
        podeEditar={false}
        initialContactId={CONTACT}
        startCreating
      />,
    );
    await screen.findByText("Nenhum pedido encontrado.");
    expect(
      screen.queryByRole("region", { name: "Novo pedido" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Novo pedido" }),
    ).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});
