import type { TenantDb } from "@/src/tenant-context";
import { evaluateOrder, orderCatalogPending, type OrderCatalogReference } from "./completeness";
import type { OrderItemView, OrderView } from "./types";

type StoredOrder = Omit<
  OrderView,
  "items" | "pending" | "created_at" | "updated_at" | "confirmed_at"
> & {
  created_at: Date | string;
  updated_at: Date | string;
  confirmed_at: Date | string | null;
};
const iso = (value: Date | string) => new Date(value).toISOString();

export async function readOrder(
  db: TenantDb,
  organizationId: string,
  orderId: string,
  lock = false,
): Promise<OrderView | null> {
  if (lock) {
    // O SELECT seguinte obtém snapshot novo APÓS uma eventual espera pelo lock.
    await db.query(
      `select id from public.crm_orders where organization_id=$1 and id=$2 for update`,
      [organizationId, orderId],
    );
  }
  const result = await db.query<
    StoredOrder & { items: (OrderItemView & { catalog_reference: OrderCatalogReference | null })[] }
  >(
    `select o.id,o.contact_id,o.company_id,o.company_name_snapshot as company_name,o.source,o.channel,
            o.delivery_date::text as delivery_date,o.status,o.revision,o.currency,o.total_cents,
            o.created_at,o.updated_at,o.confirmed_at,
            coalesce((select jsonb_agg(jsonb_build_object(
              'id',i.id,'position',i.position,'requested_text',i.requested_text,'product_id',i.product_id,
              'product_name',i.product_name_snapshot,'sale_unit',i.sale_unit_snapshot,
              'quantity',i.quantity::text,'unit_price_cents',i.unit_price_cents,
              'currency',i.currency_snapshot,'line_total_cents',i.line_total_cents,
              'catalog_reference',case when p.id is null then null else jsonb_build_object(
                'id',p.id,'ativo',p.ativo,'sale_unit',p.sale_unit) end
            ) order by i.position,i.id)
              from public.crm_order_items i left join public.catalog_products p
                on p.organization_id=i.organization_id and p.id=i.product_id
              where i.organization_id=o.organization_id and i.order_id=o.id), '[]'::jsonb) as items
       from public.crm_orders o where o.organization_id=$1 and o.id=$2`,
    [organizationId, orderId],
  );
  const record = result.rows[0];
  if (!record) return null;
  const { items: enrichedItems, ...order } = record;
  const items = enrichedItems.map(({ catalog_reference: _catalog, ...item }) => item);
  const pending = evaluateOrder({ ...order, items }).pending;
  if (order.status === "draft") {
    const products = enrichedItems.flatMap((item) =>
      item.catalog_reference ? [item.catalog_reference] : [],
    );
    pending.push(...orderCatalogPending(items, products));
  }
  return {
    ...order,
    created_at: iso(order.created_at),
    updated_at: iso(order.updated_at),
    confirmed_at: order.confirmed_at ? iso(order.confirmed_at) : null,
    items,
    pending,
  };
}

/** A constraint de posição é diferida; IDs sobrevivem inclusive à reordenação. */
export async function writeOrderItems(
  db: TenantDb,
  organizationId: string,
  orderId: string,
  items: readonly OrderItemView[],
): Promise<void> {
  await db.query(
    `delete from public.crm_order_items where organization_id=$1 and order_id=$2
       and not (id=any($3::uuid[]))`,
    [organizationId, orderId, items.map((item) => item.id)],
  );
  for (const item of items) {
    const result = await db.query<{ id: string }>(
      `insert into public.crm_order_items
        (id,organization_id,order_id,position,requested_text,product_id,product_name_snapshot,
         sale_unit_snapshot,quantity,unit_price_cents,currency_snapshot,line_total_cents)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (id) do update set
         position=excluded.position,requested_text=excluded.requested_text,product_id=excluded.product_id,
         product_name_snapshot=excluded.product_name_snapshot,sale_unit_snapshot=excluded.sale_unit_snapshot,
         quantity=excluded.quantity,unit_price_cents=excluded.unit_price_cents,
         currency_snapshot=excluded.currency_snapshot,line_total_cents=excluded.line_total_cents
       where crm_order_items.organization_id=excluded.organization_id
         and crm_order_items.order_id=excluded.order_id
       returning id`,
      [
        item.id,
        organizationId,
        orderId,
        item.position,
        item.requested_text,
        item.product_id,
        item.product_name,
        item.sale_unit,
        item.quantity,
        item.unit_price_cents,
        item.currency,
        item.line_total_cents,
      ],
    );
    if (result.rowCount !== 1) throw new Error("order_item_identity_conflict");
  }
}
