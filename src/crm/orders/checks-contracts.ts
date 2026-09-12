import { z } from "zod";

import { canonicalOrderQuantitySchema } from "./commands";
import { canonicalQuantity } from "./quantities";

const uuidSchema = z.uuid().transform((id) => id.toLowerCase());

export const checkedQuantitySchema = z.union([
  z
    .string()
    .regex(/^0(?:\.0{1,3})?$/)
    .transform(() => canonicalQuantity(0n)),
  canonicalOrderQuantitySchema,
]);

export const orderCheckCommandSchema = z.strictObject({
  idempotency_key: uuidSchema,
  expected_revision: z.number().int().min(1),
  item_id: uuidSchema,
  checked_quantity: checkedQuantitySchema,
});
export type OrderCheckCommand = z.infer<typeof orderCheckCommandSchema>;

export const orderCheckListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before_sequence: z
    .string()
    .regex(/^[1-9]\d*$/)
    .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n)
    .optional(),
});

export const orderCheckStateSchema = z.enum([
  "pending",
  "partial",
  "checked",
]);
export type OrderCheckState = z.infer<typeof orderCheckStateSchema>;

const storedQuantitySchema = z
  .union([z.string(), z.number()])
  .transform(String)
  .pipe(checkedQuantitySchema);

export const orderCheckResultSchema = z.strictObject({
  event_id: uuidSchema,
  event_sequence: z.string().regex(/^[1-9]\d*$/),
  order_id: uuidSchema,
  order_revision: z.number().int().min(1),
  item_id: uuidSchema,
  ordered_quantity: storedQuantitySchema.nullable(),
  checked_quantity: storedQuantitySchema,
  sale_unit: z.string().min(1).max(32).nullable(),
  state: orderCheckStateSchema,
  checked_by_user_id: uuidSchema,
  checked_at: z.string().datetime({ offset: true }),
});
export type OrderCheckResult = z.infer<typeof orderCheckResultSchema>;

export const orderCheckCurrentItemSchema = z.strictObject({
  item_id: uuidSchema,
  ordered_quantity: storedQuantitySchema.nullable(),
  checked_quantity: storedQuantitySchema,
  sale_unit: z.string().min(1).max(32).nullable(),
  state: orderCheckStateSchema,
  event_id: uuidSchema.nullable(),
  event_sequence: z.string().regex(/^[1-9]\d*$/).nullable(),
  checked_by_user_id: uuidSchema.nullable(),
  checked_at: z.string().datetime({ offset: true }).nullable(),
});

export const orderChecksViewSchema = z.strictObject({
  order_id: uuidSchema,
  order_revision: z.number().int().min(1),
  items: z.array(orderCheckCurrentItemSchema),
  history: z.array(orderCheckResultSchema),
  next_before_sequence: z.string().regex(/^[1-9]\d*$/).nullable(),
});
export type OrderChecksView = z.infer<typeof orderChecksViewSchema>;
