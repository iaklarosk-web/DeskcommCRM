// Destino previsto: tests/integration/crm-work.test.ts, após promover 9008 e src/crm/work.
import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createCrmNote, executeLinkedTaskCommand } from "@/src/crm/work/service";
import { collectCrmWorkExport } from "@/src/crm/work/export";
import type { TenantCtx } from "@/src/tenant-context";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("TEST_DB_PORT inválido");
}
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
  max: 4,
});

const ORG_A = "f0300001-0000-4000-8000-000000000001";
const ORG_B = "f0300001-0000-4000-8000-000000000002";
const AGENT_A = "f0300001-1000-4000-8000-000000000001";
const AGENT_B = "f0300001-1000-4000-8000-000000000002";
const ASSIGNEE_A = "f0300001-1000-4000-8000-000000000003";
const VIEWER_A = "f0300001-1000-4000-8000-000000000004";
const REVOKED_A = "f0300001-1000-4000-8000-000000000005";
const CONTACT_A = "f0300001-2000-4000-8000-000000000001";
const CONTACT_B = "f0300001-2000-4000-8000-000000000002";
const CONTACT_REDACT_A = "f0300001-2000-4000-8000-000000000003";
const ORDER_A = "f0300001-3000-4000-8000-000000000001";
const ORDER_B = "f0300001-3000-4000-8000-000000000002";

const ctxA: TenantCtx = {
  organization_id: ORG_A,
  user_id: AGENT_A,
  role: "agent",
  source: "session",
};
const humanA = { type: "human" as const, user_id: AGENT_A };

function createTask(overrides: Record<string, unknown> = {}) {
  return {
    command: "create_linked_task",
    command_id: randomUUID(),
    order_id: ORDER_A,
    title: "Separar pedido fictício",
    description: "Descrição fictícia",
    priority: "medium",
    assigned_to: ASSIGNEE_A,
    ...overrides,
  };
}

async function task(raw: unknown, requestId?: string) {
  return executeLinkedTaskCommand(ctxA, humanA, raw, { pool, requestId });
}

async function note(raw: unknown, requestId?: string) {
  return createCrmNote(ctxA, humanA, raw, { pool, requestId });
}

async function asAuthenticated(
  userId: string,
  sql: string,
  values: unknown[] = [],
): Promise<pg.QueryResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const result = await client.query(sql, values);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  await pool.query(
    `insert into auth.users(id,email) values
      ($1,'t03-agent-a@integration.test'),($2,'t03-agent-b@integration.test'),
      ($3,'t03-assignee-a@integration.test'),($4,'t03-viewer-a@integration.test'),
      ($5,'t03-revoked-a@integration.test')`,
    [AGENT_A, AGENT_B, ASSIGNEE_A, VIEWER_A, REVOKED_A],
  );
  await pool.query(
    `insert into organizations(id,slug,legal_name,display_name) values
      ($1,'t03-int-a','T03 Integration A','T03 A'),
      ($2,'t03-int-b','T03 Integration B','T03 B')`,
    [ORG_A, ORG_B],
  );
  await pool.query(
    `insert into user_organizations(organization_id,user_id,role,accepted_at,revoked_at) values
      ($1,$2,'agent',now(),null),($3,$4,'agent',now(),null),
      ($1,$5,'agent',now(),null),($1,$6,'viewer',now(),null),
      ($1,$7,'agent',now(),now())`,
    [ORG_A, AGENT_A, ORG_B, AGENT_B, ASSIGNEE_A, VIEWER_A, REVOKED_A],
  );
  await pool.query(
    `insert into contacts(id,organization_id,display_name) values
      ($1,$2,'Contato A'),($3,$4,'Contato B'),($5,$2,'Contato redação A')`,
    [CONTACT_A, ORG_A, CONTACT_B, ORG_B, CONTACT_REDACT_A],
  );
  await pool.query(
    `insert into crm_orders
      (id,organization_id,contact_id,source,created_by_actor_type,created_by_actor_id)
     values ($1,$2,$3,'ui','user',$4),($5,$6,$7,'ui','user',$8)`,
    [ORDER_A, ORG_A, CONTACT_A, AGENT_A, ORDER_B, ORG_B, CONTACT_B, AGENT_B],
  );
});

