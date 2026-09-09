import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";

export interface CrmNoteExportRow {
  id: string;
  contact_id: string;
  order_id: string | null;
  body: string;
  actor_user_id: string;
  created_at: string;
  redacted_at: string | null;
}

export interface LinkedTaskExportRow {
  id: string;
  contact_id: string;
  order_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: string;
  status: string;
  assigned_to: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface LinkedTaskEventExportRow {
  id: string;
  task_id: string;
  order_id: string;
  contact_id: string;
  task_revision: number;
  event_type: string;
  from_status: string | null;
  to_status: string;
  actor_type: string;
  actor_id: string | null;
  created_at: string;
}

export interface CrmWorkExport {
  notes: CrmNoteExportRow[];
  linked_tasks: LinkedTaskExportRow[];
  task_events: LinkedTaskEventExportRow[];
}

type Dependencies = { pool?: ServicePool };

async function readCrmWorkSnapshot(
  db: TenantDb,
  organizationId: string,
  contactId: string,
): Promise<CrmWorkExport> {
  const result = await db.query<CrmWorkExport>(
    `select
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', n.id,
          'contact_id', n.contact_id,
          'order_id', n.order_id,
          'body', n.body,
          'actor_user_id', n.actor_user_id,
          'created_at', n.created_at,
          'redacted_at', n.redacted_at
        ) order by n.created_at, n.id)
        from public.crm_notes n
        where n.organization_id = $1 and n.contact_id = $2
      ), '[]'::jsonb) as notes,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'contact_id', t.contact_id,
          'order_id', t.order_id,
          'title', t.title,
          'description', t.description,
          'due_date', t.due_date,
          'priority', t.priority,
          'status', t.status,
          'assigned_to', t.assigned_to,
          'revision', t.revision,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) order by t.created_at, t.id)
        from public.crm_tasks t
        where t.organization_id = $1
          and t.contact_id = $2
          and t.order_id is not null
      ), '[]'::jsonb) as linked_tasks,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id,
          'task_id', e.task_id,
          'order_id', e.order_id,
          'contact_id', e.contact_id,
          'task_revision', e.task_revision,
          'event_type', e.event_type,
          'from_status', e.from_status,
          'to_status', e.to_status,
          'actor_type', e.actor_type,
          'actor_id', e.actor_id,
          'created_at', e.created_at
        ) order by e.created_at, e.id)
        from public.crm_task_events e
        where e.organization_id = $1 and e.contact_id = $2
      ), '[]'::jsonb) as task_events`,
    [organizationId, contactId],
  );
  return result.rows[0] ?? { notes: [], linked_tasks: [], task_events: [] };
}

/** Contexto do job é confiável; o escopo tenant/contact permanece explícito no SQL. */
export async function collectCrmWorkExport(
  ctx: TenantCtx,
  contactId: string,
  dependencies: Dependencies = {},
): Promise<CrmWorkExport> {
  return withTenant(
    ctx,
    (db) => readCrmWorkSnapshot(db, ctx.organization_id, contactId),
    dependencies,
  );
}
