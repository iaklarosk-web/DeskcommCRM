import { z } from "zod";

import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";

import { canonicalQuantity, lineTotalCents, quantityToMilli } from "./quantities";
import { ORDER_STATUSES, type OrderStatus } from "./state";

export const DAILY_ORDER_BASES = ["delivery_date", "created_at"] as const;
export type DailyOrderBasis = (typeof DAILY_ORDER_BASES)[number];

type DailyIncludedStatus = Exclude<OrderStatus, "draft" | "cancelled">;
export const DAILY_INCLUDED_STATUSES: readonly DailyIncludedStatus[] = ORDER_STATUSES.filter(
  (status): status is DailyIncludedStatus => status !== "draft" && status !== "cancelled",
);

export const dailyOrderQuerySchema = z.strictObject({
  date: z.iso.date(),
  basis: z.enum(DAILY_ORDER_BASES),
});
export type DailyOrderQuery = z.infer<typeof dailyOrderQuerySchema>;

export type DailyOrderAccess = { support_session_id?: string };

export class DailyOrderReportError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "DailyOrderReportError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const itemSchema = z.strictObject({
  id: z.uuid(),
  position: z.number().int().min(1),
  requested_text: z.string(),
  product_id: z.uuid().nullable(),
  product_name_snapshot: z.string().nullable(),
  sale_unit_snapshot: z.string().nullable(),
  quantity: z.string().nullable(),
  unit_price_cents: z.number().int().min(0).nullable(),
  currency_snapshot: z.string().nullable(),
  line_total_cents: z.number().int().min(0).nullable(),
});

const candidateSchema = z.strictObject({
  order_id: z.uuid(),
  revision: z.number().int().min(1),
  status: z.enum(ORDER_STATUSES),
  source: z.enum(["ui", "ai", "automation"]),
  channel: z.string().nullable(),
  delivery_date: z.iso.date().nullable(),
  created_at: z.union([z.date(), z.string()]),
  contact_id: z.uuid(),
  contact_name: z.string().nullable(),
  company_id: z.uuid().nullable(),
  company_name_snapshot: z.string().nullable(),
  currency: z.string().nullable(),
  total_cents: z.number().int().min(0).nullable(),
  items: z.array(itemSchema),
});
type Candidate = z.infer<typeof candidateSchema>;

const queryRowSchema = z.strictObject({
  authorized: z.boolean(),
  timezone: z.string().nullable(),
  organization: z.strictObject({ id: z.uuid(), name: z.string().min(1) }).nullable(),
  generated_at: z.union([z.date(), z.string()]),
  candidates: z.array(candidateSchema),
});
type QueryRow = z.infer<typeof queryRowSchema>;

export type DailyOrderPending = { code: string; item_id?: string };

export type DailyOrderDetail = {
  order_id: string;
  revision: number;
  status: DailyIncludedStatus;
  source: Candidate["source"];
  channel: string | null;
  delivery_date: string | null;
  created_at: string;
  contact: { id: string; current_name: string | null };
  company: { id: string | null; name_snapshot: string | null };
  currency: string | null;
  total_cents: number | null;
  included_in_totals: boolean;
  pending: DailyOrderPending[];
  items: Candidate["items"];
};

export type DailyOrderGroup = {
  kind: "catalog" | "unlinked";
  product_id: string | null;
  description: string;
  sale_unit: string;
  currency: string;
  quantity: string;
  total_cents: string;
  items: number;
  orders: number;
};

export type DailyOrderReport = {
  criteria: {
    organization: { id: string; name: string };
    date: string;
    basis: DailyOrderBasis;
    timezone: string;
    statuses_included: readonly DailyIncludedStatus[];
  };
  generated_at: string;
  denominators: {
    matching_orders: number;
    eligible_orders: number;
    included_orders: number;
    pending_orders: number;
    excluded_status_orders: { draft: number; cancelled: number };
    included_items: number;
    groups: number;
  };
  orders: DailyOrderDetail[];
  groups: DailyOrderGroup[];
  currency_totals: Array<{ currency: string; total_cents: string }>;
};

type MutableGroup = Omit<DailyOrderGroup, "quantity" | "total_cents"> & {
  quantity_milli: bigint;
  total: bigint;
  order_ids: Set<string>;
};

