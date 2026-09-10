import { incrementCounter } from "@/src/obs/counters";

export const ORDER_STATUSES = [
  "draft",
  "confirmed",
  "in_production",
  "delivered",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type OrderExecutor = "human" | "ai" | "automation";

const NEXT: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["in_production", "cancelled"],
  in_production: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export class OrderCommandError extends Error {
  constructor(
    public readonly code:
      "illegal_transition" | "executor_denied" | "order_terminal" | "revision_conflict",
  ) {
    super(code);
    this.name = "OrderCommandError";
  }
}

/** Executores vêm do contexto autenticado, jamais do corpo de uma requisição. */
export function assertOrderTransition(
  current: OrderStatus,
  next: OrderStatus,
  executor: OrderExecutor,
): void {
  if (executor !== "human") {
    incrementCounter("actions_denied", { action: "order.set_status", executor });
    throw new OrderCommandError("executor_denied");
  }
  if (!NEXT[current].includes(next)) {
    incrementCounter("order_illegal_transition", { from: current, to: next });
    throw new OrderCommandError("illegal_transition");
  }
}

/** Os terminais não reabrem por edição. Após rascunho, só uma pessoa altera. */
export function assertOrderEditable(status: OrderStatus, executor: OrderExecutor): void {
  if (status === "cancelled" || status === "delivered") {
    throw new OrderCommandError("order_terminal");
  }
  if (executor !== "human" && status !== "draft") {
    incrementCounter("actions_denied", { action: "order.edit", executor });
    throw new OrderCommandError("executor_denied");
  }
}

/** A checagem é repetida sob lock/transação antes de gravar a nova revisão. */
export function assertOrderRevision(actual: number, expected: number): void {
  if (
    !Number.isSafeInteger(actual) ||
    !Number.isSafeInteger(expected) ||
    expected < 1 ||
    actual !== expected
  ) {
    throw new OrderCommandError("revision_conflict");
  }
}
