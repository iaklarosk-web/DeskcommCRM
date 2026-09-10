import { beforeEach, describe, expect, it } from "vitest";
import { counterTotal, resetCounters } from "@/src/obs/counters";
import {
  assertOrderEditable,
  assertOrderRevision,
  assertOrderTransition,
  type OrderStatus,
} from "@/src/crm/orders/state";

beforeEach(resetCounters);

describe("pedido operacional — estados aprovados D22/D34", () => {
  it("pessoa confirma, inicia preparação e entrega; o terminal não reabre", () => {
    expect(() => assertOrderTransition("draft", "confirmed", "human")).not.toThrow();
    expect(() => assertOrderTransition("confirmed", "in_production", "human")).not.toThrow();
    expect(() => assertOrderTransition("in_production", "delivered", "human")).not.toThrow();
    expect(() => assertOrderTransition("delivered", "draft", "human")).toThrow(
      "illegal_transition",
    );
    expect(() => assertOrderEditable("delivered", "human")).toThrow("order_terminal");
    expect(counterTotal("order_illegal_transition")).toBe(1);
  });

  it.each(["draft", "confirmed", "in_production"] as const)(
    "pessoa cancela %s e o cancelamento é terminal",
    (from) => {
      expect(() => assertOrderTransition(from, "cancelled", "human")).not.toThrow();
      expect(() => assertOrderTransition("cancelled", from, "human")).toThrow("illegal_transition");
      expect(() => assertOrderEditable("cancelled", "human")).toThrow("order_terminal");
    },
  );

  it("IA e automação não confirmam nem entregam pedidos", () => {
    for (const executor of ["ai", "automation"] as const) {
      expect(() => assertOrderTransition("draft", "confirmed", executor)).toThrow(
        "executor_denied",
      );
      expect(() => assertOrderTransition("in_production", "delivered", executor)).toThrow(
        "executor_denied",
      );
      expect(() => assertOrderEditable("draft", executor)).not.toThrow();
      expect(() => assertOrderEditable("confirmed", executor)).toThrow("executor_denied");
      expect(() => assertOrderEditable("in_production", executor)).toThrow("executor_denied");
    }
    expect(counterTotal("actions_denied")).toBe(8);
  });

  it("não pula confirmação/preparação nem volta estado para aceitar uma edição", () => {
    const denied: [OrderStatus, OrderStatus][] = [
      ["draft", "in_production"],
      ["draft", "delivered"],
      ["confirmed", "delivered"],
      ["confirmed", "draft"],
      ["in_production", "confirmed"],
      ["in_production", "draft"],
      ["delivered", "cancelled"],
      ["cancelled", "delivered"],
      ["confirmed", "confirmed"],
    ];
    for (const [from, to] of denied) {
      expect(() => assertOrderTransition(from, to, "human")).toThrow("illegal_transition");
    }
    expect(counterTotal("order_illegal_transition")).toBe(denied.length);
  });

  it("a segunda edição com revisão antiga pede recarga em vez de sobrescrever", () => {
    expect(() => assertOrderRevision(7, 7)).not.toThrow();
    expect(() => assertOrderRevision(8, 7)).toThrow("revision_conflict");
    for (const revision of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => assertOrderRevision(revision, revision)).toThrow("revision_conflict");
    }
  });
});
