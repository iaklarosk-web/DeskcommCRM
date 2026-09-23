/** F14-T03 — a agenda herdada, adotada pela fachada SaaS (ADR-038 §2 T03; D41). */
export { horariosLivresDaOrganizacao, horariosLivresIn, lerTipo, type AgendaDeps, type ParametrosDaConsulta, type ResultadoDaConsulta, type TipoLido } from "./consulta";
export { cancelar, confirmar, detectarConflito, marcar, podeCancelar, registrarDesfecho, remarcar, type AtorDaAgenda, type CompromissoExistente, type CompromissoMarcado, type PedidoDeMarcacao, type ResultadoDaMarcacao, type ResultadoDaMudanca } from "./marcar";
export {
  listarCompromissos,
  listarTiposDeAtendimento,
  MAX_LINHAS_DA_AGENDA,
  type CompromissoListado,
  type TipoDeAtendimento,
} from "./leitura";
