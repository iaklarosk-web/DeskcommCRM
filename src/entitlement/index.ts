/**
 * Entitlement (§5.3, D14) — o dono da pergunta "este tenant pode exercer esta
 * Capability agora, e quanto resta?". Na Fase 1 a resposta é sempre sim.
 */
export { CAPABILITIES, type Capability, type EntitlementResposta } from "./capability";
export {
  entitlement,
  EntitlementDenied,
  recordUsage,
  withEntitlement,
  type Usage,
} from "./entitlement";
export { estimatedCostCents, modeloTemPreco } from "./pricing";
export {
  mesAnteriorA,
  mesDe,
  PeriodoInvalido,
  periodoDeDatas,
  resumoDeUso,
  type LinhaDeUso,
  type PeriodoDeUso,
  type ResumoDeUso,
} from "./uso";
