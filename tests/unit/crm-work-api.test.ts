import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  support: vi.fn(),
  db: vi.fn(),
  note: vi.fn(),
  task: vi.fn(),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.auth }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mocks.support }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.db }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/src/crm/work/service", () => {
  class CrmWorkServiceError extends Error {
    constructor(
      readonly code: string,
      readonly status: number,
    ) {
      super(code);
    }
  }
  return {
    CrmWorkServiceError,
    createCrmNote: mocks.note,
    executeLinkedTaskCommand: mocks.task,
  };
});

import { GET as notes, POST as addNote } from "@/app/api/v1/crm-notes/route";
import { GET as taskEvents } from "@/app/api/v1/crm-task-events/route";
import { GET as tasks } from "@/app/api/v1/crm-orders/[id]/tasks/route";
import { POST as taskCommand } from "@/app/api/v1/tasks/commands/route";
import { decodeWorkCursor, workPage } from "@/src/crm/work/api";
import { CrmWorkServiceError } from "@/src/crm/work/service";

const ORG = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const USER = "20000000-0000-4000-8000-000000000001";
const CONTACT = "30000000-0000-4000-8000-000000000001";
const ORDER = "40000000-0000-4000-8000-000000000001";
const NOTE = "50000000-0000-4000-8000-000000000001";
const noteInput = {
  id: NOTE,
  contact_id: CONTACT,
  order_id: ORDER,
  body: "Cliente pediu retorno.",
};
const taskInput = {
  command: "create_linked_task",
  command_id: NOTE,
  order_id: ORDER,
  title: "Conferir entrega",
};
const params = { params: Promise.resolve({ id: ORDER }) };
function request(path: string, body?: unknown) {
  return new Request(
    `http://example.test${path}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
}
function authenticated(organizationId = ORG, support: unknown = null) {
  return {
    ok: true,
    user: { id: USER, support },
    org: { orgId: organizationId, role: "manager" },
  };
}
type Reply = { data: unknown; error: { message: string } | null };
function database(replies: Record<string, Reply>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const from = vi.fn((table: string) => {
    const chain = {
      select(...args: unknown[]) {
        calls.push({ table, method: "select", args });
        return this;
      },
      eq(...args: unknown[]) {
        calls.push({ table, method: "eq", args });
        return this;
      },
      order(...args: unknown[]) {
        calls.push({ table, method: "order", args });
        return this;
      },
      limit(...args: unknown[]) {
        calls.push({ table, method: "limit", args });
        return this;
      },
      or(...args: unknown[]) {
        calls.push({ table, method: "or", args });
        return this;
      },
      maybeSingle() {
        return Promise.resolve(replies[table] ?? { data: null, error: null });
      },
      then(resolve: (value: Reply) => unknown) {
        return Promise.resolve(replies[table] ?? { data: [], error: null }).then(resolve);
      },
    };
    return chain;
  });
  mocks.db.mockResolvedValue({ from });
  return { calls, from };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.support.mockResolvedValue(null);
  mocks.auth.mockResolvedValue(authenticated());
  mocks.note.mockResolvedValue({ note: noteInput, replayed: false });
  mocks.task.mockResolvedValue({
    result: { task_id: NOTE, task_revision: 1, status: "pending" },
    replayed: false,
  });
});

describe("API de notas e tarefas ligadas ao pedido", () => {
  it.each([ORG, OTHER])(
    "grava nota e tarefa usando somente o tenant/ator autenticados em %s",
    async (org) => {
      mocks.auth.mockResolvedValue(authenticated(org));
      expect((await addNote(request("/api/v1/crm-notes", noteInput))).status).toBe(201);
      expect((await taskCommand(request("/api/v1/tasks/commands", taskInput))).status).toBe(201);
      for (const writer of [mocks.note, mocks.task]) {
        expect(writer.mock.calls[0]?.[0]).toEqual({
          organization_id: org,
          user_id: USER,
          role: "manager",
          source: "session",
        });
        expect(writer.mock.calls[0]?.[1]).toEqual({
          type: "human",
          user_id: USER,
        });
        expect(writer.mock.calls[0]?.[3]).toEqual({
          requestId: expect.any(String),
        });
      }
    },
  );

  it("falha fechada na guarda de suporte impede as duas escritas", async () => {
    mocks.support.mockResolvedValue(new Response(null, { status: 503 }));
    expect((await addNote(request("/api/v1/crm-notes", noteInput))).status).toBe(503);
    expect((await taskCommand(request("/api/v1/tasks/commands", taskInput))).status).toBe(503);
    expect(mocks.note).not.toHaveBeenCalled();
    expect(mocks.task).not.toHaveBeenCalled();
  });

  it("recusa autoria/tenant forjados antes da autorização", async () => {
    expect(
      (await addNote(request("/api/v1/crm-notes", { ...noteInput, actor_user_id: OTHER }))).status,
    ).toBe(422);
    expect(
      (
        await taskCommand(
          request("/api/v1/tasks/commands", {
            ...taskInput,
            organization_id: OTHER,
          }),
        )
      ).status,
    ).toBe(422);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.note).not.toHaveBeenCalled();
    expect(mocks.task).not.toHaveBeenCalled();
  });

  it.each(["read_only", "full"])("suporte %s não vira executor de nota/tarefa", async (mode) => {
    mocks.auth.mockResolvedValue(authenticated(ORG, { mode }));
    expect((await addNote(request("/api/v1/crm-notes", noteInput))).status).toBe(403);
    expect((await taskCommand(request("/api/v1/tasks/commands", taskInput))).status).toBe(403);
    expect(mocks.note).not.toHaveBeenCalled();
    expect(mocks.task).not.toHaveBeenCalled();
  });

  it("propaga a recusa do guard sem executar comandos", async () => {
    mocks.auth.mockImplementation(async () => ({
      ok: false,
      response: new Response("negado", { status: 403 }),
    }));
    expect((await addNote(request("/api/v1/crm-notes", noteInput))).status).toBe(403);
    expect((await taskCommand(request("/api/v1/tasks/commands", taskInput))).status).toBe(403);
    expect(mocks.auth).toHaveBeenCalledWith("agent", expect.any(Object));
    expect(mocks.note).not.toHaveBeenCalled();
    expect(mocks.task).not.toHaveBeenCalled();
  });

  it("replay retorna 200 e não informa criação nova", async () => {
    mocks.note.mockResolvedValue({ note: noteInput, replayed: true });
    mocks.task.mockResolvedValue({
      result: { task_id: NOTE, task_revision: 1, status: "pending" },
      replayed: true,
    });
    for (const response of [
      await addNote(request("/api/v1/crm-notes", noteInput)),
      await taskCommand(request("/api/v1/tasks/commands", taskInput)),
    ]) {
      expect(response.status).toBe(200);
      expect((await response.json()).meta.replayed).toBe(true);
    }
  });

  it("retorna conflitos/anonimização conhecidos e oculta diagnóstico interno", async () => {
    mocks.note.mockRejectedValueOnce(new CrmWorkServiceError("note_redacted", 410));
    expect((await addNote(request("/api/v1/crm-notes", noteInput))).status).toBe(410);
    mocks.task.mockRejectedValueOnce(new CrmWorkServiceError("revision_conflict", 409));
    expect((await taskCommand(request("/api/v1/tasks/commands", taskInput))).status).toBe(409);
    mocks.task.mockRejectedValueOnce(new Error("diagnóstico interno reservado"));
    const response = await taskCommand(request("/api/v1/tasks/commands", taskInput));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("diagnóstico interno reservado");
  });

  it.each([ORG, OTHER])(
    "consulta notas/tarefas com organização e vínculo explícitos em %s",
    async (org) => {
      mocks.auth.mockResolvedValue(authenticated(org));
      const db = database({
        contacts: { data: { id: CONTACT }, error: null },
        crm_orders: { data: { id: ORDER }, error: null },
      });
      expect(
        (await notes(request(`/api/v1/crm-notes?contact_id=${CONTACT}&order_id=${ORDER}`))).status,
      ).toBe(200);
      expect((await tasks(request(`/api/v1/crm-orders/${ORDER}/tasks`), params)).status).toBe(200);
      expect(
        (
          await taskEvents(
            request(`/api/v1/crm-task-events?contact_id=${CONTACT}&order_id=${ORDER}`),
          )
        ).status,
      ).toBe(200);
      for (const table of ["contacts", "crm_orders", "crm_notes", "crm_tasks", "crm_task_events"])
        expect(db.calls).toContainEqual({
          table,
          method: "eq",
          args: ["organization_id", org],
        });
      expect(db.calls).toContainEqual({
        table: "crm_notes",
        method: "eq",
        args: ["contact_id", CONTACT],
      });
      expect(db.calls).toContainEqual({
        table: "crm_notes",
        method: "eq",
        args: ["order_id", ORDER],
      });
      expect(db.calls).toContainEqual({
        table: "crm_tasks",
        method: "eq",
        args: ["order_id", ORDER],
      });
      for (const [key, value] of [
        ["contact_id", CONTACT],
        ["order_id", ORDER],
      ])
        expect(db.calls).toContainEqual({
          table: "crm_task_events",
          method: "eq",
          args: [key, value],
        });
      expect(mocks.auth).toHaveBeenCalledWith("viewer", expect.any(Object));
    },
  );

  it("vínculo inacessível retorna 404 antes de consultar conteúdo", async () => {
    const db = database({});
    expect((await notes(request(`/api/v1/crm-notes?contact_id=${CONTACT}`))).status).toBe(404);
    expect((await tasks(request(`/api/v1/crm-orders/${ORDER}/tasks`), params)).status).toBe(404);
    expect(
      (await taskEvents(request(`/api/v1/crm-task-events?contact_id=${CONTACT}`))).status,
    ).toBe(404);
    expect(db.from).not.toHaveBeenCalledWith("crm_task_events");
    expect(db.from).not.toHaveBeenCalledWith("crm_notes");
    expect(db.from).not.toHaveBeenCalledWith("crm_tasks");
  });

  it("falha de leitura não vira lista vazia", async () => {
    database({
      contacts: { data: { id: CONTACT }, error: null },
      crm_notes: { data: null, error: { message: "falha de teste" } },
    });
    expect((await notes(request(`/api/v1/crm-notes?contact_id=${CONTACT}`))).status).toBe(500);
  });

  it("cursor recusa filtros injetados antes de consultar o banco", async () => {
    const cursor = Buffer.from(
      JSON.stringify({
        created_at: "2026-09-09,organization_id.eq.outro",
        id: NOTE,
      }),
    ).toString("base64url");
    expect(
      (await notes(request(`/api/v1/crm-notes?contact_id=${CONTACT}&cursor=${cursor}`))).status,
    ).toBe(422);
    expect(mocks.db).not.toHaveBeenCalled();
    expect(decodeWorkCursor(Buffer.from("null").toString("base64url"))).toBeNull();
  });

  it("pagina a partir da última linha entregue, preservando o desempate pelo ID", () => {
    const rows = [3, 2, 1].map((n) => ({
      id: `50000000-0000-4000-8000-00000000000${n}`,
      created_at: "2026-09-09T12:00:00.123456+00:00",
    }));
    const page = workPage(rows, 2);
    expect(page.data).toEqual(rows.slice(0, 2));
    expect(page.meta.has_more).toBe(true);
    expect(decodeWorkCursor(page.meta.cursor!)).toEqual(rows[1]);
    expect(workPage(rows.slice(0, 1), 2).meta).toEqual({
      has_more: false,
      cursor: null,
    });
  });
});

describe("histórico canônico de tarefas", () => {
  it("pagina eventos por data/ID e só projeta campos públicos do journal", async () => {
    const rows = [3, 2, 1].map((n) => ({
      id: `50000000-0000-4000-8000-00000000000${n}`,
      created_at: "2026-09-09T12:00:00.123456+00:00",
      task_id: NOTE,
    }));
    const db = database({
      contacts: { data: { id: CONTACT }, error: null },
      crm_task_events: { data: rows, error: null },
    });
    const cursor = Buffer.from(
      JSON.stringify({ id: NOTE, created_at: "2026-09-10T12:00:00Z" }),
    ).toString("base64url");
    const response = await taskEvents(
      request(`/api/v1/crm-task-events?contact_id=${CONTACT}&limit=2&cursor=${cursor}`),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toEqual(rows.slice(0, 2));
    expect(payload.meta.has_more).toBe(true);
    expect(decodeWorkCursor(payload.meta.cursor)).toEqual({
      id: rows[1]!.id,
      created_at: rows[1]!.created_at,
    });
    expect(db.calls).toContainEqual({ table: "crm_task_events", method: "limit", args: [3] });
    expect(db.calls).toContainEqual({
      table: "crm_task_events",
      method: "or",
      args: [
        `created_at.lt.2026-09-10T12:00:00Z,and(created_at.eq.2026-09-10T12:00:00Z,id.lt.${NOTE})`,
      ],
    });
    expect(db.calls).toContainEqual({
      table: "crm_task_events",
      method: "select",
      args: [
        "id,task_id,order_id,contact_id,task_revision,event_type,from_status,to_status,actor_type,actor_id,created_at",
      ],
    });
    expect(db.from).not.toHaveBeenCalledWith("crm_task_command_receipts");
  });
  it("nega pedido incompatível com cliente e falha de leitura não vira vazio", async () => {
    const db = database({
      contacts: { data: { id: CONTACT }, error: null },
      crm_orders: { data: null, error: null },
    });
    expect(
      (await taskEvents(request(`/api/v1/crm-task-events?contact_id=${CONTACT}&order_id=${ORDER}`)))
        .status,
    ).toBe(404);
    expect(db.from).not.toHaveBeenCalledWith("crm_task_events");
    database({
      contacts: { data: { id: CONTACT }, error: null },
      crm_task_events: { data: null, error: { message: "private failure" } },
    });
    const response = await taskEvents(request(`/api/v1/crm-task-events?contact_id=${CONTACT}`));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private failure");
  });
  it("rejeita filtro inválido e acesso negado antes da leitura", async () => {
    expect(
      (await taskEvents(request(`/api/v1/crm-task-events?contact_id=${CONTACT}&cursor=broken`)))
        .status,
    ).toBe(422);
    expect(mocks.auth).not.toHaveBeenCalled();
    mocks.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect(
      (await taskEvents(request(`/api/v1/crm-task-events?contact_id=${CONTACT}`))).status,
    ).toBe(403);
    expect(mocks.db).not.toHaveBeenCalled();
  });
});
