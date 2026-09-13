import { createHash, randomUUID } from "node:crypto";

import type { ServicePool } from "@/src/tenant-context/db";
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";
import {
  authorizeCrmCommand,
  type CrmCommandPermission,
  type TrustedCrmExecutor,
} from "@/src/crm/authorization";
import { notify } from "@/src/notifications";
import { can, papelD15DoHerdado } from "@/src/rbac/matrix";

import {
  createCrmNoteSchema,
  linkedTaskCommandSchema,
  type CreateCrmNote,
  type LinkedTaskCommand,
  type LinkedTaskCommandResult,
} from "./contracts";

export class CrmWorkServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "CrmWorkServiceError";
  }
}

type TaskStatus = "pending" | "in_progress" | "done" | "cancelled";
type TaskRow = {
  id: string;
  order_id: string;
  contact_id: string;
  title: string;
  description: string | null;
  due_date: Date | string | null;
  priority: "low" | "medium" | "high" | "urgent";
  status: TaskStatus;
  assigned_to: string | null;
  revision: number;
};
type NoteRow = {
  id: string;
  organization_id: string;
  contact_id: string;
  order_id: string | null;
  body: string;
  actor_user_id: string;
  created_at: Date | string;
  redacted_at: Date | string | null;
};

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sorted(item)]),
    );
  }
  return value;
}

function commandHash(command: LinkedTaskCommand, actorId: string): Buffer {
  const { command_id: _id, ...body } = command;
  return createHash("sha256")
    .update(JSON.stringify(sorted({ actor: actorId, body })))
    .digest();
}

async function authorizeHumanWrite(
  db: TenantDb,
  ctx: TenantCtx,
  executor: TrustedCrmExecutor,
  permission: Extract<CrmCommandPermission, "tasks.create" | "notes.create">,
): Promise<string> {
  await authorizeCrmCommand(db, ctx, executor, permission);
  if (executor.type !== "human") throw new CrmWorkServiceError("executor_denied", 403);
  const support = await db.query<{ allowed: boolean }>(
    "select public.fn_support_write_allowed($1) allowed",
    [ctx.organization_id],
  );
  if (!support.rows[0]?.allowed) throw new CrmWorkServiceError("support_readonly", 403);
  return executor.user_id;
}

async function lockContact(db: TenantDb, org: string, contactId: string): Promise<boolean> {
  await db.query("select public.fn_service_lock($1::uuid,$2::uuid)", [org, contactId]);
  const contact = await db.query<{ available: boolean }>(
    `select (not is_anonymized and is_merged_into is null) available
       from public.contacts
      where organization_id=$1 and id=$2
      for share`,
    [org, contactId],
  );
  return contact.rows[0]?.available ?? false;
}

async function commandMutex(db: TenantDb, org: string, commandId: string): Promise<void> {
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    `crm-task:${org}:${commandId}`,
  ]);
}

async function validateAssignee(
  db: TenantDb,
  org: string,
  assignee: string | null | undefined,
): Promise<void> {
  if (!assignee) return;
  const selected = await db.query<{ role: string }>(
    `select role from public.user_organizations
      where organization_id=$1 and user_id=$2
        and accepted_at is not null and revoked_at is null
      for share`,
    [org, assignee],
  );
  if (!can(papelD15DoHerdado(selected.rows[0]?.role, false), "tasks.create")) {
    throw new CrmWorkServiceError("assignee_unavailable", 422);
  }
}

function resultOf(task: Pick<TaskRow, "id" | "revision" | "status">): LinkedTaskCommandResult {
  return {
    task_id: task.id,
    task_revision: task.revision,
    status: task.status,
  };
}

async function replayTaskCommand(
  db: TenantDb,
  org: string,
  command: LinkedTaskCommand,
  hash: Buffer,
  actorId: string,
): Promise<LinkedTaskCommandResult | null> {
  const prior = await db.query<{
    command_type: string;
    request_hash: Buffer;
    actor_type: string;
    actor_id: string | null;
    result_task_id: string;
    result_task_revision: number;
    result_status: TaskStatus;
  }>(
    `select command_type,request_hash,actor_type,actor_id,
            result_task_id,result_task_revision,result_status
       from public.crm_task_command_receipts
      where organization_id=$1 and id=$2`,
    [org, command.command_id],
  );
  const receipt = prior.rows[0];
  if (!receipt) {
    const collision = await db.query("select 1 from public.crm_task_command_receipts where id=$1", [
      command.command_id,
    ]);
    if (collision.rowCount) throw new CrmWorkServiceError("idempotency_conflict", 409);
    return null;
  }
  if (
    receipt.command_type !== command.command ||
    receipt.actor_type !== "user" ||
    receipt.actor_id !== actorId ||
    !receipt.request_hash.equals(hash)
  ) {
    throw new CrmWorkServiceError("idempotency_conflict", 409);
  }
  return {
    task_id: receipt.result_task_id,
    task_revision: receipt.result_task_revision,
    status: receipt.result_status,
  };
}

