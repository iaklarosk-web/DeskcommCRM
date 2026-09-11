/**
 * Action Policy (§5.8, D17) — o catálogo e o executor. Nada fora deste
 * diretório produz efeito colateral de canal: `src/actions/` é o ÚNICO que
 * chama `adapter.send` (§5.7, invariante 3).
 */
export {
  ACTION_CATALOG,
  ACTION_EXECUTORS,
  conversaAceitaEnvio,
  ESTADOS_SEM_ENVIO,
  findAction,
  sendMessageInputSchema,
  sendMessageOutputSchema,
  type ActionCatalogEntry,
  type ActionConfirmation,
  type ActionExecutor,
  type ActionRisk,
  type SendMessageInput,
  type SendMessageOutput,
} from "./catalog";
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
