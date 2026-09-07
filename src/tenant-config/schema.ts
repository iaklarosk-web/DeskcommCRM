/**
 * O schema de Settings da Fase 1 (DIRETRIZ §5.2, D21) — a lista ÚNICA.
 *
 * Uma entrada por chave: tipo, default e (quando enum/faixa) o vocabulário.
 * Chave fora desta lista é `UnknownSettingError` em qualquer caminho — não
 * existe "setting dinâmica". Nova chave = 1 entrada aqui (Mudar X da §5.2).
 *
 * `default: null` é um default de verdade ("ainda não configurado", que a UI
 * mostra vazio); o invariante 1 da §5.2 — toda chave tem default e validador —
 * vale para as 24. O validador não mora na entrada: ele é derivado do `tipo`
 * em validators.ts, para que um tipo novo ganhe validação num lugar só.
 */

export const SCHEMA_VERSION = 1;

export type TipoDeSetting =
  | "string"
  | "string_nullable"
  | "boolean"
  | "int"
  | "number01"
  | "int_array"
  | "string_array"
  | "enum"
  | "reminder";

export interface SettingEntry {
  key: string;
  tipo: TipoDeSetting;
  default: unknown;
  /** Só para tipo = enum. */
  valores?: readonly string[];
  /** Só para tipo = int: faixa inclusiva. */
  min?: number;
  max?: number;
}

/** O objeto de orders.recurring_reminder (D23) — campos e faixas em validators.ts. */
export const REMINDER_DEFAULT = {
  enabled: false,
  weekday: 4,
  hour: 15,
  cutoff_hours: 20,
  message_template:
    "Olá {{customer.name}}! Podemos repetir o pedido desta semana? Semana passada foi: {{last_order.summary}}",
  period: "weekly",
} as const;

export const SETTINGS_SCHEMA: readonly SettingEntry[] = [
  // branding (D28)
  { key: "branding.name", tipo: "string_nullable", default: null },
  { key: "branding.logo_url", tipo: "string_nullable", default: null },
  { key: "branding.primary_color", tipo: "string_nullable", default: null },
  // business
  { key: "business.timezone", tipo: "string", default: "America/Sao_Paulo" },
  { key: "business.phone", tipo: "string_nullable", default: null },
  { key: "business.address", tipo: "string_nullable", default: null },
  { key: "business.hours", tipo: "string_nullable", default: null },
  { key: "business.delivery_days", tipo: "int_array", default: [], min: 0, max: 6 },
  { key: "business.delivery_regions", tipo: "string_array", default: [] },
  { key: "business.cancellation_policy", tipo: "string_nullable", default: null },
  // ai
  { key: "ai.enabled", tipo: "boolean", default: true },
  { key: "ai.system_prompt", tipo: "string_nullable", default: null },
  { key: "ai.unknown_answer", tipo: "string_nullable", default: null },
  { key: "ai.confidence_threshold", tipo: "number01", default: 0.6 },
  { key: "ai.forbidden_topics", tipo: "string_array", default: [] },
  { key: "ai.context_budget_tokens", tipo: "int", default: 6000, min: 1, max: 1_000_000 },
  // actions (§5.8)
  { key: "actions.confirm_from_risk", tipo: "enum", default: "medium", valores: ["low", "medium", "high"] },
  // conversation
  { key: "conversation.confirmation_timeout_minutes", tipo: "int", default: 60, min: 1, max: 10_080 },
  { key: "conversation.auto_resolve_hours", tipo: "int", default: 48, min: 1, max: 720 },
  // handoff (§5.11; round_robin é Fase 2 — acrescentar o valor aqui QUANDO existir)
  { key: "handoff.assignment", tipo: "enum", default: "queue", valores: ["queue"] },
  { key: "handoff.queue_roles", tipo: "string_array", default: ["attendant"] },
  // notifications
  { key: "notifications.email.enabled", tipo: "boolean", default: false },
  { key: "notifications.email.to", tipo: "string_nullable", default: null },
  // orders (D23)
  { key: "orders.recurring_reminder", tipo: "reminder", default: REMINDER_DEFAULT },
] as const;

const POR_CHAVE = new Map(SETTINGS_SCHEMA.map((e) => [e.key, e]));

export function entradaDoSchema(key: string): SettingEntry | undefined {
  return POR_CHAVE.get(key);
}
