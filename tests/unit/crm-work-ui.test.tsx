import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { CrmNotes } from "@/components/crm/CrmNotes";
import { LinkedOrderTasks } from "@/components/crm/LinkedOrderTasks";
import { TaskHistory } from "@/components/crm/TaskHistory";
import { createCrmNoteSchema, linkedTaskCommandSchema } from "@/src/crm/work/contracts";

const t = (text: string) => text;
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => t }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({
  useTagDeIdioma: () => "es-ES",
}));
const CONTACT = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const ORDER = "20000000-0000-4000-8000-000000000001";
const NOTE = "30000000-0000-4000-8000-000000000001";
const USER = "40000000-0000-4000-8000-000000000001";
const TASK = "50000000-0000-4000-8000-000000000001";
const note = {
  id: NOTE,
  contact_id: CONTACT,
  order_id: ORDER,
  body: "<b>Texto literal</b>",
  actor_user_id: USER,
  created_at: "2026-09-09T12:30:00Z",
  redacted_at: null,
};
const task = {
  id: TASK,
  order_id: ORDER,
  title: "Conferir volumes",
  description: "Dado sintético",
  due_date: "2026-09-10T12:30:17Z",
  status: "pending",
  revision: 3,
  created_at: "2026-09-09T12:30:00Z",
};
const taskEvent = {
  id: "60000000-0000-4000-8000-000000000001",
  task_id: TASK,
  order_id: ORDER,
  contact_id: CONTACT,
  task_revision: 2,
  event_type: "status_changed",
  from_status: "pending",
  to_status: "done",
  actor_type: "user",
  actor_id: USER,
  created_at: "2026-09-09T12:30:00Z",
};
let fetchMock: ReturnType<typeof vi.fn>;
function response(data: unknown, status = 200, meta: unknown = {}) {
  return new Response(JSON.stringify({ data, meta }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function rejected(status = 500) {
  return new Response(JSON.stringify({ error: { message: "Falha sintética." } }), { status });
}
function writes() {
  return fetchMock.mock.calls
    .filter(([, options]) => options?.method === "POST")
    .map(([url, options]) => ({
      url: String(url),
      body: JSON.parse(options.body),
    }));
}
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CrmNotes", () => {
  it("viewer lê texto simples, autor/data e anonimização sem controles de escrita", async () => {
    fetchMock.mockResolvedValue(
      response([
        note,
        {
          ...note,
          id: OTHER,
          body: "Não exibir conteúdo antigo",
          actor_user_id: null,
          redacted_at: "2026-09-09T15:00:00Z",
        },
      ]),
    );
    const { container } = render(
      <CrmNotes
        contactId={CONTACT}
        orderId={ORDER}
        canEdit={false}
        authorNames={{ [USER]: "Operador de teste" }}
      />,
    );
    expect(await screen.findByText("<b>Texto literal</b>")).toBeVisible();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText("Nota anonimizada.")).toBeVisible();
    expect(screen.queryByText("Não exibir conteúdo antigo")).toBeNull();
    expect(screen.getByText(/Operador de teste/)).toBeVisible();
    expect(screen.getByText(/Autor registrado/)).toBeVisible();
    expect(container.textContent).not.toContain(USER);
    expect(
      screen.getAllByText(
        new Date(note.created_at).toLocaleString("es-ES", {
          dateStyle: "short",
          timeStyle: "short",
        }),
      ),
    ).toHaveLength(2);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(writes()).toEqual([]);
  });

  it("paginação envia cursor e remove sobreposição por identidade", async () => {
    fetchMock
      .mockResolvedValueOnce(response([note], 200, { has_more: true, cursor: "cursor/+=" }))
      .mockResolvedValueOnce(response([note, { ...note, id: OTHER, body: "Segunda nota" }]));
    render(<CrmNotes contactId={CONTACT} canEdit={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais notas" }));
    expect(await screen.findByText("Segunda nota")).toBeVisible();
    expect(screen.getAllByText(note.body)).toHaveLength(1);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("cursor=cursor%2F%2B%3D");
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain("order_id");
  });

  it("resposta perdida preserva texto/UUID e replay relê sem duplicar a nota", async () => {
    fetchMock
      .mockResolvedValueOnce(response([]))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response(note, 200, { replayed: true }))
      .mockResolvedValueOnce(response([{ ...note, body: "Retornar amanhã" }]));
    render(<CrmNotes contactId={CONTACT} orderId={ORDER} canEdit />);
    await screen.findByText("Nenhuma nota registrada.");
    fireEvent.change(screen.getByLabelText("Nova nota"), {
      target: { value: "Retornar amanhã" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nota" }));
    await screen.findByText(/Não foi possível confirmar o envio da nota/);
    expect(screen.getByLabelText("Nova nota")).toHaveValue("Retornar amanhã");
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvar nota" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Salvar nota" }));
    await waitFor(() => expect(screen.getByLabelText("Nova nota")).toHaveValue(""));
    expect(screen.getByText("Nota já registrada.")).toBeVisible();
    expect(screen.getAllByText("Retornar amanhã")).toHaveLength(1);
    expect(writes()).toHaveLength(2);
    expect(writes()[0]?.body).toEqual(writes()[1]?.body);
    expect(writes()[0]?.body).toEqual({
      id: expect.any(String),
      contact_id: CONTACT,
      order_id: ORDER,
      body: "Retornar amanhã",
    });
    expect(createCrmNoteSchema.safeParse(writes()[0]?.body).success).toBe(true);
  });

  it("trocar conteúdo troca UUID, mas retornar ao rascunho anterior conserva sua tentativa", async () => {
    fetchMock.mockImplementation(async (_url, options) =>
      options?.method === "POST" ? rejected() : response([]),
    );
    render(<CrmNotes contactId={CONTACT} canEdit />);
    await screen.findByText("Nenhuma nota registrada.");
    for (const body of ["Nota A", "Nota B", "Nota A"]) {
      fireEvent.change(screen.getByLabelText("Nova nota"), {
        target: { value: body },
      });
      fireEvent.click(screen.getByRole("button", { name: "Salvar nota" }));
      await screen.findByText("Falha sintética.");
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Salvar nota" })).toBeEnabled(),
      );
    }
    const sent = writes();
    expect(sent).toHaveLength(3);
    expect(sent[0]?.body.id).not.toBe(sent[1]?.body.id);
    expect(sent[0]?.body.id).toBe(sent[2]?.body.id);
    expect(sent[0]?.body).not.toHaveProperty("order_id");
  });

  it("POST confirmado com releitura falha bloqueia reenvio até atualizar a lista", async () => {
    fetchMock
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response(note, 201))
      .mockResolvedValueOnce(rejected())
      .mockResolvedValueOnce(response([note]));
    render(<CrmNotes contactId={CONTACT} canEdit />);
    await screen.findByText("Nenhuma nota registrada.");
    fireEvent.change(screen.getByLabelText("Nova nota"), {
      target: { value: "Texto preservado" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nota" }));
    await screen.findByText(/A nota foi registrada, mas a lista/);
    expect(screen.getByLabelText("Nova nota")).toHaveValue("Texto preservado");
    expect(screen.getByRole("button", { name: "Salvar nota" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Recarregar notas" }));
    await waitFor(() => expect(screen.getByLabelText("Nova nota")).toHaveValue(""));
    expect(writes()).toHaveLength(1);
  });

  it("falha de leitura preserva linhas anteriores e não mostra vazio", async () => {
    fetchMock.mockResolvedValueOnce(response([note])).mockResolvedValueOnce(rejected());
    render(<CrmNotes contactId={CONTACT} canEdit={false} />);
    await screen.findByText(note.body);
    fireEvent.click(screen.getByRole("button", { name: "Recarregar notas" }));
    await screen.findByText(/Não foi possível carregar as notas/);
    expect(screen.getByText(note.body)).toBeVisible();
    expect(screen.queryByText("Nenhuma nota registrada.")).toBeNull();
  });
});

describe("LinkedOrderTasks", () => {
  it("viewer vê tarefas e situação sem controles de escrita", async () => {
    fetchMock.mockResolvedValue(response([task]));
    render(<LinkedOrderTasks orderId={ORDER} canEdit={false} />);
    expect(await screen.findByText(task.title)).toBeVisible();
    expect(screen.getByText("Pendente")).toBeVisible();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(writes()).toEqual([]);
  });

  it("cria com payload mínimo, prazo ISO, sem atribuição automática nem identidade forjada", async () => {
    fetchMock
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ task_id: TASK }, 201))
      .mockResolvedValueOnce(response([task]));
    render(<LinkedOrderTasks orderId={ORDER} canEdit />);
    await screen.findByText("Nenhuma tarefa neste pedido.");
    fireEvent.change(screen.getByLabelText("Título da tarefa"), {
      target: { value: "  Conferir volumes  " },
    });
    fireEvent.change(screen.getByLabelText("Descrição da tarefa"), {
      target: { value: "Revisar lista" },
    });
    fireEvent.change(screen.getByLabelText("Prazo da tarefa"), {
      target: { value: "2026-09-10T09:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar tarefa" }));
    await waitFor(() => expect(screen.getByLabelText("Título da tarefa")).toHaveValue(""));
    expect(writes()[0]?.body).toEqual({
      command_id: expect.any(String),
      command: "create_linked_task",
      order_id: ORDER,
      title: task.title,
      description: "Revisar lista",
      due_date: new Date("2026-09-10T09:30").toISOString(),
    });
    expect(linkedTaskCommandSchema.safeParse(writes()[0]?.body).success).toBe(true);
  });

  it("edita apenas campos alterados e revisão; replay relê a lista", async () => {
    fetchMock
      .mockResolvedValueOnce(response([task]))
      .mockResolvedValueOnce(response({}, 200, { replayed: true }))
      .mockResolvedValueOnce(response([{ ...task, title: "Conferir caixas", revision: 4 }]));
    render(<LinkedOrderTasks orderId={ORDER} canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar tarefa" }));
    fireEvent.change(screen.getByLabelText("Título da tarefa"), {
      target: { value: "Conferir caixas" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar tarefa" }));
    await waitFor(() => expect(screen.getByLabelText("Título da tarefa")).toHaveValue(""));
    expect(screen.getByText("Comando já aplicado.")).toBeVisible();
    expect(writes()[0]?.body).toEqual({
      command_id: expect.any(String),
      command: "edit_linked_task",
      task_id: TASK,
      expected_revision: 3,
      title: "Conferir caixas",
    });
    expect(linkedTaskCommandSchema.safeParse(writes()[0]?.body).success).toBe(true);
  });

  it("409 conserva rascunho e exige recarga explícita antes de usar a nova revisão", async () => {
    fetchMock
      .mockResolvedValueOnce(response([task]))
      .mockResolvedValueOnce(rejected(409))
      .mockResolvedValueOnce(
        response([{ ...task, revision: 4, title: "Alterado por outra pessoa" }]),
      )
      .mockResolvedValueOnce(
        response([
          {
            ...task,
            revision: 5,
            title: "Última revisão",
            description: "Descrição alterada por outra pessoa",
            due_date: "2026-09-15T16:00:00Z",
          },
        ]),
      )
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response([{ ...task, revision: 6, title: "Meu rascunho" }]));
    render(<LinkedOrderTasks orderId={ORDER} canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar tarefa" }));
    fireEvent.change(screen.getByLabelText("Título da tarefa"), {
      target: { value: "Meu rascunho" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar tarefa" }));
    await screen.findByText("Alterado por outra pessoa");
    expect(screen.getByLabelText("Título da tarefa")).toHaveValue("Meu rascunho");
    expect(screen.getByRole("button", { name: "Salvar tarefa" })).toBeDisabled();
    expect(writes()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Recarregar tarefas" }));
    await screen.findByText("Lista atualizada. Confira seu rascunho antes de salvar.");
    expect(screen.getByLabelText("Título da tarefa")).toHaveValue("Meu rascunho");
    expect(screen.getByLabelText("Descrição da tarefa")).toHaveValue(
      "Descrição alterada por outra pessoa",
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar tarefa" }));
    await waitFor(() => expect(screen.getByLabelText("Título da tarefa")).toHaveValue(""));
    expect(writes()[0]?.body.expected_revision).toBe(3);
    expect(writes()[1]?.body.expected_revision).toBe(5);
    expect(writes()[1]?.body.command_id).not.toBe(writes()[0]?.body.command_id);
    expect(writes()[1]?.body.title).toBe("Meu rascunho");
    expect(writes()[1]?.body).not.toHaveProperty("description");
    expect(writes()[1]?.body).not.toHaveProperty("due_date");
  });

  it("muda situação da tarefa com revisão sem escrever estado do pedido", async () => {
    fetchMock
      .mockResolvedValueOnce(response([task]))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response([{ ...task, status: "done", revision: 4 }]));
    render(<LinkedOrderTasks orderId={ORDER} canEdit />);
    fireEvent.change(await screen.findByRole("combobox"), {
      target: { value: "done" },
    });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("done"));
    expect(writes()).toEqual([
      {
        url: "/api/v1/tasks/commands",
        body: {
          command_id: expect.any(String),
          command: "set_linked_task_status",
          task_id: TASK,
          expected_revision: 3,
          status: "done",
        },
      },
    ]);
    expect(linkedTaskCommandSchema.safeParse(writes()[0]?.body).success).toBe(true);
  });

  it("limpar descrição/prazo envia null somente nesses campos", async () => {
    fetchMock
      .mockResolvedValueOnce(response([task]))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(
        response([{ ...task, description: null, due_date: null, revision: 4 }]),
      );
    render(<LinkedOrderTasks orderId={ORDER} canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar tarefa" }));
    fireEvent.change(screen.getByLabelText("Descrição da tarefa"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Prazo da tarefa"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar tarefa" }));
    await waitFor(() => expect(screen.getByLabelText("Título da tarefa")).toHaveValue(""));
    expect(writes()[0]?.body).toEqual({
      command_id: expect.any(String),
      command: "edit_linked_task",
      task_id: TASK,
      expected_revision: 3,
      description: null,
      due_date: null,
    });
    expect(linkedTaskCommandSchema.safeParse(writes()[0]?.body).success).toBe(true);
  });

  it("salvar outra situação não perde UUID da criação cujo retorno se perdeu", async () => {
    fetchMock
      .mockResolvedValueOnce(response([task]))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(response([task]))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response([{ ...task, status: "done", revision: 4 }]))
      .mockResolvedValueOnce(response({}, 200, { replayed: true }))
      .mockResolvedValueOnce(
        response([
          { ...task, status: "done", revision: 4 },
          { ...task, id: OTHER, title: "Criar sem duplicar" },
        ]),
      );
    render(<LinkedOrderTasks orderId={ORDER} canEdit />);
    await screen.findByText(task.title);
    fireEvent.change(screen.getByLabelText("Título da tarefa"), {
      target: { value: "Criar sem duplicar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar tarefa" }));
    await screen.findByText(/Não foi possível confirmar o envio da tarefa/);
    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "done" },
    });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("done"));
    expect(screen.getByLabelText("Título da tarefa")).toHaveValue("Criar sem duplicar");
    fireEvent.click(screen.getByRole("button", { name: "Salvar tarefa" }));
    await waitFor(() => expect(screen.getByLabelText("Título da tarefa")).toHaveValue(""));
    expect(writes()).toHaveLength(3);
    expect(writes()[0]?.body).toEqual(writes()[2]?.body);
  });

  it("erro de rede mantém comando e dados para retry; confirmação com recarga falha bloqueia nova escrita", async () => {
    const onSaved = vi.fn();
    fetchMock
      .mockResolvedValueOnce(response([]))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({}, 200, { replayed: true }))
      .mockResolvedValueOnce(rejected())
      .mockResolvedValueOnce(response([task]));
    render(<LinkedOrderTasks orderId={ORDER} canEdit onSaved={onSaved} />);
    await screen.findByText("Nenhuma tarefa neste pedido.");
    fireEvent.change(screen.getByLabelText("Título da tarefa"), {
      target: { value: "Rascunho mantido" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar tarefa" }));
    await screen.findByText(/Não foi possível confirmar o envio da tarefa/);
    expect(onSaved).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Salvar tarefa" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar tarefa" }));
    await screen.findByText(/A tarefa foi salva, mas a lista/);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Salvar tarefa" })).toBeDisabled();
    expect(screen.getByLabelText("Título da tarefa")).toHaveValue("Rascunho mantido");
    expect(writes()[0]?.body).toEqual(writes()[1]?.body);
    fireEvent.click(screen.getByRole("button", { name: "Recarregar tarefas" }));
    await waitFor(() => expect(screen.getByLabelText("Título da tarefa")).toHaveValue(""));
    expect(writes()).toHaveLength(2);
  });

  it("paginação conserva cursor e troca de pedido limpa o rascunho e os dados anteriores", async () => {
    fetchMock
      .mockResolvedValueOnce(response([task], 200, { has_more: true, cursor: "pagina" }))
      .mockResolvedValueOnce(response([{ ...task, id: OTHER, title: "Outra tarefa" }]))
      .mockResolvedValueOnce(response([]));
    const view = render(<LinkedOrderTasks orderId={ORDER} canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais tarefas" }));
    await screen.findByText("Outra tarefa");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("cursor=pagina");
    fireEvent.change(screen.getByLabelText("Título da tarefa"), {
      target: { value: "Rascunho do pedido anterior" },
    });
    view.rerender(<LinkedOrderTasks orderId={OTHER} canEdit={false} />);
    await screen.findByText("Nenhuma tarefa neste pedido.");
    expect(screen.queryByText(task.title)).toBeNull();
    expect(screen.queryByDisplayValue("Rascunho do pedido anterior")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(writes()).toEqual([]);
  });
});

describe("TaskHistory", () => {
  it("mostra evento, revisão, estados, autor/data e link do pedido sem inventar diff de texto", async () => {
    fetchMock.mockResolvedValueOnce(
      response([
        taskEvent,
        {
          ...taskEvent,
          id: OTHER,
          event_type: "edited",
          actor_id: OTHER,
          task_revision: 3,
        },
      ]),
    );
    const view = render(
      <TaskHistory contactId={CONTACT} orderId={ORDER} authorNames={{ [USER]: "Autora real" }} />,
    );
    await screen.findByText("Situação da tarefa alterada");
    expect(screen.getByText("Pendente → Concluída")).toBeInTheDocument();
    expect(screen.getByText("Tarefa editada")).toBeInTheDocument();
    expect(screen.getByText(/Revisão da tarefa.*3/)).toBeInTheDocument();
    expect(screen.getByText(/Autora real/)).toBeInTheDocument();
    expect(screen.getByText(/Autor registrado/)).toBeInTheDocument();
    expect(view.container).not.toHaveTextContent(USER);
    expect(view.container).not.toHaveTextContent("Descrição alterada");
    const date = view.container.querySelector("time");
    expect(date).toHaveAttribute("dateTime", taskEvent.created_at);
    expect(date?.textContent).toBe(
      new Date(taskEvent.created_at).toLocaleString("es-ES", {
        dateStyle: "short",
        timeStyle: "short",
      }),
    );
    for (const link of screen.getAllByRole("link", { name: "Gerenciar no pedido" })) {
      expect(link).toHaveAttribute("href", `/app/orders/${ORDER}#tarefas`);
    }
    const query = new URL(String(fetchMock.mock.calls[0]?.[0]), "https://test.invalid")
      .searchParams;
    expect(query.get("contact_id")).toBe(CONTACT);
    expect(query.get("order_id")).toBe(ORDER);
    expect(writes()).toEqual([]);
  });

  it("pagina eventos por cursor sem repetir a ocorrência sobreposta", async () => {
    fetchMock
      .mockResolvedValueOnce(response([taskEvent], 200, { has_more: true, cursor: "event-page" }))
      .mockResolvedValueOnce(
        response([taskEvent, { ...taskEvent, id: OTHER, event_type: "created" }]),
      );
    render(<TaskHistory contactId={CONTACT} />);
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais eventos de tarefa" }));
    await screen.findByText("Tarefa criada");
    expect(screen.getAllByText("Situação da tarefa alterada")).toHaveLength(1);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("cursor=event-page");
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain("order_id=");
  });

  it("erro de recarga preserva eventos e não finge vazio", async () => {
    fetchMock
      .mockResolvedValueOnce(response([taskEvent]))
      .mockRejectedValueOnce(new Error("offline"));
    render(<TaskHistory contactId={CONTACT} />);
    await screen.findByText("Situação da tarefa alterada");
    fireEvent.click(screen.getByRole("button", { name: "Recarregar histórico de tarefas" }));
    await screen.findByRole("alert");
    expect(screen.getByText("Situação da tarefa alterada")).toBeInTheDocument();
    expect(screen.queryByText("Nenhum evento de tarefa registrado.")).not.toBeInTheDocument();
  });

  it("reloadKey após mutação relê o histórico; trocar contato não conserva o anterior", async () => {
    fetchMock
      .mockResolvedValueOnce(response([taskEvent]))
      .mockResolvedValueOnce(response([{ ...taskEvent, event_type: "edited" }]))
      .mockResolvedValueOnce(response([]));
    const view = render(<TaskHistory contactId={CONTACT} orderId={ORDER} reloadKey={0} />);
    await screen.findByText("Situação da tarefa alterada");
    view.rerender(<TaskHistory contactId={CONTACT} orderId={ORDER} reloadKey={1} />);
    await screen.findByText("Tarefa editada");
    expect(screen.queryByText("Situação da tarefa alterada")).not.toBeInTheDocument();
    view.rerender(<TaskHistory contactId={OTHER} reloadKey={1} />);
    await screen.findByText("Nenhum evento de tarefa registrado.");
    expect(screen.queryByText("Tarefa editada")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
