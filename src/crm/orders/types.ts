import type { OrderItemCommand } from "./commands";
import type { OrderStatus } from "./state";

export interface OrderPending {
  code: string;
  item_id?: string;
}

export interface OrderItemView extends OrderItemCommand {
  line_total_cents: number | null;
}

export interface OrderView {
  id: string;
  contact_id: string;
  company_id: string | null;
  company_name: string | null;
  source: "ui" | "ai" | "automation";
  channel: string | null;
  delivery_date: string | null;
  status: OrderStatus;
  revision: number;
  currency: string | null;
  total_cents: number | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  items: OrderItemView[];
  pending: OrderPending[];
}

export type OrderSummary = Omit<OrderView, "items" | "pending"> & {
  contact_name: string | null;
};
