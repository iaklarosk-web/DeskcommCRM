/**
 * Knowledge/RAG com escopo de organização (§5.10, F04-T03).
 *
 * ADAPTA o RAG herdado — `ai_chunks`, `ai_knowledge_sources` e a RPC
 * `fn_buscar_trechos_das_fontes` continuam sendo as tabelas e o motor (ADR-023).
 * A ingestão e a reindexação seguem em `lib/ai/rag/`; o que nasce aqui é a busca
 * do turno SaaS, que aceita o acervo da organização inteira.
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
  comoVetorSql,
  conferirDimensao,
  DIMENSOES_DO_EMBEDDING,
  embutirDeterministico,
  MODELO_DE_EMBEDDING,
  type Embutidor,
} from "./embedding";