async function linkedTaskContact(
  db: TenantDb,
  org: string,
  command: LinkedTaskCommand,
): Promise<{ contactId: string; orderId: string }> {
  if (command.command === "create_linked_task") {
    const order = await db.query<{ contact_id: string }>(
      "select contact_id from public.crm_orders where organization_id=$1 and id=$2",
      [org, command.order_id],
    );
    if (!order.rows[0]) throw new CrmWorkServiceError("order_not_found", 404);
    return { contactId: order.rows[0].contact_id, orderId: command.order_id };
  }
  const task = await db.query<{ contact_id: string; order_id: string }>(
    `select contact_id,order_id from public.crm_tasks
      where organization_id=$1 and id=$2 and order_id is not null`,
    [org, command.task_id],
  );
  if (!task.rows[0]) throw new CrmWorkServiceError("linked_task_not_found", 404);
  return { contactId: task.rows[0].contact_id, orderId: task.rows[0].order_id };
}

async function writeTaskReceiptAndEvent(
  db: TenantDb,
  org: string,
  command: LinkedTaskCommand,
  hash: Buffer,
  actorId: string,
  task: TaskRow,
  eventType: "created" | "edited" | "status_changed",
  fromStatus: TaskStatus | null,
): Promise<void> {
  const receipt = await db.query<{ id: string }>(
    `insert into public.crm_task_command_receipts
      (id,organization_id,command_type,request_hash,actor_type,actor_id,
       result_task_id,result_task_revision,result_status)
     values ($1,$2,$3,$4,'user',$5,$6,$7,$8)
     on conflict (id) do nothing
     returning id`,
    [command.command_id, org, command.command, hash, actorId, task.id, task.revision, task.status],
  );
  if (receipt.rowCount !== 1) {
    throw new CrmWorkServiceError("idempotency_conflict", 409);
  }
  await db.query(
    `insert into public.crm_task_events
      (id,organization_id,task_id,order_id,contact_id,task_revision,event_type,
       from_status,to_status,actor_type,actor_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'user',$10)`,
    [
      command.command_id,
      org,
      task.id,
      task.order_id,
      task.contact_id,
      task.revision,
      eventType,
      fromStatus,
      task.status,
      actorId,
    ],
  );
}

