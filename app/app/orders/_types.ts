/** Copy this file with the screens: order shapes deliberately come from the domain contract. */
export type { OrderItemView, OrderPending, OrderSummary, OrderView } from "@/src/crm/orders/types";

export type ApiList<T> = {
  data: T[];
  meta: { page: number; limit: number; total: number; has_more: boolean };
};
