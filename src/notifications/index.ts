/**
 * Notificações (§5.16, F05-T05) — transformar evento interno em aviso.
 *
 * Quatro arquivos, quatro responsabilidades:
 *  · `eventos.ts`       — os SEIS eventos em enum e o texto de e-mail de cada um;
 *  · `destinatarios.ts` — quem recebe (membros por papel; dono-ou-fila);
 *  · `email.ts`         — o adapter de e-mail (só o mock existe, D12);
 *  · `notify.ts`        — a escrita in-app (+ e-mail se ligado), a lista e o lido.
 *
 * Invariante de §5.16: NENHUM arquivo fora deste diretório escreve ou lê
 * `public.notifications` — a prova é um grep em `tests/unit/f05-t05-notificacoes-so-aqui.test.ts`.
 * Quem precisa avisar chama `notify(db, ctx, …)` de dentro da sua transação.
 */
export {
  donoOuFila,
  membrosPorPapel,
} from "./destinatarios";
export {
  criarEmailAdapterMock,
  type EmailAdapter,
  type EmailDeNotificacao,
} from "./email";
export {
  ehEventoDeNotificacao,
  EVENTOS_DE_NOTIFICACAO,
  preencher,
  TEXTO_DO_EMAIL,
  type EventoDeNotificacao,
} from "./eventos";
export {
  EventoDesconhecido,
  marcarLida,
  naoLidas,
  notify,
  notifyFora,
  type AvisoNaoLido,
  type NotifyDeps,
  type ResultadoDoNotify,
} from "./notify";
