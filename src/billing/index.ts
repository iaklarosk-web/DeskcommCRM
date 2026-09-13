/**
 * Billing (F12, ADR-030 §3) — planos, assinatura, gateway mock, acesso, uso e
 * conciliação. O Entitlement (§5.3) pergunta aqui o que o plano permite; o
 * layout e o guarda de rota perguntam aqui o que a assinatura permite.
 */
export {
  ESTADOS_DA_ASSINATURA,
  EVENTOS_DA_ASSINATURA,
  MODO_POR_ESTADO,
  ORIGENS_DA_ASSINATURA,
  TIPOS_DE_EVENTO_DO_GATEWAY,
  TOTAL_DE_TRANSICOES,
  ehEstadoDaAssinatura,
  ehTipoDeEventoDoGateway,
  transicao,
  type EstadoDaAssinatura,
  type EventoDaAssinatura,
  type ModoDeAcesso,
  type OrigemDaAssinatura,
  type TipoDeEventoDoGateway,
} from "./estados";
export { PlanoDesconhecido, listarPlanos, obterPlano, type Plano } from "./planos";
export {
  TransicaoIlegal,
  aplicarEventoDoGateway,
  cancelar,
  criarAssinatura,
  criarAssinaturaEm,
  iniciarCheckout,
  lerAssinatura,
  lerAssinaturaEm,
  listarFaturasEm,
  mudarPlano,
  varrerCarencia,
  type Assinatura,
  type DesfechoDoEvento,
  type EventoDoGateway,
  type Fatura,
} from "./assinatura";
export { acessoDe, escritaPermitida, estadoDeAcesso, motivoDe, type EstadoDeAcesso, type MotivoDoAcesso } from "./acesso";
export { mesCivil, usoDaCapabilityEm, usoPorCapabilityEm, type Periodo, type UsoDeCapability } from "./uso";
export { conciliar, type Conciliacao, type Divergencia } from "./conciliacao";
export {
  CABECALHO_DA_ASSINATURA,
  GATEWAY_MOCK,
  assinar,
  assinaturaConfere,
  criarCheckoutMock,
  emitirEventoMock,
  lerCorpoDoEventoMock,
  type CheckoutMock,
  type CorpoDoEventoMock,
} from "./gateway/mock";
