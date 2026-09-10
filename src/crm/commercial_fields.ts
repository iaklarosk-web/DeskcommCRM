import { z } from "zod";

export const contactCommercialFieldsSchema = z.strictObject({
  company_id: z.uuid().nullable(),
  recurring: z.boolean(),
});

export const saleUnitSchema = z.string().trim().min(1).max(32).nullable();

export type ContactCommercialFields = z.infer<typeof contactCommercialFieldsSchema>;
export type SaleUnit = z.infer<typeof saleUnitSchema>;
