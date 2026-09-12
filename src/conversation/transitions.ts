/**
 * Espelho literal da tabela de transições da DIRETRIZ 5.6 (D16) com os adendos
 * de D34. É a ÚNICA descrição da máquina de estados de conversa no código:
 * "estado ou evento novo = linhas nesta tabela" (5.6, "Mudar X").
 *
 * A tabela é dado, não código: a prova de F03-T01 conta os estados e os
 * eventos daqui em tempo de teste e enumera 8 x 16 = 128 pares. Escrever
 * qualquer um desses números à mão invalidaria a prova.
 *
 * A reconciliação com o ciclo herdado (coluna `saas_state`, projeção do
 * `status` legado, delegação às RPCs de fronteira) está na ADR-016.
 */

export const CONVERSATION_STATES = [
  "open",
  "ai_handling",
  "waiting_customer",
  "waiting_confirmation",
  "waiting_human",
  "human_handling",
  "resolved",
  "archived",
] as const;

export type ConversationState = (typeof CONVERSATION_STATES)[number];

/** Quem move a conversa. `system` cobre webhook e gatilho; `job` cobre cron. */
export type TransitionActor = "system" | "ai" | "attendant" | "job" | "automation";

/**
 * Guardas nomeadas. A tabela guarda o NOME; quem avalia é `transition()`, que
 * recebe as respostas prontas — a tabela nunca importa banco nem configuração.
 */
export type TransitionGuard =
  | "ai_available"
  | "ai_enabled"
  | "action_requires_confirmation"
  | "pending_action_executed"
  | "confirmation_timeout_elapsed"
  | "auto_resolve_elapsed"
  | "archive_window_elapsed";

/**
 * Efeitos que a tabela declara e `transition()` executa. Existem porque D16/D34
 * descrevem movimentos que não são só "trocar o estado".
 */
export type TransitionEffect =
  | "append_message"
  | "new_conversation"
  | "notify_customer_replied_while_human"
  | "create_handoff"
  | "assign_to_actor"
  | "assign_to_target"
  | "clear_assignee"
  | "create_conversation_if_absent";

export type TransitionRow = {
  readonly from: ConversationState;
  readonly event: string;
  readonly to: ConversationState;
  /** Destino quando a guarda é falsa. Ausente = guarda falsa rejeita o evento. */
  readonly toWhenGuardFails?: ConversationState;
  readonly actor: readonly TransitionActor[];
  readonly guard?: TransitionGuard;
  readonly effects?: readonly TransitionEffect[];
};

/**
 * Uma linha por par (estado, evento) legal. A ordem segue a tabela de 5.6 para
 * que a comparação com o documento seja linha a linha.
 */
