import { z } from "zod";
import { canonicalOrderQuantitySchema, orderItemCommandSchema } from "@/src/crm/orders/commands";
import { evaluateOrder, orderCatalogPending } from "@/src/crm/orders/completeness";
import { ORDER_STATUSES } from "@/src/crm/orders/state";
import type { OrderSummary, OrderView } from "@/src/crm/orders/types";

export const ORDER_COLUMNS =
  "id,contact_id,company_id,company_name:company_name_snapshot,source,channel,delivery_date,status,revision,currency,total_cents,created_at,updated_at,confirmed_at";
export const ORDER_DETAIL_COLUMNS = `${ORDER_COLUMNS},items:crm_order_items!crm_order_items_order_tenant_fkey(id,position,requested_text,product_id,product_name:product_name_snapshot,sale_unit:sale_unit_snapshot,quantity,unit_price_cents,currency:currency_snapshot,line_total_cents,catalog_reference:catalog_products!crm_order_items_product_tenant_fkey(id,ativo,sale_unit))`;

const headerSchema = z.object({
  id: z.uuid(),
  contact_id: z.uuid(),
  company_id: z.uuid().nullable(),
  company_name: z.string().nullable(),
  source: z.enum(["ui", "ai", "automation"]),
  channel: z.string().nullable(),
  delivery_date: z.iso.date().nullable(),
  status: z.enum(ORDER_STATUSES),
  revision: z.number().int().min(1),
  currency: z.string().nullable(),
  total_cents: z.number().int().min(0).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  confirmed_at: z.string().nullable(),
});
const catalogSchema = z.object({
  id: z.uuid(),
  ativo: z.boolean(),
  sale_unit: z.string().nullable(),
});
const detailSchema = headerSchema.extend({
  items: z.array(
    orderItemCommandSchema.extend({
      quantity: z
        .union([z.string(), z.number()])
        .transform(String)
        .pipe(canonicalOrderQuantitySchema)
        .nullable(),
      line_total_cents: z.number().int().min(0).nullable(),
      catalog_reference: catalogSchema.nullable(),
    }),
  ),
});
const summarySchema = headerSchema.extend({
  contact: z
    .object({ display_name: z.string().nullable(), name: z.string().nullable() })
    .nullable(),
});

/** Cabeçalho, itens e catálogo chegam em uma única consulta PostgREST. */
export function presentOrder(raw: unknown): OrderView {
  const { items: enriched, ...header } = detailSchema.parse(raw);
  const items = enriched
    .map(({ catalog_reference: _catalog, ...item }) => item)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const pending = evaluateOrder({ ...header, items }).pending;
  if (header.status === "draft") {
    pending.push(
      ...orderCatalogPending(
        items,
        enriched.flatMap((item) => (item.catalog_reference ? [item.catalog_reference] : [])),
      ),
    );
  }
  return { ...header, items, pending };
}

export function presentOrderSummaries(raw: unknown): OrderSummary[] {
  return z
    .array(summarySchema)
    .parse(raw)
    .map(({ contact, ...header }) => ({
      ...header,
      contact_name: contact?.display_name ?? contact?.name ?? null,
    }));
}
