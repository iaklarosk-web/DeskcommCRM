/**
 * Quantidade de venda, distinta do estoque inteiro herdado do catálogo.
 * A precisão é um limite técnico (numeric(12,3)), não permissão de fracionar.
 * Regra comercial e conversão de embalagem precisam de configuração explícita.
 */
export class OrderQuantityError extends Error {
  constructor(
    public readonly code:
      | "invalid_quantity"
      | "quantity_out_of_range"
      | "unit_conversion_required"
      | "invalid_price"
      | "rounding_rule_required"
      | "total_out_of_range",
  ) {
    super(code);
    this.name = "OrderQuantityError";
  }
}

const SCALE = 1_000n;
const MAX_QUANTITY = 999_999_999_999n;
const MAX_CENTS = 2_147_483_647n;

/** Formato de transporte: ponto decimal, sem agrupamento nem unidade. */
export function quantityToMilli(quantity: string): bigint {
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(quantity)) {
    throw new OrderQuantityError("invalid_quantity");
  }
  const [whole = "", fraction = ""] = quantity.split(".");
  const milli = BigInt(whole) * SCALE + BigInt(fraction.padEnd(3, "0"));
  if (milli <= 0n || milli > MAX_QUANTITY) {
    throw new OrderQuantityError("quantity_out_of_range");
  }
  return milli;
}

export function canonicalQuantity(milli: bigint): string {
  return `${milli / SCALE}.${(milli % SCALE).toString().padStart(3, "0")}`;
}

/**
 * Entrada humana PT-BR: vírgula decimal e ponto de milhar. `1.000` é mil.
 * `2 cx` permanece duas caixas: o parser não conhece nem inventa seu conteúdo.
 */
export function parseBrazilianQuantity(input: string): {
  quantity: string;
  requested_unit: string | null;
} {
  if (input.length > 100) throw new OrderQuantityError("invalid_quantity");
  const match =
    /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,3}))?(?:\s+([\p{L}][\p{L}\p{N}_/-]{0,31}))?$/u.exec(
      input.trim(),
    );
  if (!match) throw new OrderQuantityError("invalid_quantity");
  const integer = (match[1] ?? "").replaceAll(".", "").replace(/^0+(?=\d)/, "");
  const milli = quantityToMilli(`${integer}.${match[2] ?? "0"}`);
  return {
    quantity: canonicalQuantity(milli),
    requested_unit: match[3]?.toLocaleLowerCase("pt-BR") ?? null,
  };
}

/** Nenhuma equivalência implícita entre caixa/unidade, kg/g ou l/ml. */
export function assertMatchingSaleUnit(requested: string | null, configured: string): void {
  if (
    requested !== null &&
    requested.trim().toLocaleLowerCase("pt-BR") !== configured.trim().toLocaleLowerCase("pt-BR")
  ) {
    throw new OrderQuantityError("unit_conversion_required");
  }
}

/** Centavos × milésimos de quantidade, sem ponto flutuante nem arredondamento. */
export function lineTotalCents(quantity: string, unit_price_cents: number): number {
  if (
    !Number.isSafeInteger(unit_price_cents) ||
    unit_price_cents < 0 ||
    unit_price_cents > Number(MAX_CENTS)
  ) {
    throw new OrderQuantityError("invalid_price");
  }
  const numerator = quantityToMilli(quantity) * BigInt(unit_price_cents);
  if (numerator % SCALE !== 0n) {
    throw new OrderQuantityError("rounding_rule_required");
  }
  const cents = numerator / SCALE;
  if (cents > MAX_CENTS) throw new OrderQuantityError("total_out_of_range");
  return Number(cents);
}

export function sumTotalCents(lines: readonly number[]): number {
  let total = 0n;
  for (const cents of lines) {
    if (!Number.isSafeInteger(cents) || cents < 0) {
      throw new OrderQuantityError("invalid_price");
    }
    total += BigInt(cents);
  }
  if (total > MAX_CENTS) throw new OrderQuantityError("total_out_of_range");
  return Number(total);
}
