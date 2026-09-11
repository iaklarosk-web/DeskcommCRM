/**
 * Conversation (§5.6, D16/D34) — a tabela de transições, os mapas com o ciclo
 * herdado, as guardas e a autoridade de evento. Quem move conversa entra aqui.
 */
export {
  CONVERSATION_EVENTS,
  CONVERSATION_STATES,
  findTransition,
  resolveTarget,
  TRANSITIONS,
  type ConversationEvent,
  type ConversationState,
  type TransitionActor,
  type TransitionEffect,
  type TransitionGuard,
  type TransitionRow,
} from "./transitions";
export {
  COARSENINGS,
  D16_TO_LEGACY,
  isConversationState,
  isDeclaredCoarsening,
  isLegacyStatus,
  LEGACY_STATUSES,
  LEGACY_TO_D16,
  type Coarsening,
  type LegacyStatus,
} from "./state-map";
export {
  GuardNotImplemented,
  resolverDeGuardasF03,
  type GuardConversation,
  type GuardDeps,
  type GuardResolver,
} from "./guards";
export {
  ConversationNotFound,
  EffectNotImplemented,
  type EffectExecutor,
  IllegalTransition,
  iniciarPorAutomacao,
  transition,
  type IllegalReason,
  type InicioPorAutomacao,
  type TransitionActorRef,
  type TransitionDeps,
  type TransitionResult,
} from "./transition";
export {
  CONVERSATION_TAGS,
  limparTag,
  marcarTag,
  tagsDaConversa,
  type ConversationTag,
} from "./tags";
