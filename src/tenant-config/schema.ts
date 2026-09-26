/**
 * O schema de Settings da Fase 1 (DIRETRIZ §5.2, D21) — a lista ÚNICA.
 *
 * Uma entrada por chave: tipo, default e (quando enum/faixa) o vocabulário.
 * Chave fora desta lista é `UnknownSettingError` em qualquer caminho — não
 * existe "setting dinâmica". Nova chave = 1 entrada aqui (Mudar X da §5.2).
 *
 * `default: null` é um default de verdade ("ainda não configurado", que a UI
 * mostra vazio); o invariante 1 da §5.2 — toda chave tem default e validador —
 * vale para as 28. O validador não mora na entrada: ele é derivado do `tipo`
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
  | "reminder"
  /** F13-T01 (ADR-034): lista de definições de campo (`customFieldSchema`), ≤ 50, chaves únicas. */
  | "custom_fields"
  /** F15-T01 (ADR-036): `{<ação do catálogo>: allow|approve|block|transfer}`. */
  | "action_policy";

export interface SettingEntry {
  key: string;
  tipo: TipoDeSetting;
  default: unknown;
  /** Só para tipo = enum. */
  valores?: readonly string[];
  /** Só para tipo = int: faixa inclusiva. */
  min?: number;
  max?: number;
  /**
   * A chave pública antiga não possui mais linha escritora em tenant_settings.
   * `diagnostic_only` evita fingir que um caminho de Storage é uma URL.
   */
  canonical?: {
    destination:
      | "organizations.timezone"
      | "organizations.settings.branding.app_name"
      | "organizations.settings.branding.accent_hex"
      | "organizations.settings.branding.logo_path";
    read: "canonical_value" | "diagnostic_only";
  };
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
  {
    key: "branding.name",
    tipo: "string_nullable",
    default: null,
    canonical: {
      destination: "organizations.settings.branding.app_name",
      read: "canonical_value",
    },
  },
  {
    key: "branding.logo_url",
    tipo: "string_nullable",
    default: null,
    canonical: {
      destination: "organizations.settings.branding.logo_path",
      read: "diagnostic_only",
    },
  },
  {
    key: "branding.primary_color",
    tipo: "string_nullable",
    default: null,
    canonical: {
      destination: "organizations.settings.branding.accent_hex",
      read: "canonical_value",
    },
  },
  // business
  {
    key: "business.timezone",
    tipo: "string",
    default: "America/Sao_Paulo",
    canonical: { destination: "organizations.timezone", read: "canonical_value" },
  },
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
  // F15-T02 (ADR-036 §2, D54 c): teto diário de turnos por organização; 0 =
  // sem teto (declarado, nunca fato). Contado em `ai_usage_events` (chat).
  { key: "ai.limits.daily_turns", tipo: "int", default: 0, min: 0, max: 100_000 },
  // actions (§5.8)
  { key: "actions.confirm_from_risk", tipo: "enum", default: "medium", valores: ["low", "medium", "high"] },
  // F15-T01 (ADR-036 §4, D54 b): política por ação para executores não
  // humanos. Nasce VAZIA — o modo efetivo de cada ação sem entrada é o que
  // D33 já decide; a organização sobrescreve pela tela.
  { key: "actions.policy", tipo: "action_policy", default: {} },
  // conversation
  { key: "conversation.confirmation_timeout_minutes", tipo: "int", default: 60, min: 1, max: 10_080 },
  { key: "conversation.auto_resolve_hours", tipo: "int", default: 48, min: 1, max: 720 },
  // handoff (§5.11): `round_robin` desde a F15-T03 (ADR-036, D54 d) — o dossiê
  // nasce entregue a um membro da fila; `queue` (default) continua a corrida.
  { key: "handoff.assignment", tipo: "enum", default: "queue", valores: ["queue", "round_robin"] },
  { key: "handoff.queue_roles", tipo: "string_array", default: ["attendant"] },
  // notifications
  { key: "notifications.email.enabled", tipo: "boolean", default: false },
  { key: "notifications.email.to", tipo: "string_nullable", default: null },
  // orders (D23)
  { key: "orders.recurring_reminder", tipo: "reminder", default: REMINDER_DEFAULT },
  // crm (F13, ADR-034 §2): campos configuráveis por ORGANIZAÇÃO (a definição
  // por funil continua em `crm_pipelines.settings.fields` para a oportunidade)
  // e a fila de oportunidades. Nenhum campo nasce definido; a distribuição
  // nasce manual — a organização escolhe o rodízio (§5 da ADR: defaults
  // declarados, nunca fato).
  { key: "crm.fields.contacts", tipo: "custom_fields", default: [] },
  { key: "crm.fields.companies", tipo: "custom_fields", default: [] },
  { key: "crm.distribution", tipo: "enum", default: "manual", valores: ["manual", "round_robin"] },
  { key: "crm.queue_roles", tipo: "string_array", default: ["attendant"] },
  // webchat (F14, ADR-038 §5, D55 c): o chat do site só existe quando a
  // organização liga; `allowed_origins` vazio = qualquer origem pode embutir
  // (frame-ancestors), a organização restringe. Defaults declarados, nunca fato.
  // F18-T00 (ADR-040 §1, D56 c): QUEM atende o despacho de IA desta
  // organização. `saas` = o turno com política por ação, teto diário e
  // auditoria (o que o gate mede); `legacy` = o motor herdado (runAgentTurn),
  // que fica como volta atrás POR ORGANIZAÇÃO, sem deploy. Default declarado,
  // nunca fato — e o default aqui é o motor novo por decisão do proprietário.
  { key: "ai.engine", tipo: "enum", default: "saas", valores: ["saas", "legacy"] },
  { key: "webchat.enabled", tipo: "boolean", default: false },
  { key: "webchat.allowed_origins", tipo: "string_array", default: [] },
  // F24 (Suporte KN, 25/09/2026): o que o visitante lê quando a conversa
  // espera uma pessoa. `atendente` = a frase de sempre ("na fila para um
  // atendente"); `retorno` = "Recebemos sua pergunta. {empresa} responde por
  // {contato} em até {prazo}" — o contato é o que ele informou na
  // identificação, o prazo é `return_deadline_text`. Padrão declarado = o
  // comportamento antigo (o primeiro piloto não muda); "1 dia útil" é a decisão do
  // fundador para o suporte da KN, e a organização troca pela tela.
  { key: "webchat.handoff_mode", tipo: "enum", default: "atendente", valores: ["atendente", "retorno"] },
  { key: "webchat.return_deadline_text", tipo: "string", default: "1 dia útil" },
] as const;

const POR_CHAVE = new Map(SETTINGS_SCHEMA.map((e) => [e.key, e]));

export function entradaDoSchema(key: string): SettingEntry | undefined {
  return POR_CHAVE.get(key);
}
