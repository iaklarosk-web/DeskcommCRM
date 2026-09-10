import { describe, expect, it } from "vitest";

import {
  cnpjSchema,
  companyCreateSchema,
  companyPatchSchema,
} from "../../src/crm/companies/schema";
import { contactCommercialFieldsSchema, saleUnitSchema } from "../../src/crm/commercial_fields";

describe("contratos comerciais F02-T01", () => {
  it("normaliza CNPJ numérico mascarado sem rejeitar o formato alfanumérico vigente", () => {
    expect(cnpjSchema.parse("12.345.678/0001-95")).toBe("12345678000195");
    expect(cnpjSchema.parse("ab.cde.fgh/ijkl-12")).toBe("ABCDEFGHIJKL12");
    expect(cnpjSchema.safeParse("ABCDEFGHIJKLMN").success).toBe(false);
  });

  it("mantém empresa e vínculo opcionais sem inventar classificação", () => {
    expect(
      companyCreateSchema.parse({
        legal_name: " Empresa Exemplo Ltda ",
        trade_name: null,
        cnpj: null,
      }),
    ).toEqual({ legal_name: "Empresa Exemplo Ltda", trade_name: null, cnpj: null });
    expect(companyPatchSchema.parse({ trade_name: " Exemplo " })).toEqual({
      trade_name: "Exemplo",
    });
    expect(companyPatchSchema.safeParse({ recurring: true }).success).toBe(false);
    expect(contactCommercialFieldsSchema.parse({ company_id: null, recurring: false })).toEqual({
      company_id: null,
      recurring: false,
    });
  });

  it("aceita unidade configurável curta e preserva ausência como null", () => {
    expect(saleUnitSchema.parse(" caixa ")).toBe("caixa");
    expect(saleUnitSchema.parse(null)).toBeNull();
    expect(saleUnitSchema.safeParse("").success).toBe(false);
    expect(saleUnitSchema.safeParse("x".repeat(33)).success).toBe(false);
  });
});
