/** F14-T03 — a agenda herdada, adotada pela fachada SaaS (ADR-038 §2 T03; D41). */
export { horariosLivresDaOrganizacao, horariosLivresIn, lerTipo, type AgendaDeps, type ParametrosDaConsulta, type ResultadoDaConsulta, type TipoLido } from "./consulta";
export { cancelar, detectarConflito, marcar, remarcar, type AtorDaAgenda, type CompromissoExistente, type CompromissoMarcado, type PedidoDeMarcacao, type ResultadoDaMarcacao, type ResultadoDaMudanca } from "./marcar";
