/**
 * Jobs (§5.13) — a porta de entrada da fila e o worker de saída.
 */
export {
  enqueue,
  EnqueueInvalido,
  JOB_KINDS_DE_SAIDA,
  MAX_TENTATIVAS_DE_SAIDA,
  type EnqueueDeps,
  type EnqueueResult,
  type JobKindDeSaida,
} from "./enqueue";
export { normalizarErro, TAMANHO_MAXIMO_DE_ERRO } from "./erros";
export {
  BACKOFF_PADRAO_MS,
  rodarCicloDeSaida,
  type CicloDeSaidaDeps,
  type ResultadoDoCiclo,
} from "./outbound-worker";
