/**
 * A camada de IA do turno SaaS (§5.9). A porta de chamada ao provedor
 * (`chamada.ts`, F04-T08) e a orquestração do turno (F04-T04/T05/T06/T09).
 *
 * Este módulo NÃO importa cliente Postgres nem `fetch` (§5.9): o banco entra por
 * `withTenant` (§5.1) e o provedor, por `chamada.ts` → `runModelCall`. Todo
 * efeito sai por `Action Policy.execute` ou por `transition()`.
 */
export {
  chamarModelo,
  type DepsDaChamada,
  type EntradaDaChamada,
  type SaidaDaChamada,
} from "./chamada";
export {
  comoTextoDoProvedor,
  lerSaidaEstruturada,
  SAIDA_SEM_LEITURA,
  saidaEstruturadaSchema,
  toolCallSchema,
  type LeituraDaSaida,
  type SaidaEstruturada,
  type ToolCallPedida,
} from "./contrato";
export {
  CHAVES_DO_CONTEXTO,
  contextoComoTexto,
  ConversaForaDoTenant,
  instrucoesDoSistema,
  LIMIAR_DO_ACERVO,
  montarContexto,
  PREFIXOS_DE_SETTING,
  PRODUTOS_NO_CONTEXTO,
  TRECHOS_NO_CONTEXTO,
  type ContextoDoTurno,
  type DepsDoContexto,
  type EntradaDoContexto,
} from "./contexto";
export {
  abaixoDoLimiar,
  ESTADOS_EM_QUE_A_IA_FALA,
  estaForaDaBase,
  iaPodeFalar,
  LIMIAR_PADRAO_DE_CONFIANCA,
  limiarDoTenant,
  pedidoProibido,
  textoDeDesconhecido,
  triarToolCalls,
  type TriagemDeToolCalls,
} from "./guardrails";
export {
  lerConversaDoTurno,
  MENSAGENS_NO_CONTEXTO,
  vezesQueRespondeuDesconhecido,
  type ConversaDoTurno,
  type MensagemDoHistorico,
} from "./historico";
export {
  ambientePadrao,
  criarRegistroMock,
  ehModoMock,
  ENV_MODELO,
  ENV_PROVEDOR,
  modeloDeclarado,
  PROVEDOR_MOCK,
  registroDoProvedor,
  roteiroDeOmissao,
  type Ambiente,
  type DepsDoProvedor,
  type PedidoAoModelo,
  type Roteiro,
} from "./provedor";
export {
  responderTurno,
  type DepsDoTurno,
  type MotivoDoHandoff,
  type MotivoDoSilencio,
  type PedidoDoTurno,
  type ResultadoDoTurno,
  type ToolExecutada,
} from "./turno";