async function writeAudit(
  db: TenantDb,
  input: {
    organizationId: string;
    actorId: string;
    action:
      "crm_task.created" | "crm_task.updated" | "crm_task.status_changed" | "crm_note.created";
    resourceType: "crm_tasks" | "crm_notes";
    resourceId: string;
    requestId?: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await db.query(
    `insert into public.api_audit_log
      (organization_id,actor_user_id,action,resource_type,resource_id,request_id,bypassed_rls,metadata)
     values ($1,$2,$3,$4,$5,$6,true,$7::jsonb)`,
    [
      input.organizationId,
      input.actorId,
      input.action,
      input.resourceType,
      input.resourceId,
      input.requestId ?? null,
      JSON.stringify(input.metadata),
    ],
  );
}

export async function executeLinkedTaskCommand(
  ctx: TenantCtx,
  executor: TrustedCrmExecutor,
  raw: unknown,
  options: { pool?: ServicePool; requestId?: string } = {},
): Promise<{ result: LinkedTaskCommandResult; replayed: boolean }> {
  const command = linkedTaskCommandSchema.parse(raw);
  return withTenant(
    ctx,
    async (db) => {
      const actorId = await authorizeHumanWrite(db, ctx, executor, "tasks.create");
      const org = ctx.organization_id;
      const link = await linkedTaskContact(db, org, command);
      const contactAvailable = await lockContact(db, org, link.contactId);
      await commandMutex(db, org, command.command_id);
      const hash = commandHash(command, actorId);
      const replay = await replayTaskCommand(db, org, command, hash, actorId);
      if (replay) return { result: replay, replayed: true };
      if (!contactAvailable) throw new CrmWorkServiceError("contact_unavailable", 422);

      const order = await db.query<{ contact_id: string }>(
        `select contact_id from public.crm_orders
          where organization_id=$1 and id=$2 for share`,
        [org, link.orderId],
      );
      if (order.rows[0]?.contact_id !== link.contactId) {
        throw new CrmWorkServiceError("order_unavailable", 422);
      }

      let beforeStatus: TaskStatus | null = null;
      let assigneeAntes: string | null = null;
      let eventType: "created" | "edited" | "status_changed";
      let task: TaskRow;
      if (command.command === "create_linked_task") {
        await validateAssignee(db, org, command.assigned_to);
        const inserted = await db.query<TaskRow>(
          `insert into public.crm_tasks
            (id,organization_id,title,description,due_date,priority,status,lead_id,
             contact_id,order_id,assigned_to,created_by,revision)
           values ($1,$2,$3,$4,$5,$6,'pending',null,$7,$8,$9,$10,1)
           returning id,order_id,contact_id,title,description,due_date,priority,status,assigned_to,revision`,
          [
            randomUUID(),
            org,
            command.title,
            command.description ?? null,
            command.due_date ?? null,
            command.priority,
            link.contactId,
            link.orderId,
            command.assigned_to ?? null,
            actorId,
          ],
        );
        task = inserted.rows[0]!;
        eventType = "created";
      } else {
        const locked = await db.query<TaskRow>(
          `select id,order_id,contact_id,title,description,due_date,priority,status,assigned_to,revision
             from public.crm_tasks
            where organization_id=$1 and id=$2 and order_id is not null
            for update`,
          [org, command.task_id],
        );
        const current = locked.rows[0];
        if (!current) throw new CrmWorkServiceError("linked_task_not_found", 404);
        if (current.contact_id !== link.contactId || current.order_id !== link.orderId) {
          throw new CrmWorkServiceError("revision_conflict", 409);
        }
        if (current.revision !== command.expected_revision) {
          throw new CrmWorkServiceError("revision_conflict", 409);
        }
        beforeStatus = current.status;
        assigneeAntes = current.assigned_to;
        if (command.command === "edit_linked_task") {
          await validateAssignee(db, org, command.assigned_to);
          const updated = await db.query<TaskRow>(
            `update public.crm_tasks set
               title=case when $3 then $4 else title end,
               description=case when $5 then $6 else description end,
               due_date=case when $7 then $8::timestamptz else due_date end,
               priority=case when $9 then $10 else priority end,
               assigned_to=case when $11 then $12::uuid else assigned_to end,
               revision=revision+1
             where organization_id=$1 and id=$2
             returning id,order_id,contact_id,title,description,due_date,priority,status,assigned_to,revision`,
            [
              org,
              current.id,
              command.title !== undefined,
              command.title ?? null,
              command.description !== undefined,
              command.description ?? null,
              command.due_date !== undefined,
              command.due_date ?? null,
              command.priority !== undefined,
              command.priority ?? null,
              command.assigned_to !== undefined,
              command.assigned_to ?? null,
            ],
          );
          task = updated.rows[0]!;
          eventType = "edited";
        } else {
          if (command.status === current.status) {
            throw new CrmWorkServiceError("task_status_unchanged", 422);
          }
          const updated = await db.query<TaskRow>(
            `update public.crm_tasks set status=$3,revision=revision+1
              where organization_id=$1 and id=$2
              returning id,order_id,contact_id,title,description,due_date,priority,status,assigned_to,revision`,
            [org, current.id, command.status],
          );
          task = updated.rows[0]!;
          eventType = "status_changed";
        }
      }

      await writeTaskReceiptAndEvent(
        db,
        org,
        command,
        hash,
        actorId,
        task,
        eventType,
        beforeStatus,
      );
      // `notify(task.assigned)` (§5.16, F05-T05): quando a tarefa GANHA dono —
      // criada já atribuída, ou reatribuída para outra pessoa. Mesma transação
      // da tarefa; só ids no payload. Quem se atribui a si mesmo não é avisado
      // do que acabou de fazer.
      if (
        task.assigned_to !== null &&
        task.assigned_to !== assigneeAntes &&
        task.assigned_to !== actorId
      ) {
        await notify(db, ctx, "task.assigned", [task.assigned_to], {
          task_id: task.id,
          order_id: task.order_id,
          contact_id: task.contact_id,
          assigned_by: actorId,
          priority: task.priority,
        });
      }
      const auditAction =
        eventType === "created"
          ? "crm_task.created"
          : eventType === "edited"
            ? "crm_task.updated"
            : "crm_task.status_changed";
      await writeAudit(db, {
        organizationId: org,
        actorId,
        action: auditAction,
        resourceType: "crm_tasks",
        resourceId: task.id,
        requestId: options.requestId,
        metadata: {
          event_id: command.command_id,
          order_id: task.order_id,
          contact_id: task.contact_id,
          revision: task.revision,
          status: task.status,
        },
      });
      return { result: resultOf(task), replayed: false };
    },
    { pool: options.pool },
  );
}

function sameNoteIdentity(
  note: NoteRow,
  input: CreateCrmNote,
  org: string,
  actorId: string,
): boolean {
  return (
    note.organization_id === org &&
    note.contact_id === input.contact_id &&
    note.order_id === (input.order_id ?? null) &&
    note.actor_user_id === actorId
  );
}

function sameNote(note: NoteRow, input: CreateCrmNote, org: string, actorId: string): boolean {
  return sameNoteIdentity(note, input, org, actorId) && note.body === input.body;
}

export async function createCrmNote(
  ctx: TenantCtx,
  executor: TrustedCrmExecutor,
  raw: unknown,
  options: { pool?: ServicePool; requestId?: string } = {},
): Promise<{ note: NoteRow; replayed: boolean }> {
  const input = createCrmNoteSchema.parse(raw);
  return withTenant(
    ctx,
    async (db) => {
      const actorId = await authorizeHumanWrite(db, ctx, executor, "notes.create");
      const org = ctx.organization_id;
      const contactAvailable = await lockContact(db, org, input.contact_id);
      const prior = await db.query<NoteRow>(
        `select id,organization_id,contact_id,order_id,body,actor_user_id,created_at,redacted_at
           from public.crm_notes where organization_id=$1 and id=$2`,
        [org, input.id],
      );
      const previous = prior.rows[0];
      const sameIdentity = previous ? sameNoteIdentity(previous, input, org, actorId) : false;
      if (previous?.redacted_at && sameIdentity) {
        throw new CrmWorkServiceError("note_redacted", 410);
      }
      if (previous) {
        if (!sameNote(previous, input, org, actorId)) {
          throw new CrmWorkServiceError("idempotency_conflict", 409);
        }
        return { note: previous, replayed: true };
      }
      if (!contactAvailable) throw new CrmWorkServiceError("contact_unavailable", 422);
      if (input.order_id) {
        const order = await db.query(
          `select id from public.crm_orders
            where organization_id=$1 and id=$2 and contact_id=$3 for share`,
          [org, input.order_id, input.contact_id],
        );
        if (order.rowCount !== 1) throw new CrmWorkServiceError("order_unavailable", 422);
      }
      const inserted = await db.query<NoteRow>(
        `insert into public.crm_notes
          (id,organization_id,contact_id,order_id,body,actor_user_id)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (id) do nothing
         returning id,organization_id,contact_id,order_id,body,actor_user_id,created_at,redacted_at`,
        [input.id, org, input.contact_id, input.order_id ?? null, input.body, actorId],
      );
      if (inserted.rows[0]) {
        await writeAudit(db, {
          organizationId: org,
          actorId,
          action: "crm_note.created",
          resourceType: "crm_notes",
          resourceId: inserted.rows[0].id,
          requestId: options.requestId,
          metadata: {
            contact_id: inserted.rows[0].contact_id,
            order_id: inserted.rows[0].order_id,
          },
        });
        return { note: inserted.rows[0], replayed: false };
      }
      const concurrent = await db.query<NoteRow>(
        `select id,organization_id,contact_id,order_id,body,actor_user_id,created_at,redacted_at
           from public.crm_notes where organization_id=$1 and id=$2`,
        [org, input.id],
      );
      const note = concurrent.rows[0];
      if (note?.redacted_at && sameNoteIdentity(note, input, org, actorId)) {
        throw new CrmWorkServiceError("note_redacted", 410);
      }
      if (!note || !sameNote(note, input, org, actorId)) {
        throw new CrmWorkServiceError("idempotency_conflict", 409);
      }
      return { note, replayed: true };
    },
    { pool: options.pool },
  );
}