export const TRANSITIONS: readonly TransitionRow[] = [
  // inbound.message — legal a partir dos oito estados (5.6, seis linhas).
  { from: "open", event: "inbound.message", to: "ai_handling", toWhenGuardFails: "waiting_human",
    actor: ["system"], guard: "ai_available", effects: ["append_message"] },
  { from: "waiting_customer", event: "inbound.message", to: "ai_handling", toWhenGuardFails: "waiting_human",
    actor: ["system"], guard: "ai_available", effects: ["append_message"] },
  { from: "ai_handling", event: "inbound.message", to: "ai_handling",
    actor: ["system"], effects: ["append_message"] },
  { from: "waiting_confirmation", event: "inbound.message", to: "waiting_confirmation",
    actor: ["system"], effects: ["append_message"] },
  { from: "waiting_human", event: "inbound.message", to: "waiting_human",
    actor: ["system"], effects: ["append_message", "notify_customer_replied_while_human"] },
  { from: "human_handling", event: "inbound.message", to: "human_handling",
    actor: ["system"], effects: ["append_message", "notify_customer_replied_while_human"] },
  { from: "resolved", event: "inbound.message", to: "ai_handling", toWhenGuardFails: "waiting_human",
    actor: ["system"], guard: "ai_available", effects: ["append_message"] },
  { from: "archived", event: "inbound.message", to: "archived",
    actor: ["system"], effects: ["new_conversation"] },

  // IA
  { from: "ai_handling", event: "ai.reply_sent", to: "waiting_customer", actor: ["ai"] },
  { from: "ai_handling", event: "ai.confirmation_requested", to: "waiting_confirmation",
    actor: ["ai"], guard: "action_requires_confirmation" },

  // Confirmação
  { from: "waiting_confirmation", event: "confirmation.approved", to: "ai_handling",
    actor: ["attendant"], guard: "pending_action_executed" },
  { from: "waiting_confirmation", event: "confirmation.rejected", to: "human_handling",
    actor: ["attendant"], effects: ["assign_to_actor"] },
  { from: "waiting_confirmation", event: "confirmation.timeout", to: "waiting_human",
    actor: ["job"], guard: "confirmation_timeout_elapsed" },

  // Handoff
  { from: "ai_handling", event: "handoff.requested", to: "waiting_human",
    actor: ["ai", "system"], effects: ["create_handoff"] },
  { from: "waiting_customer", event: "handoff.requested", to: "waiting_human",
    actor: ["ai", "system"], effects: ["create_handoff"] },

  // Humano
  { from: "open", event: "human.claimed", to: "human_handling",
    actor: ["attendant"], effects: ["assign_to_actor"] },
  { from: "waiting_human", event: "human.claimed", to: "human_handling",
    actor: ["attendant"], effects: ["assign_to_actor"] },
  { from: "human_handling", event: "human.reply_sent", to: "human_handling", actor: ["attendant"] },
  { from: "human_handling", event: "human.transferred", to: "human_handling",
    actor: ["attendant"], effects: ["assign_to_target"] },
  { from: "human_handling", event: "human.return_to_ai", to: "ai_handling",
    actor: ["attendant"], guard: "ai_enabled", effects: ["clear_assignee"] },
  { from: "human_handling", event: "human.resolved", to: "resolved", actor: ["attendant"] },
  { from: "waiting_human", event: "human.resolved", to: "resolved", actor: ["attendant"] },
  { from: "waiting_customer", event: "human.resolved", to: "resolved", actor: ["attendant"] },
  { from: "resolved", event: "human.reopened", to: "human_handling",
    actor: ["attendant"], effects: ["assign_to_actor"] },

  // Jobs
  { from: "waiting_customer", event: "system.inactivity", to: "resolved",
    actor: ["job"], guard: "auto_resolve_elapsed" },
  { from: "resolved", event: "system.archive", to: "archived",
    actor: ["job"], guard: "archive_window_elapsed" },

  // Automação (5.12). A partir de "nenhuma" a conversa é criada; como par
  // (estado, evento) só existem as duas linhas abaixo.
  { from: "resolved", event: "automation.outbound", to: "waiting_customer",
    actor: ["automation"], effects: ["create_conversation_if_absent"] },
  { from: "waiting_customer", event: "automation.outbound", to: "waiting_customer",
    actor: ["automation"], effects: ["create_conversation_if_absent"] },
] as const;

/** Eventos distintos DA TABELA, em ordem estável. Nunca escritos à mão. */
export const CONVERSATION_EVENTS: readonly string[] = Object.freeze(
  [...new Set(TRANSITIONS.map((row) => row.event))],
);

export type ConversationEvent = string;

const INDEX: ReadonlyMap<string, TransitionRow> = new Map(
  TRANSITIONS.map((row) => [`${row.from} ${row.event}`, row]),
);

if (INDEX.size !== TRANSITIONS.length) {
  throw new Error("TRANSITIONS tem par (estado, evento) duplicado");
}

/** Devolve a linha do par, ou `null` quando o par é ilegal. */
export function findTransition(
  from: ConversationState,
  event: string,
): TransitionRow | null {
  return INDEX.get(`${from} ${event}`) ?? null;
}

/** Destino do movimento, dado o resultado da guarda. */
export function resolveTarget(
  row: TransitionRow,
  guardSatisfied: boolean,
): ConversationState | null {
  if (!row.guard || guardSatisfied) return row.to;
  return row.toWhenGuardFails ?? null;
}
