import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { AuthUser, ActiveOrg } from "@/lib/auth/types";
import type { Tarefa } from "@/lib/tarefas/tipos";

const { auth, contact, get, notes, tasks, history } = vi.hoisted(() => ({
  auth: { user: {} as AuthUser, activeOrg: null as ActiveOrg | null },
  contact: { value: {} as Record<string, unknown> },
  get: vi.fn(),
  notes: vi.fn(),
  tasks: vi.fn(),
  history: vi.fn(),
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/contacts/useContact", () => ({
  useContact: () => ({ data: { data: contact.value }, refetch: vi.fn() }),
}));
vi.mock("@/hooks/pipelines/useDefaultPipeline", () => ({
  useDefaultPipeline: () => ({ data: null }),
}));
vi.mock("@/hooks/crm/useCrmAuthorNames", () => ({
  useCrmAuthorNames: () => ({ autor: "Nome real" }),
}));
vi.mock("@/components/crm/CrmNotes", () => ({
  CrmNotes: (props: unknown) => {
    notes(props);
    return <div data-testid="notes-placement" />;
  },
}));
vi.mock("@/components/crm/LinkedOrderTasks", () => ({
  LinkedOrderTasks: (props: unknown) => {
    tasks(props);
    return <div data-testid="tasks-placement" />;
  },
}));
vi.mock("@/components/crm/TaskHistory", () => ({
  TaskHistory: (props: unknown) => {
    history(props);
    return <div data-testid="task-history-placement" />;
  },
}));
vi.mock("@/components/contacts/TimelineView", () => ({
  TimelineView: ({ contactId }: { contactId: string }) => (
    <div data-testid="legacy-timeline">{contactId}</div>
  ),
}));
vi.mock("@/components/contacts/EditContactDialog", () => ({ EditContactDialog: () => null }));
vi.mock("@/components/contacts/AnonymizeDialog", () => ({ AnonymizeDialog: () => null }));
vi.mock("@/components/contacts/PropostasDeDado", () => ({ PropostasDeDado: () => null }));
vi.mock("@/components/kanban/ConversaNoDossie", () => ({ ConversaNoDossie: () => null }));
vi.mock("@/app/app/contacts/[id]/_commercial-link", () => ({ CommercialLink: () => null }));
vi.mock("@/app/app/orders/_history", () => ({
  OrderHistory: () => <div data-testid="order-history" />,
}));
vi.mock("@/lib/api/client", () => ({ apiClient: { get } }));

import { ContactDetailClient } from "@/app/app/contacts/[id]/_client";
import { OrderDetailClient } from "@/app/app/orders/[id]/_client";
import { ListaDeTarefas } from "@/app/app/tasks/_components/ListaDeTarefas";
import { CalendarioDeTarefas } from "@/app/app/tasks/_components/CalendarioDeTarefas";

const CONTACT = "10000000-0000-4000-8000-000000000001";
const ORDER = "20000000-0000-4000-8000-000000000001";
const task = {
  id: "50000000-0000-4000-8000-000000000001",
  title: "Tarefa vinculada",
  description: null,
  order_id: ORDER,
  priority: "medium",
  status: "pending",
  due_date: null,
} as Tarefa;

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: "user", is_platform_admin: false, support: null } as AuthUser;
  auth.activeOrg = { orgId: "org", role: "agent" } as ActiveOrg;
  contact.value = {
    id: CONTACT,
    tags: [],
    name: "Contato sintético",
    is_anonymized: false,
    is_merged_into: null,
    created_at: "2026-09-09T12:00:00Z",
    custom_fields: {},
    recurring: false,
  };
});
afterEach(cleanup);

