/**
 * Os dois mapas entre o vocabulário D16 (§5.6) e o `status` herdado de
 * `conversations` — a "tradução documentada" que a ADR-016 exige para que não
 * exista uma segunda máquina de estados.
 *
 * Os dois são TOTAIS: nenhuma chave falta de um lado nem do outro, e o teste
 * de F03-T01 conta as chaves em vez de confiar na leitura. O que se perde na
 * ida e volta é finito e está declarado em `COARSENINGS` — engrossamento fora
 * dessa lista é defeito, não decisão.
 *
 * O espelho SQL do `LEGACY_TO_D16` é `public.fn_saas_state_from_legacy`
 * (migration 20260910093000_9013). Mudar um mapa exige mudar os dois, com a
 * prova no mesmo commit.
 */
import { CONVERSATION_STATES, type ConversationState } from "./transitions";

/**
 * Os sete valores do CHECK herdado `conversations_status_check`
 * (`supabase/baseline.sql:1394`), na ordem em que o CHECK os lista.
 */
export const LEGACY_STATUSES = [
  "open",
  "pending",
  "resolved",
  "claimed",
  "ai_handling",
  "closed",
  "archived",
] as const;

export type LegacyStatus = (typeof LEGACY_STATUSES)[number];

/** Projeção de escritor legado: `status` -> estado D16. Usado pelo gatilho. */
export const LEGACY_TO_D16: Record<LegacyStatus, ConversationState> = {
  open: "open",
  pending: "waiting_human",
  resolved: "resolved",
  claimed: "human_handling",
  ai_handling: "ai_handling",
  closed: "resolved",
  archived: "archived",
};

/**
 * Estado D16 -> `status` legado. Usado por `transition()` ao delegar o lado
 * legado do movimento a `fn_service_status`, para que revisão, demanda e
 * assignee continuem sob a autoridade herdada.
 */
export const D16_TO_LEGACY: Record<ConversationState, LegacyStatus> = {
  open: "open",
  ai_handling: "ai_handling",
  waiting_customer: "ai_handling",
  waiting_confirmation: "pending",
  waiting_human: "pending",
  human_handling: "claimed",
  // `closed` e NÃO `resolved`, embora o nome coincida. O vocabulário legado tem
  // os dois, e o produto só conta UM como encerrado:
  // `CONVERSATION_TERMINAL_STATUSES` é `["closed","archived"]`
  // (`lib/schemas/messaging.ts:195`), e o comentário de lá diz que `resolved` é
  // legado "se um dia passar a valer". Mapear D16 `resolved` para o legado
  // `resolved` foi medido: a conversa resolvida pelo inbox sumia da aba
  // "Fechadas", continuava no `exclude_finished` e escapava do varredor de
  // silêncio. Resolver pelo D16 tem de encerrar de verdade.
  resolved: "closed",
  archived: "archived",
};

/**
 * Um par de engrossamento: `from` não sobrevive à ida e volta e desemboca em
 * `to`. Os três são os declarados na ADR-016, decisão 4.
 */
export interface Coarsening {
  readonly from: ConversationState | LegacyStatus;
  readonly to: ConversationState | LegacyStatus;
}

export const COARSENINGS: readonly Coarsening[] = [
  // Dois estados D16 sem portador legado próprio: o ciclo herdado não separa
  // "a IA está redigindo" de "a IA já respondeu e espera o cliente".
  { from: "waiting_customer", to: "ai_handling" },
  { from: "waiting_confirmation", to: "waiting_human" },
  // Dois valores legados de vocabulários diferentes para o mesmo desfecho: os
  // dois projetam para D16 `resolved`, e a volta escolhe o que o produto conta
  // como encerrado. Quem não sobrevive à ida e volta é o legado `resolved`.
  { from: "resolved", to: "closed" },
];

/** `true` quando o par perdido na ida e volta está declarado. */
export function isDeclaredCoarsening(from: string, to: string): boolean {
  return COARSENINGS.some((par) => par.from === from && par.to === to);
}

/** Guarda de digitação: `status` cru do banco é legado conhecido? */
export function isLegacyStatus(value: string): value is LegacyStatus {
  return (LEGACY_STATUSES as readonly string[]).includes(value);
}

/** Guarda de digitação: `saas_state` cru do banco é estado D16 conhecido? */
export function isConversationState(value: string): value is ConversationState {
  return (CONVERSATION_STATES as readonly string[]).includes(value);
}
