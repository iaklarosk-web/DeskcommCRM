import { describe, expect, it } from "vitest";

import {
  checkedQuantitySchema,
  orderCheckCommandSchema,
  orderCheckListQuerySchema,
  orderChecksViewSchema,
} from "@/src/crm/orders/checks-contracts";
import { orderCheckCommandHash } from "@/src/crm/orders/checks-service";

const ORDER = "f0200012-3000-4000-8000-000000000001";
const ITEM = "f0200012-4000-4000-8000-000000000001";
const USER = "f0200012-1000-4000-8000-000000000001";
const KEY = "f0200012-5000-4000-8000-000000000001";

function command(overrides: Record<string, unknown> = {}) {
  return {
    idempotency_key: KEY,
    expected_revision: 3,
    item_id: ITEM,
    checked_quantity: "2.5",
    ...overrides,
  };
}

describe("contrato de conferência de pedidos", () => {
  it.each(["0", "0.0", "0.00", "0.000"])(
    "canoniza o zero explícito %s como pendente",
    (value) => expect(checkedQuantitySchema.parse(value)).toBe("0.000"),
  );

  it.each([
    ["0.001", "0.001"],
    ["2.5", "2.500"],
    ["999999999.999", "999999999.999"],
  ])("reutiliza o formato decimal canônico para %s", (value, expected) => {
    expect(checkedQuantitySchema.parse(value)).toBe(expected);
  });

  it.each(["-1", "0,5", "1.0000", "1e3", "1000000000"])(
    "rejeita quantidade de transporte inválida %s",
    (value) => expect(checkedQuantitySchema.safeParse(value).success).toBe(false),
  );

  it("é estrito e canoniza todos os UUIDs do comando", () => {
    const parsed = orderCheckCommandSchema.parse(
      command({ idempotency_key: KEY.toUpperCase(), item_id: ITEM.toUpperCase() }),
    );
    expect(parsed).toEqual({
      idempotency_key: KEY,
      expected_revision: 3,
      item_id: ITEM,
      checked_quantity: "2.500",
    });
    expect(orderCheckCommandSchema.safeParse(command({ organization_id: ORDER })).success).toBe(
      false,
    );
  });

  it("produz hash estável sem a chave e vinculado a ator, pedido e payload", () => {
    const parsed = orderCheckCommandSchema.parse(command());
    const sameBodyOtherKey = orderCheckCommandSchema.parse(
      command({ idempotency_key: "f0200012-5000-4000-8000-000000000002" }),
    );
    expect(orderCheckCommandHash(ORDER, parsed, USER)).toEqual(
      orderCheckCommandHash(ORDER, sameBodyOtherKey, USER),
    );
    expect(orderCheckCommandHash(ORDER, parsed, USER)).not.toEqual(
      orderCheckCommandHash(ORDER, parsed, "f0200012-1000-4000-8000-000000000002"),
    );
    expect(orderCheckCommandHash(ORDER, parsed, USER)).not.toEqual(
      orderCheckCommandHash(
        ORDER,
        orderCheckCommandSchema.parse(command({ checked_quantity: "2.501" })),
        USER,
      ),
    );
  });

  it("aplica paginação limitada e cursor decimal positivo", () => {
    expect(orderCheckListQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(orderCheckListQuerySchema.parse({ limit: "100", before_sequence: "42" })).toEqual({
      limit: 100,
      before_sequence: "42",
    });
    expect(orderCheckListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(orderCheckListQuerySchema.safeParse({ before_sequence: "0" }).success).toBe(false);
    expect(
      orderCheckListQuerySchema.safeParse({ before_sequence: "9223372036854775808" }).success,
    ).toBe(false);
  });

  it("valida estado atual sem evento e histórico com snapshots", () => {
    const parsed = orderChecksViewSchema.parse({
      order_id: ORDER,
      order_revision: 3,
      items: [
        {
          item_id: ITEM,
          ordered_quantity: "2.500",
          checked_quantity: "0.000",
          sale_unit: "kg",
          state: "pending",
          event_id: null,
          event_sequence: null,
          checked_by_user_id: null,
          checked_at: null,
        },
      ],
      history: [
        {
          event_id: "f0200012-6000-4000-8000-000000000001",
          event_sequence: "10",
          order_id: ORDER,
          order_revision: 2,
          item_id: ITEM,
          ordered_quantity: "2.500",
          checked_quantity: "1.000",
          sale_unit: "kg",
          state: "partial",
          checked_by_user_id: USER,
          checked_at: "2026-09-09T18:00:00.000Z",
        },
      ],
      next_before_sequence: "10",
    });
    expect(parsed.history[0]?.checked_quantity).toBe("1.000");
  });
});
