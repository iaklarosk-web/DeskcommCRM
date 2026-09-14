/**
 * Knowledge/RAG com escopo de organização (§5.10, F04-T03).
 *
 * ADAPTA o RAG herdado — `ai_chunks`, `ai_knowledge_sources` e a RPC
 * `fn_buscar_trechos_das_fontes` continuam sendo as tabelas e o motor (ADR-023).
 * A ingestão do agente de lead e a reindexação em fila seguem em `lib/ai/rag/`;
 * o que nasce aqui é a busca do turno SaaS, que aceita o acervo da organização
 * inteira, e a ingestão SÍNCRONA que a tela de IA do tenant usa (F04-T10).
 */
export {
  buscar,
  resolverAcervoDaOrganizacao,
  type DepsDaBusca,
  type EscopoDoAcervo,
  type ParametrosDaBusca,
  type ResultadoDaBusca,
  type TrechoEncontrado,
} from "./busca";
export {
  DocumentoGrandeDemais,
  DocumentoVazio,
  ingerirDocumento,
  listarAcervo,
  partirEmTrechos,
  TAMANHO_ALVO_DO_TRECHO,
  TRECHOS_MAXIMOS,
  type DepsDaIngestao,
  type DocumentoDoAcervo,
  type MaterialDoAcervo,
} from "./ingestao";
export {
  comoVetorSql,
  conferirDimensao,
  DIMENSOES_DO_EMBEDDING,
  embutirDeterministico,
  MODELO_DE_EMBEDDING,
  type Embutidor,
} from "./embedding";
