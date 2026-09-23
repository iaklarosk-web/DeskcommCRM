/**
 * Action Policy (§5.8, D17) — o catálogo, o executor e a confirmação. Nada fora
 * deste diretório produz efeito colateral de canal: `src/actions/` é o ÚNICO
 * que chama `adapter.send` (§5.7, invariante 3).
 */
export {
  ACTION_CATALOG,
  ACTION_ENTRY_FIELDS,
  ACTION_EXECUTORS,
  ACTION_RISKS,
  conversaAceitaEnvio,
  ESTADOS_SEM_ENVIO,
  findAction,
  nivelDeRisco,
  toolsFor,
  type ActionCatalogEntry,
  type ActionConfirmation,
  type ActionExecutor,
  type ActionRisk,
  type ToolSpec,
} from "./catalog";
export {
  HANDOFF_REASONS,
  sendMessageInputSchema,
  sendMessageOutputSchema,
  type SendMessageInput,
  type SendMessageOutput,
} from "./schemas";
export {
  AUDIT_ACTOR_TYPES,
  AUDIT_RESULTS,
  record,
  recordIn,
  type AuditActorType,
  type AuditEvent,
  type AuditResult,
} from "./audit";
export {
  entregarSaida,
  execute,
  MensagemDeSaidaAusente,
  type ActionActor,
  type ActionDenyReason,
  type ActionResult,
  type ActionStatus,
  type EntregaDeSaida,
  type ExecuteDeps,
} from "./execute";
export { enviarMensagem, type ResultadoDeEnvio } from "./outbound";
export {
  confirm,
  expirarConfirmacoes,
  type ConfirmDecision,
  type ResultadoDoTimeout,
} from "./confirm";
export {
  PENDING_STATUSES,
  type PendingAction,
  type PendingDecision,
  type PendingStatus,
} from "./pending-store";
export { findHandler, type ToolRunner } from "./tools";