beforeEach(async () => {
  await pool.query("delete from crm_task_events where organization_id in ($1,$2)", [ORG_A, ORG_B]);
  await pool.query("delete from crm_task_command_receipts where organization_id in ($1,$2)", [
    ORG_A,
    ORG_B,
  ]);
  await pool.query("delete from crm_notes where organization_id in ($1,$2)", [ORG_A, ORG_B]);
  await pool.query("delete from crm_tasks where organization_id in ($1,$2)", [ORG_A, ORG_B]);
  await pool.query(
    "delete from api_audit_log where organization_id in ($1,$2) and (action like 'crm_task.%' or action='crm_note.created')",
    [ORG_A, ORG_B],
  );
  await pool.query("update organizations set status='active' where id in ($1,$2)", [ORG_A, ORG_B]);
  await pool.query(
    `update user_organizations set
       role=case when user_id=$2 then 'viewer' else 'agent' end,
       revoked_at=case when user_id=$3 then now() else null end
     where organization_id=$1`,
    [ORG_A, VIEWER_A, REVOKED_A],
  );
});

afterAll(async () => pool.end());

describe("tarefas vinculadas e notas operacionais", () => {
  it("exporta uma fotografia isolada de notas, tarefas vinculadas e journal sem recibo", async () => {
    const taskA = await task(
      createTask({ title: "Retorno do titular A", description: "Detalhe pessoal A" }),
    );
    const noteA = {
      id: randomUUID(),
      contact_id: CONTACT_A,
      order_id: ORDER_A,
      body: "Nota pessoal A",
    };
    await note(noteA);
    await pool.query(
      "insert into crm_tasks(id,organization_id,title,contact_id) values($1,$2,'Legada A',$3)",
      [randomUUID(), ORG_A, CONTACT_A],
    );

    const ctxB: TenantCtx = {
      organization_id: ORG_B,
      user_id: AGENT_B,
      role: "agent",
      source: "session",
    };
    await executeLinkedTaskCommand(
      ctxB,
      { type: "human", user_id: AGENT_B },
      {
        command: "create_linked_task",
        command_id: randomUUID(),
        order_id: ORDER_B,
        title: "Segredo da tarefa B",
        description: "Descrição B",
        priority: "medium",
      },
      { pool },
    );
    await createCrmNote(
      ctxB,
      { type: "human", user_id: AGENT_B },
      { id: randomUUID(), contact_id: CONTACT_B, order_id: ORDER_B, body: "Segredo da nota B" },
      { pool },
    );

    const exported = await collectCrmWorkExport(ctxA, CONTACT_A, { pool });
    expect(exported.notes).toHaveLength(1);
    expect(exported.notes[0]).toMatchObject({
      id: noteA.id,
      contact_id: CONTACT_A,
      order_id: ORDER_A,
      body: noteA.body,
      actor_user_id: AGENT_A,
    });
    expect(exported.linked_tasks).toHaveLength(1);
    expect(exported.linked_tasks[0]).toMatchObject({
      id: taskA.result.task_id,
      contact_id: CONTACT_A,
      order_id: ORDER_A,
      title: "Retorno do titular A",
      description: "Detalhe pessoal A",
    });
    expect(exported.task_events).toHaveLength(1);
    expect(exported.task_events[0]).toMatchObject({
      task_id: taskA.result.task_id,
      contact_id: CONTACT_A,
      order_id: ORDER_A,
      event_type: "created",
      actor_id: AGENT_A,
    });
    expect(Object.keys(exported.task_events[0]!).sort()).toEqual(
      [
        "actor_id",
        "actor_type",
        "contact_id",
        "created_at",
        "event_type",
        "from_status",
        "id",
        "order_id",
        "task_id",
        "task_revision",
        "to_status",
      ].sort(),
    );
    expect(Object.keys(exported).sort()).toEqual(["linked_tasks", "notes", "task_events"].sort());
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain("Segredo da tarefa B");
    expect(serialized).not.toContain("Segredo da nota B");
    expect(serialized).not.toContain("request_hash");
    expect(serialized).not.toContain("idempotency_key");
  });

  it("reverte toda redação T03 se a anonimização falhar e exporta só o estado redigido", async () => {
    const contactId = randomUUID();
    const orderId = randomUUID();
    const taskId = randomUUID();
    const receiptId = randomUUID();
    const noteId = randomUUID();
    await pool.query(
      "insert into contacts(id,organization_id,display_name) values($1,$2,'Titular transitório')",
      [contactId, ORG_A],
    );
    await pool.query(
      `insert into crm_orders
        (id,organization_id,contact_id,source,created_by_actor_type,created_by_actor_id)
       values($1,$2,$3,'ui','user',$4)`,
      [orderId, ORG_A, contactId, AGENT_A],
    );
    await pool.query(
      `insert into crm_tasks
        (id,organization_id,title,description,contact_id,order_id,created_by,revision)
       values($1,$2,'Nome no título','Nome na descrição',$3,$4,$5,1)`,
      [taskId, ORG_A, contactId, orderId, AGENT_A],
    );
    await pool.query(
      `insert into crm_task_command_receipts
        (id,organization_id,command_type,request_hash,actor_type,actor_id,
         result_task_id,result_task_revision,result_status)
       values($1,$2,'create_linked_task',decode(repeat('ab',32),'hex'),'user',$3,$4,1,'pending')`,
      [receiptId, ORG_A, AGENT_A, taskId],
    );
    await pool.query(
      `insert into crm_task_events
        (id,organization_id,task_id,order_id,contact_id,task_revision,event_type,
         from_status,to_status,actor_type,actor_id)
       values($1,$2,$3,$4,$5,1,'created',null,'pending','user',$6)`,
      [receiptId, ORG_A, taskId, orderId, contactId, AGENT_A],
    );
    await pool.query(
      `insert into crm_notes(id,organization_id,contact_id,order_id,body,actor_user_id)
       values($1,$2,$3,$4,'Nome na nota',$5)`,
      [noteId, ORG_A, contactId, orderId, AGENT_A],
    );

    await pool.query(`
      create function public.test_t03_fail_after_redaction()
      returns trigger language plpgsql as $$
      begin
        raise exception 't03 redaction rollback probe';
      end $$;
      create trigger zz_test_t03_fail_after_redaction
      after update of is_anonymized on public.contacts
      for each row when (new.is_anonymized is true)
      execute function public.test_t03_fail_after_redaction();
    `);
    try {
      await expect(
        pool.query(
          "update contacts set is_anonymized=true,anonymized_at=now() where organization_id=$1 and id=$2",
          [ORG_A, contactId],
        ),
      ).rejects.toThrow("t03 redaction rollback probe");
      const unchanged = await pool.query(
        `select c.is_anonymized,t.title,t.description,n.body,n.redacted_at
           from contacts c
           join crm_tasks t on t.organization_id=c.organization_id and t.contact_id=c.id
           join crm_notes n on n.organization_id=c.organization_id and n.contact_id=c.id
          where c.organization_id=$1 and c.id=$2`,
        [ORG_A, contactId],
      );
      expect(unchanged.rows).toEqual([
        {
          is_anonymized: false,
          title: "Nome no título",
          description: "Nome na descrição",
          body: "Nome na nota",
          redacted_at: null,
        },
      ]);
    } finally {
      await pool.query(
        "drop trigger if exists zz_test_t03_fail_after_redaction on public.contacts",
      );
      await pool.query("drop function if exists public.test_t03_fail_after_redaction()");
    }

    await pool.query(
      "update contacts set is_anonymized=true,anonymized_at=now() where organization_id=$1 and id=$2",
      [ORG_A, contactId],
    );
    const exported = await collectCrmWorkExport(
      { organization_id: ORG_A, source: "job" },
      contactId,
      { pool },
    );
    expect(exported.notes).toEqual([
      expect.objectContaining({ id: noteId, body: "[Nota anonimizada]" }),
    ]);
    expect(exported.linked_tasks).toEqual([
      expect.objectContaining({ id: taskId, title: "Tarefa anonimizada", description: null }),
    ]);
    expect(exported.task_events).toEqual([
      expect.objectContaining({ id: receiptId, task_id: taskId, event_type: "created" }),
    ]);
  });
  it("grava tarefa, receipt, evento sem PII e audit no mesmo TenantDb", async () => {
    const command = createTask();
    const created = await task(command, "request-task-create");
    expect(created).toMatchObject({
      replayed: false,
      result: { task_revision: 1, status: "pending" },
    });
    const stored = await pool.query(
      `select t.order_id,t.contact_id,t.lead_id,t.assigned_to,t.revision,
              r.command_type,r.result_task_id,to_jsonb(e) event,
              a.action,a.request_id,a.metadata
         from crm_tasks t
         join crm_task_command_receipts r on r.result_task_id=t.id
         join crm_task_events e on e.task_id=t.id and e.id=r.id
         join api_audit_log a on a.resource_id=t.id and a.action='crm_task.created'
        where t.id=$1`,
      [created.result.task_id],
    );
    expect(
      stored.rowCount,
      "journal atômico da tarefa ausente: task+receipt+event+audit devem coexistir",
    ).toBe(1);
    expect(stored.rows[0]).toMatchObject({
      order_id: ORDER_A,
      contact_id: CONTACT_A,
      lead_id: null,
      assigned_to: ASSIGNEE_A,
      revision: 1,
      command_type: "create_linked_task",
      result_task_id: created.result.task_id,
      action: "crm_task.created",
      request_id: "request-task-create",
    });
    expect(stored.rows[0].event).toMatchObject({
      event_type: "created",
      from_status: null,
      to_status: "pending",
    });
    const serialized = JSON.stringify(stored.rows[0]);
    expect(serialized).not.toContain(command.title);
    expect(serialized).not.toContain(command.description);
  });

  it("serializa replay concorrente e rejeita o mesmo command_id com payload diferente", async () => {
    const command = createTask();
    const [one, two] = await Promise.all([task(command), task(command)]);
    expect([one.replayed, two.replayed].sort()).toEqual([false, true]);
    await expect(task({ ...command, title: "Outro conteúdo" })).rejects.toMatchObject({
      code: "idempotency_conflict",
      status: 409,
    });
    const counts = await pool.query(
      `select
        (select count(*)::int from crm_tasks where organization_id=$1) tasks,
        (select count(*)::int from crm_task_command_receipts where organization_id=$1) receipts,
        (select count(*)::int from crm_task_events where organization_id=$1) events,
        (select count(*)::int from api_audit_log where organization_id=$1 and action='crm_task.created') audits`,
      [ORG_A],
    );
    expect(counts.rows[0]).toEqual({
      tasks: 1,
      receipts: 1,
      events: 1,
      audits: 1,
    });
  });

  it("transforma colisão global concorrente de command_id em 409 sem efeito cruzado", async () => {
    const commandId = randomUUID();
    const commandA = createTask({ command_id: commandId });
    const ctxB: TenantCtx = {
      organization_id: ORG_B,
      user_id: AGENT_B,
      role: "agent",
      source: "session",
    };
    const commandB = {
      command: "create_linked_task",
      command_id: commandId,
      order_id: ORDER_B,
      title: "Tarefa do tenant B",
    };
    const attempts = await Promise.allSettled([
      task(commandA),
      executeLinkedTaskCommand(ctxB, { type: "human", user_id: AGENT_B }, commandB, { pool }),
    ]);
    expect(attempts.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(attempts.find((entry) => entry.status === "rejected")).toMatchObject({
      reason: { code: "idempotency_conflict", status: 409 },
    });
    const counts = await pool.query(
      `select organization_id,count(*)::int effects
         from crm_tasks where organization_id in ($1,$2)
        group by organization_id`,
      [ORG_A, ORG_B],
    );
    expect(counts.rows).toHaveLength(1);
    expect(counts.rows[0].effects).toBe(1);
  });

  it("retorna o resultado original no replay e deixa só um commit por revisão", async () => {
    const create = createTask();
    const first = await task(create);
    const edits = await Promise.allSettled([
      task({
        command: "edit_linked_task",
        command_id: randomUUID(),
        task_id: first.result.task_id,
        expected_revision: 1,
        title: "Edição A",
      }),
      task({
        command: "edit_linked_task",
        command_id: randomUUID(),
        task_id: first.result.task_id,
        expected_revision: 1,
        title: "Edição B",
      }),
    ]);
    expect(edits.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(edits.find((entry) => entry.status === "rejected")).toMatchObject({
      reason: { code: "revision_conflict", status: 409 },
    });
    await expect(task(create)).resolves.toEqual({
      result: first.result,
      replayed: true,
    });
  });

  it("registra mudança de estado sem alterar a revisão comercial do pedido", async () => {
    const created = await task(createTask());
    const changed = await task({
      command: "set_linked_task_status",
      command_id: randomUUID(),
      task_id: created.result.task_id,
      expected_revision: 1,
      status: "cancelled",
    });
    expect(changed.result).toMatchObject({
      task_revision: 2,
      status: "cancelled",
    });
    const state = await pool.query(
      `select t.status,t.revision,o.revision order_revision,e.from_status,e.to_status,a.action
         from crm_tasks t join crm_orders o on o.id=t.order_id
         join crm_task_events e on e.task_id=t.id and e.task_revision=2
         join api_audit_log a on a.resource_id=t.id and a.action='crm_task.status_changed'
        where t.id=$1`,
      [created.result.task_id],
    );
    expect(state.rows[0]).toEqual({
      status: "cancelled",
      revision: 2,
      order_revision: 1,
      from_status: "pending",
      to_status: "cancelled",
      action: "crm_task.status_changed",
    });
  });

  it("rejeita journal edited sem estado anterior e status_changed sem mudança", async () => {
    const created = await task(createTask());
    async function rejectInvalidEvent(
      eventType: "edited" | "status_changed",
      fromStatus: "pending" | null,
    ) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const commandId = randomUUID();
        await client.query("update crm_tasks set revision=2 where organization_id=$1 and id=$2", [
          ORG_A,
          created.result.task_id,
        ]);
        await client.query(
          `insert into crm_task_command_receipts
            (id,organization_id,command_type,request_hash,actor_type,actor_id,
             result_task_id,result_task_revision,result_status)
           values ($1,$2,'edit_linked_task',decode(repeat('00',32),'hex'),'user',$3,$4,2,'pending')`,
          [commandId, ORG_A, AGENT_A, created.result.task_id],
        );
        await expect(
          client.query(
            `insert into crm_task_events
              (id,organization_id,task_id,order_id,contact_id,task_revision,event_type,
               from_status,to_status,actor_type,actor_id)
             values ($1,$2,$3,$4,$5,2,$6,$7,'pending','user',$8)`,
            [
              commandId,
              ORG_A,
              created.result.task_id,
              ORDER_A,
              CONTACT_A,
              eventType,
              fromStatus,
              AGENT_A,
            ],
          ),
        ).rejects.toThrow(/crm_task_events_created_shape/);
      } finally {
        await client.query("rollback");
        client.release();
      }
    }

    await rejectInvalidEvent("edited", null);
    await rejectInvalidEvent("status_changed", "pending");
  });

  it("nega order/task/assigned_to cruzados e identidade sem permissão antes do replay", async () => {
    await expect(task(createTask({ order_id: ORDER_B }))).rejects.toMatchObject({ status: 404 });
    await expect(task(createTask({ assigned_to: VIEWER_A }))).rejects.toMatchObject({
      code: "assignee_unavailable",
      status: 422,
    });
    await expect(task(createTask({ assigned_to: AGENT_B }))).rejects.toMatchObject({
      code: "assignee_unavailable",
      status: 422,
    });

    const command = createTask();
    const created = await task(command);
    const viewerCtx = { ...ctxA, user_id: VIEWER_A, role: "viewer" };
    const revokedCtx = { ...ctxA, user_id: REVOKED_A };
    await expect(
      executeLinkedTaskCommand(viewerCtx, { type: "human", user_id: VIEWER_A }, command, { pool }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      executeLinkedTaskCommand(revokedCtx, { type: "human", user_id: REVOKED_A }, command, {
        pool,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await pool.query("update organizations set status='suspended' where id=$1", [ORG_A]);
    await expect(task(command)).rejects.toMatchObject({ status: 403 });
    const counts = await pool.query(
      "select count(*)::int tasks from crm_tasks where organization_id=$1",
      [ORG_A],
    );
    expect(counts.rows[0].tasks).toBe(1);
    expect(created.replayed).toBe(false);
  });

  it("cria nota idempotente com audit sem corpo e rejeita payload divergente", async () => {
    const input = {
      id: randomUUID(),
      contact_id: CONTACT_A,
      order_id: ORDER_A,
      body: "Observação interna fictícia",
    };
    const first = await note(input, "request-note-create");
    const replay = await note(input, "request-note-replay");
    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ note: first.note, replayed: true });
    await expect(note({ ...input, body: "Texto divergente" })).rejects.toMatchObject({
      code: "idempotency_conflict",
      status: 409,
    });
    const audit = await pool.query(
      `select request_id,metadata from api_audit_log
        where organization_id=$1 and action='crm_note.created' and resource_id=$2`,
      [ORG_A, input.id],
    );
    expect(audit.rows).toEqual([
      {
        request_id: "request-note-create",
        metadata: { contact_id: CONTACT_A, order_id: ORDER_A },
      },
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain(input.body);
  });

  it("faz uma única nota no replay concorrente", async () => {
    const input = {
      id: randomUUID(),
      contact_id: CONTACT_A,
      body: "Nota concorrente",
    };
    const [one, two] = await Promise.all([note(input), note(input)]);
    expect([one.replayed, two.replayed].sort()).toEqual([false, true]);
    const counts = await pool.query(
      `select
        (select count(*)::int from crm_notes where organization_id=$1) notes,
        (select count(*)::int from api_audit_log where organization_id=$1 and action='crm_note.created') audits`,
      [ORG_A],
    );
    expect(counts.rows[0]).toEqual({ notes: 1, audits: 1 });
  });

  it("colisão global de note.id entre tenants vira 409 sem carregar conteúdo alheio", async () => {
    const id = randomUUID();
    await createCrmNote(
      {
        organization_id: ORG_B,
        user_id: AGENT_B,
        role: "agent",
        source: "session",
      },
      { type: "human", user_id: AGENT_B },
      {
        id,
        contact_id: CONTACT_B,
        order_id: ORDER_B,
        body: "Segredo do tenant B",
      },
      { pool },
    );
    await expect(
      note({
        id,
        contact_id: CONTACT_A,
        order_id: ORDER_A,
        body: "Nota do tenant A",
      }),
    ).rejects.toMatchObject({ code: "idempotency_conflict", status: 409 });
    const own = await pool.query("select body from crm_notes where organization_id=$1 and id=$2", [
      ORG_B,
      id,
    ]);
    expect(own.rows).toEqual([{ body: "Segredo do tenant B" }]);
  });

  it("redige nota, corrige resíduo true→true, preserva B e devolve 410 no replay", async () => {
    const inputA = {
      id: randomUUID(),
      contact_id: CONTACT_REDACT_A,
      body: "Dado pessoal A",
    };
    const inputB = {
      id: randomUUID(),
      contact_id: CONTACT_B,
      body: "Dado pessoal B",
    };
    await note(inputA);
    await createCrmNote(
      {
        organization_id: ORG_B,
        user_id: AGENT_B,
        role: "agent",
        source: "session",
      },
      { type: "human", user_id: AGENT_B },
      inputB,
      { pool },
    );
    await pool.query("select public.fn_lgpd_cascade_redact_contact($1,$2,$3)", [
      ORG_A,
      CONTACT_REDACT_A,
      randomUUID(),
    ]);
    await expect(note(inputA)).rejects.toMatchObject({
      code: "note_redacted",
      status: 410,
    });
    await pool.query("update crm_notes set body='resíduo deliberado' where id=$1", [inputA.id]);
    await pool.query("update contacts set is_anonymized=true where id=$1", [CONTACT_REDACT_A]);
    const stored = await pool.query(
      "select organization_id,body,redacted_at is not null redacted from crm_notes where id=any($1::uuid[]) order by organization_id",
      [[inputA.id, inputB.id]],
    );
    expect(stored.rows).toEqual([
      { organization_id: ORG_A, body: "[Nota anonimizada]", redacted: true },
      { organization_id: ORG_B, body: "Dado pessoal B", redacted: false },
    ]);
  });

  it("falha do audit reverte tarefa, receipt, evento e nota", async () => {
    await pool.query(`
      create function public.test_t03_reject_audit() returns trigger language plpgsql as $$
      begin
        if new.action in ('crm_task.created','crm_note.created') then
          raise exception 't03 audit failure probe';
        end if;
        return new;
      end $$;
      create trigger test_t03_reject_audit before insert on public.api_audit_log
      for each row execute function public.test_t03_reject_audit();
    `);
    try {
      await expect(task(createTask())).rejects.toThrow("t03 audit failure probe");
      await expect(
        note({
          id: randomUUID(),
          contact_id: CONTACT_A,
          body: "Nota deve reverter",
        }),
      ).rejects.toThrow("t03 audit failure probe");
    } finally {
      await pool.query("drop trigger test_t03_reject_audit on public.api_audit_log");
      await pool.query("drop function public.test_t03_reject_audit()");
    }
    const counts = await pool.query(
      `select
        (select count(*)::int from crm_tasks where organization_id=$1) tasks,
        (select count(*)::int from crm_task_command_receipts where organization_id=$1) receipts,
        (select count(*)::int from crm_task_events where organization_id=$1) events,
        (select count(*)::int from crm_notes where organization_id=$1) notes`,
      [ORG_A],
    );
    expect(counts.rows[0]).toEqual({
      tasks: 0,
      receipts: 0,
      events: 0,
      notes: 0,
    });
  });

  it("mantém tarefa legada gravável e torna linked task read-only para authenticated", async () => {
    const linked = await task(createTask());
    const legacyId = randomUUID();
    await expect(
      asAuthenticated(
        AGENT_A,
        "insert into crm_tasks(id,organization_id,title) values($1,$2,'Legada')",
        [legacyId, ORG_A],
      ),
    ).resolves.toBeDefined();
    const blockedUpdate = await asAuthenticated(
      AGENT_A,
      "update crm_tasks set title='forjado' where id=$1",
      [linked.result.task_id],
    );
    expect(blockedUpdate.rowCount).toBe(0);
    const blockedDelete = await asAuthenticated(AGENT_A, "delete from crm_tasks where id=$1", [
      linked.result.task_id,
    ]);
    expect(blockedDelete.rowCount).toBe(0);
    await expect(
      asAuthenticated(
        AGENT_A,
        "insert into crm_notes(id,organization_id,contact_id,body,actor_user_id) values($1,$2,$3,'forjada',$4)",
        [randomUUID(), ORG_A, CONTACT_A, AGENT_A],
      ),
    ).rejects.toThrow();
    await expect(
      asAuthenticated(AGENT_A, "delete from crm_tasks where id=$1", [legacyId]),
    ).resolves.toBeDefined();
  });
});
