/**
 * Handoff (§5.11, D19) — por que a conversa saiu da IA e o que a pessoa precisa
 * ler para assumir (F05-T01/T02/T03/T04).
 *
 * Três arquivos, três responsabilidades:
 *  · `motivos.ts`  — os OITO motivos em enum e os textos determinísticos deles;
 *  · `gatilhos.ts` — as decisões PURAS que não precisam de banco nem provedor;
 *  · `resumo.ts`   — os SETE campos, montados do checkpoint/histórico;
 *  · `registro.ts` — o dossiê no banco, a fila e o claim.
 *
 * O que NÃO está aqui, de propósito: mover a conversa (`src/conversation`),
 * silenciar o bot (`lib/agent-engine/agent/human-handoff.ts`, herdado) e o aviso
 * da organização (`src/actions/handoff-bridge.ts`). A F05 AMPLIA os três.
 */
export {
  contaFrases,
  ehMotivoDeHandoff,
  INTENT_PADRAO,
  MOTIVOS_DE_HANDOFF,
  ORIGEM_DO_MOTIVO,
  PORQUE_DO_MOTIVO,
  PROXIMO_PASSO_DO_MOTIVO,
  resumoDeterministico,
  type MotivoDeHandoff,
  type OrigemDoMotivo,
} from "./motivos";
export {
  acoesDeRiscoAlto,
  assuntoProibidoDoTenant,
  gatilhoDeTexto,
  normalizar,
  pedidoDeAtendenteHumano,
  reclamacaoDetectada,
  RISCO_QUE_EXIGE_HUMANO,
  type GatilhoDeTexto,
} from "./gatilhos";
export {
  CAMPOS_DO_RESUMO,
  camposAusentes,
  montarResumo,
  ResumoIncompleto,
  ULTIMAS_MENSAGENS_NO_RESUMO,
  type CampoDoResumo,
  type MensagemDoResumo,
  type PedidoDeResumo,
  type ResumoDoHandoff,
} from "./resumo";
export {
  ATRIBUICAO_DA_FASE_1,
  AtribuicaoNaoSuportada,
  claim,
  filaDeHandoffs,
  gravarHandoff,
  modalidadeDeAtribuicao,
  PAPEIS_DA_FILA_PADRAO,
  papelNaOrganizacao,
  type DepsDoHandoff,
  type HandoffNaFila,
  type MotivoDaRecusaDeClaim,
  type ResultadoDoClaim,
} from "./registro";