function exactPending(candidate: Candidate): DailyOrderPending[] {
  const pending: DailyOrderPending[] = [];
  const add = (code: string, item_id?: string) =>
    pending.push(item_id ? { code, item_id } : { code });
  if (!candidate.currency) add("currency_required");
  if (candidate.total_cents === null) add("total_required");
  if (candidate.items.length === 0) add("items_required");

  let computed = 0n;
  for (const item of candidate.items) {
    const description = item.product_name_snapshot ?? item.requested_text;
    if (description.trim().length === 0) add("description_required", item.id);
    if (!item.sale_unit_snapshot) add("sale_unit_required", item.id);
    if (item.quantity === null) add("quantity_required", item.id);
    if (item.unit_price_cents === null) add("price_required", item.id);
    if (item.currency_snapshot === null) add("item_currency_required", item.id);
    else if (candidate.currency && item.currency_snapshot !== candidate.currency)
      add("currency_mismatch", item.id);
    if (item.line_total_cents === null) add("line_total_required", item.id);
    if (item.quantity !== null && item.unit_price_cents !== null) {
      try {
        const exact = lineTotalCents(item.quantity, item.unit_price_cents);
        if (item.line_total_cents !== exact) add("line_total_mismatch", item.id);
      } catch (error) {
        add(error instanceof Error ? error.message : "invalid_quantity", item.id);
      }
    }
    if (item.line_total_cents !== null) computed += BigInt(item.line_total_cents);
  }
  if (candidate.total_cents !== null && computed !== BigInt(candidate.total_cents))
    add("order_total_mismatch");
  return pending;
}

const iso = (value: Date | string): string => new Date(value).toISOString();

