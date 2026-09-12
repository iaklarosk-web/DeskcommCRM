import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";

export interface OperationalOrderItem {
  id: string;
  position: number;
  requested_text: string;
  product_id: string | null;
  product_name: string | null;
  sale_unit: string | null;
  quantity: string | null;
  unit_price_cents: number | null;
  currency: string | null;
  line_total_cents: number | null;
}
export interface OperationalOrderRow {
  id: string;
  contact_id: string;
  company_id: string | null;
  company_name: string | null;
  source: string;
  channel: string | null;
  delivery_date: string | null;
  status: string;
  revision: number;
  currency: string | null;
  total_cents: number | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  items: OperationalOrderItem[];
}
export interface OperationalOrderEventRow {
  id: string;
  order_id: string;
  revision: number;
  type: string;
  created_at: string;
  changes: Record<string, unknown>;
}
export interface OperationalOrderSavedSnapshot {
  saved_at: string;
  order: Record<string, unknown>;
}
export interface OperationalOrderCheckRow {
  event_id: string;
  event_sequence: string;
  order_id: string;
  order_revision: number;
  item_id: string;
  ordered_quantity: string | null;
  checked_quantity: string;
  sale_unit: string | null;
  state: string;
  checked_by_user_id: string;
  checked_at: string;
}
export interface OperationalOrderExport {
  orders: OperationalOrderRow[];
  events: OperationalOrderEventRow[];
  saved_snapshots: OperationalOrderSavedSnapshot[];
  checks: OperationalOrderCheckRow[];
}

type Deps = { pool?: ServicePool };
type SnapshotRow = OperationalOrderExport;

async function readSnapshot(
  db: TenantDb,
  organizationId: string,
  contactId: string,
): Promise<OperationalOrderExport> {
  const result = await db.query<SnapshotRow>(
    `select
      coalesce((select jsonb_agg(jsonb_build_object(
        'id',o.id,'contact_id',o.contact_id,'company_id',o.company_id,'company_name',o.company_name_snapshot,
        'source',o.source,'channel',o.channel,'delivery_date',o.delivery_date::text,'status',o.status,
        'revision',o.revision,'currency',o.currency,'total_cents',o.total_cents,'created_at',o.created_at,
        'updated_at',o.updated_at,'confirmed_at',o.confirmed_at,'items',coalesce((select jsonb_agg(jsonb_build_object(
          'id',i.id,'position',i.position,'requested_text',i.requested_text,'product_id',i.product_id,
          'product_name',i.product_name_snapshot,'sale_unit',i.sale_unit_snapshot,'quantity',i.quantity::text,
          'unit_price_cents',i.unit_price_cents,'currency',i.currency_snapshot,'line_total_cents',i.line_total_cents
        ) order by i.position,i.id) from public.crm_order_items i where i.organization_id=o.organization_id and i.order_id=o.id),'[]'::jsonb)
      ) order by o.created_at,o.id) from public.crm_orders o where o.organization_id=$1 and o.contact_id=$2),'[]'::jsonb) as orders,
      coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'order_id',e.order_id,'revision',e.order_revision,
        'type',e.event_type,'created_at',e.created_at,'changes',
        case when e.changes->>'redacted'='true' then '{"redacted":true}'::jsonb else
          jsonb_strip_nulls(jsonb_build_object(
            'before',case when e.changes#>>'{before,contact_id}'=$2::text then e.changes->'before' end,
            'after',case when e.changes#>>'{after,contact_id}'=$2::text then e.changes->'after' end,
            'reason',case when (e.changes#>>'{before,contact_id}' is null or e.changes#>>'{before,contact_id}'=$2::text)
              and (e.changes#>>'{after,contact_id}' is null or e.changes#>>'{after,contact_id}'=$2::text) then e.changes->'reason' end
          )) end) order by e.created_at,e.id)
       from public.crm_order_events e where e.organization_id=$1 and e.contact_id=$2),'[]'::jsonb) as events,
      coalesce((select jsonb_agg(jsonb_build_object(
        'saved_at',r.completed_at,'order',jsonb_build_object(
          'id',r.response_body->'id','contact_id',r.response_body->'contact_id','company_id',r.response_body->'company_id','company_name',r.response_body->'company_name','source',r.response_body->'source','channel',r.response_body->'channel','delivery_date',r.response_body->'delivery_date','status',r.response_body->'status','revision',r.response_body->'revision','currency',r.response_body->'currency','total_cents',r.response_body->'total_cents','created_at',r.response_body->'created_at','updated_at',r.response_body->'updated_at','confirmed_at',r.response_body->'confirmed_at',
          'items',coalesce((select jsonb_agg(jsonb_build_object('id',v.item->'id','position',v.item->'position','requested_text',v.item->'requested_text','product_id',v.item->'product_id','product_name',v.item->'product_name','sale_unit',v.item->'sale_unit','quantity',v.item->'quantity','unit_price_cents',v.item->'unit_price_cents','currency',v.item->'currency','line_total_cents',v.item->'line_total_cents') order by v.position)
            from jsonb_array_elements(case when jsonb_typeof(r.response_body->'items')='array'
              then r.response_body->'items' else '[]'::jsonb end) with ordinality as v(item,position)), '[]'::jsonb)
        )) order by r.completed_at,r.id)
        from public.crm_order_command_receipts r
        join public.crm_orders saved_order on saved_order.organization_id=r.organization_id and saved_order.id=r.order_id
        where r.organization_id=$1 and saved_order.contact_id=$2
          and r.completed_at is not null and r.response_body->>'contact_id'=$2::text
          and r.response_body->>'id'=r.order_id::text),'[]'::jsonb) as saved_snapshots,
      coalesce((select jsonb_agg(jsonb_build_object(
        'event_id',c.id,'event_sequence',c.event_sequence::text,'order_id',c.order_id,
        'order_revision',c.order_revision,'item_id',c.item_id,
        'ordered_quantity',c.ordered_quantity_snapshot::text,
        'checked_quantity',c.checked_quantity::text,'sale_unit',c.sale_unit_snapshot,
        'state',c.check_state,'checked_by_user_id',c.actor_user_id,'checked_at',c.created_at
      ) order by c.event_sequence)
        from public.crm_order_check_events c
        join public.crm_orders checked_order
          on checked_order.organization_id=c.organization_id and checked_order.id=c.order_id
       where c.organization_id=$1 and checked_order.contact_id=$2),'[]'::jsonb) as checks`,
    [organizationId, contactId],
  );
  return result.rows[0] ?? { orders: [], events: [], saved_snapshots: [], checks: [] };
}

/** Job context is trusted by the LGPD worker; tenant scope still travels through withTenant. */
export async function collectOperationalOrderExport(
  ctx: TenantCtx,
  contactId: string,
  deps: Deps = {},
): Promise<OperationalOrderExport> {
  return withTenant(ctx, (db) => readSnapshot(db, ctx.organization_id, contactId), deps);
}
