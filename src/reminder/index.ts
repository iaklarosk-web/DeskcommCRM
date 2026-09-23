/**
 * Recurring Reminder (§5.12, D23; F05-T06/T07/T08) — a única automação da
 * Fase 1, e não um motor.
 *
 *  · `periodo.ts` — hora local, janela e semana ISO (puro);
 *  · `config.ts`  — a Setting `orders.recurring_reminder`, conferida;
 *  · `envio.ts`   — o cron por tenant, o claim do período e o envio pelo catálogo;
 *  · `corte.ts`   — o sem-resposta: aviso, tentativa de tarefa (F05-T08);
 *  · `resposta.ts`— a resposta do cliente: registro, contexto do turno, conclusão.
 */
export {
  bateAJanela,
  chaveDoPeriodo,
  FusoInvalido,
  horaLocal,
  type HoraLocal,
  type JanelaDoLembrete,
} from "./periodo";
export {
  ConfigDoLembreteInvalida,
  configDoLembrete,
  fusoDoTenant,
  lerConfigDoLembrete,
  type ConfigDoLembrete,
} from "./config";
export {
  chaveDeIdempotencia,
  corpoDoLembrete,
  CRON_KEY_DO_LEMBRETE,
  dispararParaTenant,
  rodarLembretes,
  selectEligibleCustomers,
  type DepsDoLembrete,
  type DesfechoDoCliente,
  type ResultadoDosLembretes,
  type ResultadoDoTenant,
} from "./envio";
export {
  cortarParaTenant,
  rodarCortes,
  type CorteDeUmLembrete,
  type ResultadoDoCorteDoTenant,
  type ResultadoDosCortes,
} from "./corte";
export {
  concluirLembrete,
  lembreteDaConversa,
  registrarRespostaAoLembrete,
  type DesfechoDoLembrete,
  type LembreteDaConversa,
  type RespostaRegistrada,
} from "./resposta";
