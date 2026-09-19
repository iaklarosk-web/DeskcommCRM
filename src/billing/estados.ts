/**
 * Estados e transições da ASSINATURA (F12, ADR-030 §3; D38, D44).
 *
 * Tabela única: quem move é o evento, e o que ele produz está escrito aqui —
 * não em `if`s espalhados. O CHECK `subscriptions_status_check` (9023) é o
 * espelho deste vocabulário no banco; o teste de schema confere um contra o
 * outro. Estado e evento são ENUM, nunca frase (G-78).
 *
 * | De                         | Evento              | Para              |
 * |----------------------------|---------------------|-------------------|
 * | pending_payment            | payment_confirmed   | active            |
 * | active                     | payment_confirmed   | active (renova)   |
 * | active                     | payment_failed      | past_due (aviso)  |
 * | past_due                   | payment_confirmed   | active            |
 * | past_due                   | grace_expired (job) | blocked           |
 * | blocked                    | payment_confirmed   | active            |
 * | active, past_due, blocked  | cancelled (humano)  | cancelled         |
 * | cancelled                  | checkout            | pending_payment   |
 * | active, past_due           | admin_suspended     | blocked (F19)     |
 * | blocked                    | admin_resumed       | active (F19)      |
 *
 * F19 (ADR-042 §5, padrão KN do /admin): o dono da plataforma SUSPENDE uma
 * assinatura (acesso read_only, dados preservados — o mesmo desfecho da
 * carência vencida) e REATIVA; no Stripe isso vira `pause_collection`.
 *
 * Tudo o mais é `null`: transição ilegal é ERRO contado, não estado inventado
 * (§5.5 invariante 2, aplicado à assinatura).
 */

export const ESTADOS_DA_ASSINATURA = [
  "pending_payment",
  "active",
  "past_due",
  "blocked",
  "cancelled",
] as const;
export type EstadoDaAssinatura = (typeof ESTADOS_DA_ASSINATURA)[number];

export const EVENTOS_DA_ASSINATURA = [
  "payment_confirmed",
  "payment_failed",
  "grace_expired",
  "cancelled",
  "checkout",
  "admin_suspended",
  "admin_resumed",
] as const;
export type EventoDaAssinatura = (typeof EVENTOS_DA_ASSINATURA)[number];

/** Origem da assinatura — quem a criou. Espelho de `subscriptions_origin_check`. */
export const ORIGENS_DA_ASSINATURA = ["self_service", "operator", "seed", "fixture", "backfill"] as const;
export type OrigemDaAssinatura = (typeof ORIGENS_DA_ASSINATURA)[number];

/**
 * Os tipos de evento que o gateway entrega — espelho de
 * `billing_events_event_type_check` (9023 + 9033). `cancelled` entrou na F19:
 * o Customer Portal do Stripe cancela e o gateway avisa
 * (`customer.subscription.deleted`); no mock continua sendo só ação humana.
 */
export const TIPOS_DE_EVENTO_DO_GATEWAY = ["payment_confirmed", "payment_failed", "cancelled"] as const;
export type TipoDeEventoDoGateway = (typeof TIPOS_DE_EVENTO_DO_GATEWAY)[number];

const TRANSICOES: ReadonlyArray<readonly [EstadoDaAssinatura, EventoDaAssinatura, EstadoDaAssinatura]> = [
  ["pending_payment", "payment_confirmed", "active"],
  ["active", "payment_confirmed", "active"],
  ["active", "payment_failed", "past_due"],
  ["past_due", "payment_confirmed", "active"],
  ["past_due", "grace_expired", "blocked"],
  ["blocked", "payment_confirmed", "active"],
  ["active", "cancelled", "cancelled"],
  ["past_due", "cancelled", "cancelled"],
  ["blocked", "cancelled", "cancelled"],
  ["cancelled", "checkout", "pending_payment"],
  ["active", "admin_suspended", "blocked"],
  ["past_due", "admin_suspended", "blocked"],
  ["blocked", "admin_resumed", "active"],
];

/** O estado seguinte, ou `null` quando a tabela não prevê a transição. */
export function transicao(de: EstadoDaAssinatura, evento: EventoDaAssinatura): EstadoDaAssinatura | null {
  const linha = TRANSICOES.find(([origem, ev]) => origem === de && ev === evento);
  return linha ? linha[2] : null;
}

export function ehEstadoDaAssinatura(valor: unknown): valor is EstadoDaAssinatura {
  return typeof valor === "string" && (ESTADOS_DA_ASSINATURA as readonly string[]).includes(valor);
}

export function ehTipoDeEventoDoGateway(valor: unknown): valor is TipoDeEventoDoGateway {
  return typeof valor === "string" && (TIPOS_DE_EVENTO_DO_GATEWAY as readonly string[]).includes(valor);
}

/**
 * O que cada estado PERMITE (ADR-030 §3 "Acesso"). É a única tradução de
 * estado para acesso: o layout, o guarda de rota e o entitlement leem daqui.
 *
 * - `full`: uso operacional normal (`active`; `past_due` continua — D44 avisa
 *   antes de bloquear).
 * - `read_only`: `blocked` — leitura e cobrança seguem; escrita nova é negada.
 * - `billing_only`: `pending_payment` e `cancelled` — só a tela/rotas de
 *   cobrança (a pessoa precisa pagar, ou reativar).
 */
export type ModoDeAcesso = "full" | "read_only" | "billing_only";

export const MODO_POR_ESTADO: Readonly<Record<EstadoDaAssinatura, ModoDeAcesso>> = {
  pending_payment: "billing_only",
  active: "full",
  past_due: "full",
  blocked: "read_only",
  cancelled: "billing_only",
};

/** Número de transições da tabela — o denominador da prova de `estados`. */
export const TOTAL_DE_TRANSICOES = TRANSICOES.length;
