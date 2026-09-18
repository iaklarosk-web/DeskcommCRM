import { describe, expect, it } from "vitest";

import {
  advanceOrderCommandSchema,
  cancelOrderCommandSchema,
  confirmOrderCommandSchema,
  createDraftCommandSchema,
  editOrderCommandSchema,
  orderCommandSchema,
} from "../../src/crm/orders/commands";
import { canonicalQuantity } from "../../src/crm/orders/quantities";

const ORDER_ID = "f0200002-0000-4000-8000-000000000001";
const CONTACT_ID = "f0200002-0000-4000-8000-000000000002";
const ITEM_ID = "f0200002-0000-4000-8000-000000000003";
const COMPANY_ID = "f0200002-0000-4000-8000-000000000004";
const PRODUCT_ID = "f0200002-0000-4000-8000-000000000005";

function item(id = ITEM_ID, productId: string | null = null) {
  return {
    id,
    position: 1,
    requested_text: "item solicitado",
    product_id: productId,
    product_name: null,
    sale_unit: null,
    quantity: null,
    unit_price_cents: null,
    currency: null,
  };
}

describe("contratos dos comandos de pedido", () => {
  it("cria rascunho com pendências explícitas e ID estável do item", () => {
    const parsed = createDraftCommandSchema.parse({
      command: "create_draft",
      idempotency_key: " req-1 ",
      contact_id: CONTACT_ID,
      company_id: null,
      company_name: null,
      channel: null,
      delivery_date: null,
      currency: null,
      items: [
        {
          id: ITEM_ID,
          position: 1,
          requested_text: "  duas caixas do produto citado  ",
          product_id: null,
          product_name: null,
          sale_unit: null,
          quantity: null,
          unit_price_cents: null,
          currency: null,
        },
      ],
    });

    expect(parsed).toMatchObject({
      idempotency_key: "req-1",
      delivery_date: null,
      currency: null,
      items: [{ id: ITEM_ID, requested_text: "duas caixas do produto citado" }],
    });
  });

  it("canonicaliza decimal exato reutilizando o parser do domínio", () => {
    const parsed = createDraftCommandSchema.parse({
      command: "create_draft",
      idempotency_key: "req-2",
      contact_id: CONTACT_ID,
      company_id: null,
      company_name: null,
      channel: "whatsapp",
      delivery_date: "2026-09-10",
      currency: "BRL",
      items: [
        {
          id: ITEM_ID,
          position: 1,
          requested_text: "meio quilo",
          product_id: null,
          product_name: null,
          sale_unit: "kg",
          quantity: "0.5",
          unit_price_cents: 1000,
          currency: "BRL",
        },
      ],
    });

    expect(parsed.items[0]?.quantity).toBe("0.500");
    expect(canonicalQuantity(500n)).toBe("0.500");
  });

  it("não aceita escopo, ator, executor ou source no corpo", () => {
    const base = {
      command: "confirm_order",
      idempotency_key: "req-3",
      order_id: ORDER_ID,
      expected_revision: 1,
    };
    for (const forbidden of ["organization_id", "actor_id", "executor", "source"] as const) {
      expect(confirmOrderCommandSchema.safeParse({ ...base, [forbidden]: "forged" }).success).toBe(
        false,
      );
    }
  });

  it("edição exige revisão, ao menos uma alteração e preserva IDs de itens", () => {
    expect(
      editOrderCommandSchema.safeParse({
        command: "edit_order",
        idempotency_key: "req-4",
        order_id: ORDER_ID,
        expected_revision: 1,
      }).success,
    ).toBe(false);
    expect(
      editOrderCommandSchema.parse({
        command: "edit_order",
        idempotency_key: "req-4",
        order_id: ORDER_ID,
        expected_revision: 2,
        items: [],
      }),
    ).toMatchObject({ expected_revision: 2, items: [] });
    expect(
      editOrderCommandSchema.safeParse({
        command: "edit_order",
        idempotency_key: "req-4",
        order_id: ORDER_ID,
        expected_revision: 0,
        items: [],
      }).success,
    ).toBe(false);
  });

  it("advance só expressa os dois passos posteriores à confirmação", () => {
    expect(
      advanceOrderCommandSchema.parse({
        command: "advance_order",
        idempotency_key: "req-5",
        order_id: ORDER_ID,
        expected_revision: 3,
        next_status: "delivered",
      }).next_status,
    ).toBe("delivered");
    expect(
      advanceOrderCommandSchema.safeParse({
        command: "advance_order",
        idempotency_key: "req-5",
        order_id: ORDER_ID,
        expected_revision: 3,
        next_status: "confirmed",
      }).success,
    ).toBe(false);
    expect(orderCommandSchema.options).toHaveLength(5);
  });

  it("canonicaliza IDs do rascunho e dos itens antes do serviço", () => {
    const parsed = createDraftCommandSchema.parse({
      command: "create_draft",
      idempotency_key: "uuid-create",
      contact_id: CONTACT_ID.toUpperCase(),
      company_id: COMPANY_ID.toUpperCase(),
      company_name: null,
      channel: null,
      delivery_date: null,
      currency: null,
      items: [item(ITEM_ID.toUpperCase(), PRODUCT_ID.toUpperCase())],
    });

    expect(parsed).toMatchObject({
      contact_id: CONTACT_ID,
      company_id: COMPANY_ID,
      items: [{ id: ITEM_ID, product_id: PRODUCT_ID }],
    });
  });

  it("canonicaliza IDs de edição, inclusive referências aninhadas", () => {
    const parsed = editOrderCommandSchema.parse({
      command: "edit_order",
      idempotency_key: "uuid-edit",
      order_id: ORDER_ID.toUpperCase(),
      expected_revision: 1,
      contact_id: CONTACT_ID.toUpperCase(),
      company_id: COMPANY_ID.toUpperCase(),
      items: [item(ITEM_ID.toUpperCase(), PRODUCT_ID.toUpperCase())],
    });

    expect(parsed).toMatchObject({
      order_id: ORDER_ID,
      contact_id: CONTACT_ID,
      company_id: COMPANY_ID,
      items: [{ id: ITEM_ID, product_id: PRODUCT_ID }],
    });
  });

  it("canonicaliza order_id de confirmação", () => {
    expect(
      confirmOrderCommandSchema.parse({
        command: "confirm_order",
        idempotency_key: "uuid-confirm",
        order_id: ORDER_ID.toUpperCase(),
        expected_revision: 1,
      }).order_id,
    ).toBe(ORDER_ID);
  });

  it("canonicaliza order_id de avanço", () => {
    expect(
      advanceOrderCommandSchema.parse({
        command: "advance_order",
        idempotency_key: "uuid-advance",
        order_id: ORDER_ID.toUpperCase(),
        expected_revision: 1,
        next_status: "in_production",
      }).order_id,
    ).toBe(ORDER_ID);
  });

  it("canonicaliza order_id de cancelamento", () => {
    expect(
      cancelOrderCommandSchema.parse({
        command: "cancel_order",
        idempotency_key: "uuid-cancel",
        order_id: ORDER_ID.toUpperCase(),
        expected_revision: 1,
      }).order_id,
    ).toBe(ORDER_ID);
  });

  it("faz item lower e upper convergirem ao mesmo ID canônico", () => {
    const parsed = createDraftCommandSchema.parse({
      command: "create_draft",
      idempotency_key: "uuid-duplicate",
      contact_id: CONTACT_ID,
      company_id: null,
      company_name: null,
      channel: null,
      delivery_date: null,
      currency: null,
      items: [item(ITEM_ID), { ...item(ITEM_ID.toUpperCase()), position: 2 }],
    });

    expect(parsed.items.map(({ id }) => id)).toEqual([ITEM_ID, ITEM_ID]);
    expect(new Set(parsed.items.map(({ id }) => id)).size).toBe(1);
  });

  it("rejeita UUID malformado nas referências do comando", () => {
    const base = {
      command: "create_draft" as const,
      idempotency_key: "uuid-invalid",
      contact_id: CONTACT_ID,
      company_id: COMPANY_ID,
      company_name: null,
      channel: null,
      delivery_date: null,
      currency: null,
      items: [item(ITEM_ID, PRODUCT_ID)],
    };

    expect(createDraftCommandSchema.safeParse({ ...base, contact_id: "invalid" }).success).toBe(
      false,
    );
    expect(createDraftCommandSchema.safeParse({ ...base, company_id: "invalid" }).success).toBe(
      false,
    );
    expect(
      createDraftCommandSchema.safeParse({ ...base, items: [item("invalid", PRODUCT_ID)] }).success,
    ).toBe(false);
    expect(
      createDraftCommandSchema.safeParse({ ...base, items: [item(ITEM_ID, "invalid")] }).success,
    ).toBe(false);
  });
});
