import { assertMatchingSaleUnit, parseBrazilianQuantity } from "@/src/crm/orders/quantities";

export type Translate = (text: string) => string;
const identity: Translate = (text) => text;

export function statusLabel(status: string, t: Translate = identity): string {
  switch (status) {
    case "draft":
      return t("Rascunho");
    case "confirmed":
      return t("Confirmado");
    case "in_production":
      return t("Em produção");
    case "delivered":
      return t("Entregue");
    case "cancelled":
      return t("Cancelado");
    default:
      return t("A conferir");
  }
}

export function pendingLabel(code: string, t: Translate = identity): string {
  switch (code) {
    case "delivery_date_required":
      return t("Informe a data de entrega.");
    case "currency_required":
      return t("Escolha a moeda do pedido.");
    case "items_required":
      return t("Adicione ao menos um item.");
    case "product_required":
      return t("Vincule o item a um produto.");
    case "product_name_required":
      return t("Confira o nome do produto.");
    case "sale_unit_required":
      return t("Defina a unidade de venda.");
    case "quantity_required":
      return t("Confira a quantidade solicitada.");
    case "price_required":
      return t("Informe o preço unitário.");
    case "item_currency_required":
      return t("Informe a moeda do item.");
    case "currency_mismatch":
      return t("As moedas do item e do pedido precisam ser iguais.");
    case "product_inactive":
      return t("Escolha um produto ativo.");
    case "product_unavailable":
      return t("O produto não está mais disponível.");
    case "catalog_sale_unit_required":
      return t("Configure a unidade de venda no catálogo.");
    case "unit_conversion_required":
      return t("A unidade solicitada difere do catálogo. Confira sem converter automaticamente.");
    case "rounding_rule_required":
      return t(
        "O valor tem fração de centavo. Revise quantidade ou preço; a regra de arredondamento está pendente.",
      );
    case "total_out_of_range":
      return t("O valor supera o limite aceito pelo sistema.");
    default:
      return t("Confira os dados deste item.");
  }
}

export const quantityInput = (value: string | null) => value?.replace(".", ",") ?? "";
export const moneyInput = (cents: number | null) =>
  cents === null ? "" : `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;

export function parseMoneyInput(value: string): number | null {
  const match = /^(\d+)(?:,(\d{1,2}))?$/.exec(value.trim());
  if (!match || match[1] === undefined) return null;
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  return cents <= 2147483647n ? Number(cents) : null;
}

export function matchedQuantity(input: string, saleUnit: string | null): string | null {
  try {
    const parsed = parseBrazilianQuantity(input);
    if (parsed.requested_unit !== null) {
      if (saleUnit === null) return null;
      assertMatchingSaleUnit(parsed.requested_unit, saleUnit);
    }
    return parsed.quantity;
  } catch {
    return null;
  }
}

export function displayMoney(
  cents: number | null,
  currency: string | null,
  t: Translate = identity,
): string {
  return cents === null
    ? t("Valor pendente")
    : `${moneyInput(cents)} ${currency ?? t("(moeda pendente)")}`;
}

export function displayDateOnly(value: string | null, locale: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeZone: "UTC" }).format(date);
}