/** Agregação pura; qualquer pedido pendente fica visível, mas fora dos acumuladores. */
export function presentDailyOrderReport(rowRaw: unknown, query: DailyOrderQuery): DailyOrderReport {
  const row = queryRowSchema.parse(rowRaw);
  if (!row.authorized || row.timezone === null || row.organization === null)
    throw new DailyOrderReportError("forbidden_tenant", 403);

  const excluded = { draft: 0, cancelled: 0 };
  const groups = new Map<string, MutableGroup>();
  const totals = new Map<string, bigint>();
  const orders: DailyOrderDetail[] = [];
  let includedItems = 0;

  for (const candidate of row.candidates) {
    if (candidate.status === "draft" || candidate.status === "cancelled") {
      excluded[candidate.status] += 1;
      continue;
    }
    const pending = exactPending(candidate);
    const included = pending.length === 0;
    orders.push({
      order_id: candidate.order_id,
      revision: candidate.revision,
      status: candidate.status,
      source: candidate.source,
      channel: candidate.channel,
      delivery_date: candidate.delivery_date,
      created_at: iso(candidate.created_at),
      contact: { id: candidate.contact_id, current_name: candidate.contact_name },
      company: { id: candidate.company_id, name_snapshot: candidate.company_name_snapshot },
      currency: candidate.currency,
      total_cents: candidate.total_cents,
      included_in_totals: included,
      pending,
      items: [...candidate.items].sort(
        (a, b) => a.position - b.position || a.id.localeCompare(b.id),
      ),
    });
    if (!included) continue;

    for (const item of candidate.items) {
      const description = item.product_name_snapshot ?? item.requested_text;
      const saleUnit = item.sale_unit_snapshot!;
      const currency = item.currency_snapshot!;
      const kind = item.product_id === null ? "unlinked" : "catalog";
      const key = JSON.stringify([kind, item.product_id, description, saleUnit, currency]);
      const current = groups.get(key) ?? {
        kind,
        product_id: item.product_id,
        description,
        sale_unit: saleUnit,
        currency,
        quantity_milli: 0n,
        total: 0n,
        items: 0,
        orders: 0,
        order_ids: new Set<string>(),
      };
      current.quantity_milli += quantityToMilli(item.quantity!);
      current.total += BigInt(item.line_total_cents!);
      current.items += 1;
      current.order_ids.add(candidate.order_id);
      current.orders = current.order_ids.size;
      groups.set(key, current);
      totals.set(currency, (totals.get(currency) ?? 0n) + BigInt(item.line_total_cents!));
      includedItems += 1;
    }
  }

  const grouped = [...groups.values()]
    .map(({ quantity_milli, total, order_ids: _ids, ...group }) => ({
      ...group,
      quantity: canonicalQuantity(quantity_milli),
      total_cents: total.toString(),
    }))
    .sort(
      (a, b) =>
        a.currency.localeCompare(b.currency) ||
        a.sale_unit.localeCompare(b.sale_unit) ||
        a.description.localeCompare(b.description) ||
        (a.product_id ?? "").localeCompare(b.product_id ?? ""),
    );
  const includedOrders = orders.filter((order) => order.included_in_totals).length;
  return {
    criteria: {
      organization: row.organization,
      ...query,
      timezone: row.timezone,
      statuses_included: DAILY_INCLUDED_STATUSES,
    },
    generated_at: iso(row.generated_at),
    denominators: {
      matching_orders: row.candidates.length,
      eligible_orders: orders.length,
      included_orders: includedOrders,
      pending_orders: orders.length - includedOrders,
      excluded_status_orders: excluded,
      included_items: includedItems,
      groups: grouped.length,
    },
    orders,
    groups: grouped,
    currency_totals: [...totals]
      .map(([currency, total]) => ({ currency, total_cents: total.toString() }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}

async function queryDaily(
  db: TenantDb,
  ctx: TenantCtx,
  access: DailyOrderAccess,
  query: DailyOrderQuery,
) {
  return db.query<QueryRow>(
    `with target_org as (
       select id,timezone,status,
         coalesce(nullif(display_name,''),nullif(legal_name,''),slug) name
       from public.organizations where id=$1
     ), membership as (
       select uo.role from public.user_organizations uo
        where uo.organization_id=$1 and uo.user_id=$2
          and uo.accepted_at is not null and uo.revoked_at is null
        limit 1
     ), platform as (
       select 1 from public.platform_admins
        where user_id=$2 and revoked_at is null limit 1
     ), support as (
       select 1 from public.platform_support_sessions ss
       join auth.sessions auths on auths.id=ss.auth_session_id
         and auths.user_id=ss.actor_user_id
         and (auths.not_after is null or auths.not_after>now())
        where $4::uuid is not null and ss.id=$4 and ss.organization_id=$1
          and ss.actor_user_id=$2 and ss.ended_at is null and ss.expires_at>now()
        limit 1
     ), access as (
       select o.timezone,
         o.status='active' and (
           ($4::uuid is not null and exists(select 1 from support) and exists(select 1 from platform))
           or ($4::uuid is null and exists(select 1 from membership) and not exists(select 1 from platform))
         ) authorized
       from target_org o
     )
     select coalesce((select authorized from access),false) authorized,
            (select timezone from access) timezone,current_timestamp generated_at,
            (select jsonb_build_object('id',id,'name',name) from target_org) organization,
            coalesce((select jsonb_agg(jsonb_build_object(
              'order_id',o.id,'revision',o.revision,'status',o.status,'source',o.source,
              'channel',o.channel,'delivery_date',o.delivery_date::text,'created_at',o.created_at,
              'contact_id',o.contact_id,'contact_name',coalesce(c.display_name,c.name),
              'company_id',o.company_id,'company_name_snapshot',o.company_name_snapshot,
              'currency',o.currency,'total_cents',o.total_cents,
              'items',coalesce((select jsonb_agg(jsonb_build_object(
                'id',i.id,'position',i.position,'requested_text',i.requested_text,
                'product_id',i.product_id,'product_name_snapshot',i.product_name_snapshot,
                'sale_unit_snapshot',i.sale_unit_snapshot,'quantity',i.quantity::text,
                'unit_price_cents',i.unit_price_cents,'currency_snapshot',i.currency_snapshot,
                'line_total_cents',i.line_total_cents) order by i.position,i.id)
                from public.crm_order_items i where i.organization_id=$1 and i.order_id=o.id),
                '[]'::jsonb)) order by o.created_at,o.id)
              from public.crm_orders o
              join public.contacts c on c.organization_id=$1 and c.id=o.contact_id
              cross join access a
             where a.authorized and o.organization_id=$1 and (
               ($3='delivery_date' and o.delivery_date=$5::date)
               or ($3='created_at'
                 and o.created_at >= ($5::date::timestamp at time zone a.timezone)
                 and o.created_at < (($5::date+1)::timestamp at time zone a.timezone))
             )), '[]'::jsonb) candidates`,
    [ctx.organization_id, ctx.user_id, query.basis, access.support_session_id ?? null, query.date],
  );
}

export async function getDailyOrderReport(
  ctx: TenantCtx,
  access: DailyOrderAccess,
  rawQuery: unknown,
  options: { pool?: ServicePool } = {},
): Promise<DailyOrderReport> {
  const query = dailyOrderQuerySchema.parse(rawQuery);
  if (ctx.source !== "session" || !ctx.user_id || !UUID.test(ctx.user_id))
    throw new DailyOrderReportError("session_context_required", 403);
  if (access.support_session_id && !UUID.test(access.support_session_id))
    throw new DailyOrderReportError("forbidden_tenant", 403);
  return withTenant(
    ctx,
    async (db) => {
      const result = await queryDaily(db, ctx, access, query);
      return presentDailyOrderReport(result.rows[0], query);
    },
    options,
  );
}