describe("notas e tarefas nas telas reais", () => {
  it("ficha usa o contato real, oferece notas e preserva a timeline legada", async () => {
    render(<ContactDetailClient contactId={CONTACT} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Notas" }), { button: 0, ctrlKey: false });
    await screen.findByTestId("notes-placement");
    expect(notes).toHaveBeenLastCalledWith({
      contactId: CONTACT,
      canEdit: true,
      authorNames: { autor: "Nome real" },
    });
    expect(notes.mock.lastCall?.[0]).not.toHaveProperty("lead_id");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Timeline" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(await screen.findByTestId("legacy-timeline")).toHaveTextContent(CONTACT);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Histórico de tarefas" }), {
      button: 0,
      ctrlKey: false,
    });
    await screen.findByTestId("task-history-placement");
    expect(history).toHaveBeenLastCalledWith({
      contactId: CONTACT,
      authorNames: { autor: "Nome real" },
    });
  });

  it.each(["viewer", "support_readonly", "support_full", "platform", "anonymized", "merged"])(
    "ficha %s não oferece escrita de notas",
    async (mode) => {
      if (mode === "viewer") auth.activeOrg!.role = "viewer";
      else if (mode === "platform") auth.user.is_platform_admin = true;
      else if (mode === "anonymized") contact.value.is_anonymized = true;
      else if (mode === "merged") contact.value.is_merged_into = "outro-contato";
      else auth.user.support = { access_mode: mode } as AuthUser["support"];
      render(<ContactDetailClient contactId={CONTACT} />);
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Notas" }), {
        button: 0,
        ctrlKey: false,
      });
      await screen.findByTestId("notes-placement");
      expect(notes.mock.lastCall?.[0]).toMatchObject({ contactId: CONTACT, canEdit: false });
    },
  );

  it.each([true, false])(
    "pedido monta notas/tarefas com identidades lidas e acesso %s, preservando histórico",
    async (canEdit) => {
      get.mockResolvedValue({
        data: {
          id: ORDER,
          contact_id: CONTACT,
          items: [],
          pending: [],
          revision: 4,
          status: "delivered",
        },
      });
      render(<OrderDetailClient orderId={ORDER} podeEditar={canEdit} />);
      await screen.findByTestId("tasks-placement");
      expect(notes).toHaveBeenLastCalledWith({
        contactId: CONTACT,
        orderId: ORDER,
        canEdit,
        authorNames: { autor: "Nome real" },
      });
      expect(tasks).toHaveBeenLastCalledWith({
        orderId: ORDER,
        canEdit,
        onSaved: expect.any(Function),
      });
      expect(history).toHaveBeenLastCalledWith({
        contactId: CONTACT,
        orderId: ORDER,
        authorNames: { autor: "Nome real" },
        reloadKey: 0,
      });
      if (canEdit) {
        act(() => tasks.mock.lastCall?.[0].onSaved());
        expect(history.mock.lastCall?.[0].reloadKey).toBe(1);
      }
      expect(screen.getByTestId("order-history")).toBeInTheDocument();
      expect(screen.getByTestId("tasks-placement").closest("section")).toHaveAttribute(
        "id",
        "tarefas",
      );
      expect(screen.queryByRole("button", { name: "Editar pedido" })).not.toBeInTheDocument();
    },
  );
});

describe("tarefas vinculadas nas telas legadas", () => {
  it.each([true, false])(
    "lista dá link para o pedido e bloqueia mutações legadas com edição %s",
    (canEdit) => {
      const toggle = vi.fn(),
        edit = vi.fn(),
        remove = vi.fn();
      render(
        <ListaDeTarefas
          tarefas={[task]}
          podeEditar={canEdit}
          aoAlternarConcluida={toggle}
          aoEditar={edit}
          aoApagar={remove}
        />,
      );
      expect(screen.getByRole("link", { name: "Gerenciar no pedido" })).toHaveAttribute(
        "href",
        `/app/orders/${ORDER}#tarefas`,
      );
      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).toBeDisabled();
      fireEvent.click(checkbox);
      expect(toggle).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Editar a tarefa" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Apagar a tarefa" })).not.toBeInTheDocument();
      expect(edit).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    },
  );

  it("lista mantém edição e conclusão das tarefas independentes", async () => {
    const toggle = vi.fn().mockResolvedValue(undefined),
      edit = vi.fn();
    render(
      <ListaDeTarefas
        tarefas={[{ ...task, order_id: null }]}
        podeEditar
        aoAlternarConcluida={toggle}
        aoEditar={edit}
        aoApagar={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(toggle).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Editar a tarefa" }));
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ order_id: null }));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it.each([true, false])(
    "calendário usa link sem abrir formulário legado nem criar tarefa no dia (%s)",
    (canEdit) => {
      const open = vi.fn(),
        day = vi.fn();
      render(
        <CalendarioDeTarefas
          tarefas={[{ ...task, due_date: new Date().toISOString() }]}
          podeEditar={canEdit}
          aoAbrirTarefa={open}
          aoClicarNoDia={day}
        />,
      );
      const link = screen.getByRole("link", { name: "Tarefa vinculada · Gerenciar no pedido" });
      expect(link).toHaveAttribute("href", `/app/orders/${ORDER}#tarefas`);
      link.addEventListener("click", (event) => event.preventDefault());
      fireEvent.click(link);
      expect(open).not.toHaveBeenCalled();
      expect(day).not.toHaveBeenCalled();
    },
  );
});
