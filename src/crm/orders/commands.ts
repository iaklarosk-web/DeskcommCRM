import { z } from "zod";

import { canonicalQuantity, quantityToMilli } from "./quantities";

const idempotencyKeySchema = z.string().trim().min(1).max(200);
const expectedRevisionSchema = z.number().int().min(1);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const saleUnitSchema = z.string().trim().min(1).max(32);
const centsSchema = z.number().int().min(0).max(2_147_483_647);
const uuidSchema = z.uuid().transform((id) => id.toLowerCase());

export const canonicalOrderQuantitySchema = z.string().transform((value, ctx) => {
  try {
    return canonicalQuantity(quantityToMilli(value));
  } catch {
    ctx.addIssue({ code: "custom", message: "quantidade inválida" });
    return z.NEVER;
  }
});

export const orderItemCommandSchema = z.strictObject({
  id: uuidSchema,
  position: z.number().int().min(1),
  requested_text: z.string().trim().min(1).max(1000),
  product_id: uuidSchema.nullable(),
  product_name: z.string().trim().min(1).max(200).nullable(),
  sale_unit: saleUnitSchema.nullable(),
  quantity: canonicalOrderQuantitySchema.nullable(),
  unit_price_cents: centsSchema.nullable(),
  currency: currencySchema.nullable(),
});

const editableOrderFields = {
  contact_id: uuidSchema,
  company_id: uuidSchema.nullable(),
  company_name: z.string().trim().min(1).max(200).nullable(),
  channel: z.string().trim().min(1).max(64).nullable(),
  delivery_date: z.iso.date().nullable(),
  currency: currencySchema.nullable(),
  items: z.array(orderItemCommandSchema).max(200),
} as const;

export const createDraftCommandSchema = z.strictObject({
  command: z.literal("create_draft"),
  idempotency_key: idempotencyKeySchema,
  ...editableOrderFields,
});

export const editOrderCommandSchema = z
  .strictObject({
    command: z.literal("edit_order"),
    idempotency_key: idempotencyKeySchema,
    order_id: uuidSchema,
    expected_revision: expectedRevisionSchema,
    contact_id: editableOrderFields.contact_id.optional(),
    company_id: editableOrderFields.company_id.optional(),
    company_name: editableOrderFields.company_name.optional(),
    channel: editableOrderFields.channel.optional(),
    delivery_date: editableOrderFields.delivery_date.optional(),
    currency: editableOrderFields.currency.optional(),
    items: editableOrderFields.items.optional(),
  })
  .refine(
    ({
      command: _command,
      idempotency_key: _key,
      order_id: _order,
      expected_revision: _rev,
      ...changes
    }) => Object.keys(changes).length > 0,
    { message: "edição sem alterações" },
  );

export const confirmOrderCommandSchema = z.strictObject({
  command: z.literal("confirm_order"),
  idempotency_key: idempotencyKeySchema,
  order_id: uuidSchema,
  expected_revision: expectedRevisionSchema,
});

export const advanceOrderCommandSchema = z.strictObject({
  command: z.literal("advance_order"),
  idempotency_key: idempotencyKeySchema,
  order_id: uuidSchema,
  expected_revision: expectedRevisionSchema,
  next_status: z.enum(["in_production", "delivered"]),
});

export const cancelOrderCommandSchema = z.strictObject({
  command: z.literal("cancel_order"),
  idempotency_key: idempotencyKeySchema,
  order_id: uuidSchema,
  expected_revision: expectedRevisionSchema,
  reason: z.string().trim().min(1).max(500).nullable().optional(),
});

export const orderCommandSchema = z.union([
  createDraftCommandSchema,
  editOrderCommandSchema,
  confirmOrderCommandSchema,
  advanceOrderCommandSchema,
  cancelOrderCommandSchema,
]);

export type OrderItemCommand = z.infer<typeof orderItemCommandSchema>;
export type CreateDraftCommand = z.infer<typeof createDraftCommandSchema>;
export type EditOrderCommand = z.infer<typeof editOrderCommandSchema>;
export type ConfirmOrderCommand = z.infer<typeof confirmOrderCommandSchema>;
export type AdvanceOrderCommand = z.infer<typeof advanceOrderCommandSchema>;
export type CancelOrderCommand = z.infer<typeof cancelOrderCommandSchema>;
export type OrderCommand = z.infer<typeof orderCommandSchema>;
