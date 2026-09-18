/** F14 — chat do site (ADR-038). A fronteira pública vive em `app/api/public/webchat/`. */
export { contagensDoFreio, decidirFreio, LIMITES_DO_WEBCHAT, type ContagensDoFreio, type MotivoDoFreio } from "./freios";
export { garantirCanalWebchat, identificar, normalizarContato, type ResultadoDaIdentificacao } from "./identificacao";
export { estadoDaConversaDoVisitante, listarMensagensDoVisitante, type EstadoDaConversaDoVisitante, type MensagemVisivel } from "./mensagens";
export { janelaDoHumano, type JanelaDoHumano } from "./horario";
export { receberMensagemDoVisitante, TAMANHO_MAXIMO_DA_MENSAGEM, type ResultadoDaMensagemDoVisitante } from "./entrada";
export {
  criarSessao,
  decidirAberturaDeSessao,
  hashDoIp,
  hashDoToken,
  organizacaoPorSlug,
  sessaoPorToken,
  webchatLigado,
  type ResultadoDaSessao,
  type SessaoDoVisitante,
  type WebchatDeps,
} from "./sessao";
