/** A fachada SaaS do funil (F18-T02, ADR-040 §2) — leitura e escrita. */
export {
  listarLeads,
  lerLead,
  listarFunis,
  listarEstagios,
  MAX_LINHAS_DO_FUNIL,
  type DepsDoFunil,
  type EstagioLido,
  type FunilLido,
  type LeadDoFunil,
} from "./leitura";
export {
  atualizarLead,
  criarLead,
  moverLead,
  type AtorDoFunil,
  type MotivoDeRecusaDoFunil,
  type ResultadoDoFunil,
} from "./escrita";
