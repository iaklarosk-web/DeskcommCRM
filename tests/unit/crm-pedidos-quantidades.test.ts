import { describe, expect, it } from "vitest";
import {
  assertMatchingSaleUnit,
  lineTotalCents,
  parseBrazilianQuantity,
  quantityToMilli,
  sumTotalCents,
} from "@/src/crm/orders/quantities";

describe("quantidades de pedido — interpretação explícita PT-BR", () => {
  it.each([
    ["0,5", "0.500", null],
    ["1.000", "1000.000", null],
    ["12 un", "12.000", "un"],
    ["2 cx", "2.000", "cx"],
    [" 1.234.567,890 KG ", "1234567.890", "kg"],
    ["0002,005", "2.005", null],
    ["0,001 l", "0.001", "l"],
  ])("interpreta %s sem adivinhar conversão", (input, quantity, unit) => {
    expect(parseBrazilianQuantity(input!)).toEqual({ quantity, requested_unit: unit });
  });

  it.each([
    "",
    "-2",
    "0",
    "1e3",
    "1.5",
    "1,0000",
    "1.00.000",
    "1,2,3",
    "1.000.000.000",
    "2 cx de 12",
    "12abc",
  ])("rejeita entrada inválida/ambígua %s", (input) =>
    expect(() => parseBrazilianQuantity(input)).toThrow(),
  );

  it("diferencia o formato de transporte do formato humano", () => {
    expect(quantityToMilli("1.000")).toBe(1000n);
    expect(quantityToMilli(parseBrazilianQuantity("1.000").quantity)).toBe(1_000_000n);
    expect(() => quantityToMilli("1,5")).toThrow("invalid_quantity");
    expect(() => quantityToMilli("1.0000")).toThrow("invalid_quantity");
  });

  it("mantém duas caixas como duas e exige configuração para outra unidade", () => {
    const parsed = parseBrazilianQuantity("2 cx");
    expect(parsed.quantity).toBe("2.000");
    expect(() => assertMatchingSaleUnit(parsed.requested_unit, "un")).toThrow(
      "unit_conversion_required",
    );
    expect(() => assertMatchingSaleUnit("kg", "g")).toThrow("unit_conversion_required");
    expect(() => assertMatchingSaleUnit("cx", "cx")).not.toThrow();
    expect(() => assertMatchingSaleUnit("cx", "CX")).not.toThrow();
    expect(() => assertMatchingSaleUnit(null, "cx")).not.toThrow();
  });
});

describe("centavos exatos do pedido", () => {
  it("calcula frações representáveis e valores altos sem erro binário", () => {
    expect(lineTotalCents("0.100", 30)).toBe(3);
    expect(lineTotalCents("2.500", 1990)).toBe(4975);
    expect(lineTotalCents("999999999.999", 0)).toBe(0);
    expect(lineTotalCents("1", 2_147_483_647)).toBe(2_147_483_647);
  });

  it("não escolhe arredondamento para meio centavo", () => {
    expect(() => lineTotalCents("0.5", 101)).toThrow("rounding_rule_required");
    expect(() => lineTotalCents("0.001", 1)).toThrow("rounding_rule_required");
  });

  it("rejeita preços inválidos, quantidades zero e excesso de capacidade", () => {
    for (const price of [-1, 0.5, NaN, Infinity, 2_147_483_648, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => lineTotalCents("1", price)).toThrow("invalid_price");
    }
    expect(() => lineTotalCents("0", 100)).toThrow("quantity_out_of_range");
    expect(() => lineTotalCents("2", 2_147_483_647)).toThrow("total_out_of_range");
  });

  it("soma todos os itens e não limita o total a uma página ou a int32 com overflow", () => {
    expect(sumTotalCents(Array.from({ length: 257 }, () => 199))).toBe(51143);
    expect(sumTotalCents([])).toBe(0);
    expect(() => sumTotalCents([2_147_483_647, 1])).toThrow("total_out_of_range");
    expect(() => sumTotalCents([10, -1])).toThrow("invalid_price");
  });
});
