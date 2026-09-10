import type { OrderItemCommand } from "./commands";
import {
  assertMatchingSaleUnit,
  lineTotalCents,
  OrderQuantityError,
  sumTotalCents,
} from "./quantities";
import type { OrderItemView, OrderPending } from "./types";

/** Avalia apenas os valores combinados. Nunca consulta preço novo do catálogo. */
export function evaluateOrder(fields: {
  delivery_date: string | null;
  currency: string | null;
  items: readonly OrderItemCommand[];
}): { items: OrderItemView[]; pending: OrderPending[]; total_cents: number | null } {
  const pending: OrderPending[] = [];
  if (!fields.delivery_date) pending.push({ code: "delivery_date_required" });
  if (!fields.currency) pending.push({ code: "currency_required" });
  if (fields.items.length === 0) pending.push({ code: "items_required" });
  const items = fields.items.map((item): OrderItemView => {
    const add = (code: string) => pending.push({ code, item_id: item.id });
    if (!item.product_id) add("product_required");
    if (!item.product_name) add("product_name_required");
    if (!item.sale_unit) add("sale_unit_required");
    if (item.quantity === null) add("quantity_required");
    if (item.unit_price_cents === null) add("price_required");
    if (item.currency === null) add("item_currency_required");
    else if (fields.currency !== null && item.currency !== fields.currency)
      add("currency_mismatch");
    let line_total_cents: number | null = null;
    if (
      item.product_id !== null &&
      item.product_name !== null &&
      item.sale_unit !== null &&
      item.currency !== null &&
      item.quantity !== null &&
      item.unit_price_cents !== null
    ) {
      try {
        line_total_cents = lineTotalCents(item.quantity, item.unit_price_cents);
      } catch (error) {
        if (!(error instanceof OrderQuantityError)) throw error;
        add(error.code);
      }
    }
    return { ...item, line_total_cents };
  });
  let total_cents: number | null = null;
  const amountsKnown =
    fields.currency !== null &&
    items.length > 0 &&
    items.every((item) => item.line_total_cents !== null && item.currency === fields.currency);
  if (amountsKnown) {
    try {
      total_cents = sumTotalCents(items.map((item) => item.line_total_cents as number));
    } catch (error) {
      if (!(error instanceof OrderQuantityError)) throw error;
      pending.push({ code: error.code });
    }
  }
  return { items, pending, total_cents };
}

export type OrderCatalogReference = { id: string; ativo: boolean; sale_unit: string | null };

/** Pendências atuais do catálogo, sem alterar os snapshots/valores do pedido. */
export function orderCatalogPending(
  items: readonly OrderItemCommand[],
  products: readonly OrderCatalogReference[],
): OrderPending[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  const pending: OrderPending[] = [];
  for (const item of items) {
    if (!item.product_id) continue;
    const product = byId.get(item.product_id);
    if (!product) {
      pending.push({ code: "product_unavailable", item_id: item.id });
      continue;
    }
    if (!product.ativo) pending.push({ code: "product_inactive", item_id: item.id });
    if (!product.sale_unit) pending.push({ code: "catalog_sale_unit_required", item_id: item.id });
    else {
      try {
        assertMatchingSaleUnit(item.sale_unit, product.sale_unit);
      } catch (error) {
        if (!(error instanceof OrderQuantityError)) throw error;
        pending.push({ code: error.code, item_id: item.id });
      }
    }
  }
  return pending;
}
