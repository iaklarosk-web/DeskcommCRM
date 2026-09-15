import { z } from "zod";

export const CNPJ_CANONICAL_PATTERN = /^[A-Z0-9]{12}[0-9]{2}$/;

/** Aceita a máscara de apresentação e devolve o contrato canônico do banco. */
export function normalizeCnpj(value: string): string {
  return value
    .toLocaleUpperCase("pt-BR")
    .replace(/[.\/-]/g, "")
    .replace(/\s/g, "");
}

export const cnpjSchema = z
  .string()
  .transform(normalizeCnpj)
  .pipe(z.string().regex(CNPJ_CANONICAL_PATTERN));

const legalNameSchema = z.string().trim().min(1).max(200);
const tradeNameSchema = z.string().trim().min(1).max(200);

/**
 * F13-T01 (ADR-034): o VALOR dos campos configuráveis da empresa (migration
 * 9026). A forma é objeto com teto de 32 KB — o mesmo contrato de
 * `contacts.custom_fields`; o CONTEÚDO é conferido contra as definições da
 * organização por `src/crm/campos/validar.ts`, na rota.
 */
const CUSTOM_FIELDS_MAX_BYTES = 32_768;
export const companyCustomFieldsSchema = z
  .record(z.string().min(1).max(80), z.unknown())
  .refine((value) => JSON.stringify(value).length <= CUSTOM_FIELDS_MAX_BYTES, {
    message: "Campos personalizados excedem o limite de 32 KB",
  });

export const companySchema = z.strictObject({
  id: z.uuid(),
  organization_id: z.uuid(),
  legal_name: legalNameSchema,
  trade_name: tradeNameSchema.nullable(),
  cnpj: cnpjSchema.nullable(),
  custom_fields: companyCustomFieldsSchema,
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

export const companyCreateSchema = z.strictObject({
  legal_name: legalNameSchema,
  trade_name: tradeNameSchema.nullable().optional(),
  cnpj: cnpjSchema.nullable().optional(),
  custom_fields: companyCustomFieldsSchema.optional(),
});

export const companyPatchSchema = companyCreateSchema.partial();

export type Company = z.infer<typeof companySchema>;
export type CompanyCreate = z.infer<typeof companyCreateSchema>;
export type CompanyPatch = z.infer<typeof companyPatchSchema>;
