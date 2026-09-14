/**
 * Validadores por TIPO de Setting (§5.2). Devolvem null quando o valor serve e
 * uma frase de gente quando não serve — a frase vai para o erro da UI e para o
 * relatório do validateSeed, então ela diz O QUE se esperava, não só "inválido".
 */
import { REMINDER_DEFAULT, type SettingEntry } from "./schema";

const REMINDER_PERIODS = ["weekly"] as const;

function eInteiro(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

export function validar(entry: SettingEntry, value: unknown): string | null {
  switch (entry.tipo) {
    case "string":
      return typeof value === "string" && value !== ""
        ? null
        : `esperava texto não vazio`;
    case "string_nullable":
      return value === null || typeof value === "string" ? null : `esperava texto ou null`;
    case "boolean":
      return typeof value === "boolean" ? null : `esperava true/false`;
    case "int": {
      if (!eInteiro(value)) return `esperava número inteiro`;
      const min = entry.min ?? Number.MIN_SAFE_INTEGER;
      const max = entry.max ?? Number.MAX_SAFE_INTEGER;
      return value >= min && value <= max ? null : `esperava inteiro entre ${min} e ${max}`;
    }
    case "number01":
      return typeof value === "number" && value >= 0 && value <= 1
        ? null
        : `esperava número entre 0 e 1`;
    case "int_array": {
      if (!Array.isArray(value)) return `esperava lista de inteiros`;
      const min = entry.min ?? Number.MIN_SAFE_INTEGER;
      const max = entry.max ?? Number.MAX_SAFE_INTEGER;
      return value.every((v) => eInteiro(v) && v >= min && v <= max)
        ? null
        : `esperava lista de inteiros entre ${min} e ${max}`;
    }
    case "string_array":
      return Array.isArray(value) && value.every((v) => typeof v === "string")
        ? null
        : `esperava lista de textos`;
    case "enum":
      return typeof value === "string" && (entry.valores ?? []).includes(value)
        ? null
        : `esperava um de: ${(entry.valores ?? []).join(", ")}`;
    case "reminder":
      return validarReminder(value);
  }
}

/** orders.recurring_reminder (D23): objeto com os 6 campos, faixas da §5.2. */
function validarReminder(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return `esperava objeto {enabled, weekday, hour, cutoff_hours, message_template, period}`;
  }
  const v = value as Record<string, unknown>;
  const desconhecidos = Object.keys(v).filter((k) => !(k in REMINDER_DEFAULT));
  if (desconhecidos.length > 0) return `campos desconhecidos: ${desconhecidos.join(", ")}`;
  if (v["enabled"] !== undefined && typeof v["enabled"] !== "boolean") return `enabled: esperava true/false`;
  if (v["weekday"] !== undefined && !(eInteiro(v["weekday"]) && v["weekday"] >= 0 && v["weekday"] <= 6)) {
    return `weekday: esperava inteiro entre 0 e 6`;
  }
  if (v["hour"] !== undefined && !(eInteiro(v["hour"]) && v["hour"] >= 0 && v["hour"] <= 23)) {
    return `hour: esperava inteiro entre 0 e 23`;
  }
  if (v["cutoff_hours"] !== undefined && !(eInteiro(v["cutoff_hours"]) && v["cutoff_hours"] >= 1)) {
    return `cutoff_hours: esperava inteiro >= 1`;
  }
  if (v["message_template"] !== undefined && (typeof v["message_template"] !== "string" || v["message_template"] === "")) {
    return `message_template: esperava texto não vazio`;
  }
  if (v["period"] !== undefined && !REMINDER_PERIODS.includes(v["period"] as never)) {
    return `period: esperava um de: ${REMINDER_PERIODS.join(", ")}`;
  }
  return null;
}
