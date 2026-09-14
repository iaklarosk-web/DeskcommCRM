/**
 * Normalização de erro de job (§5.13, F03-T07).
 *
 * `job_queue.last_error` já carrega, no COMMENT do schema herdado, a regra que
 * este arquivo executa: "normalizado/truncado no código — nunca conteúdo de
 * mensagem (PII)". `job_runs.error` herda a mesma regra.
 *
 * O que se guarda é a CAUSA em forma contável, não o texto que o provedor
 * devolveu: quem lê a fila é operação, e operação não pediu o corpo da mensagem
 * de ninguém. Uma falha do canal vira `channel_send_failed:<reason>`, onde
 * `reason` é o enum do adapter; o resto vira `<Nome do erro>:<mensagem curta>`,
 * com telefone e e-mail substituídos por rótulo antes do corte.
 *
 * A raspagem de telefone/e-mail não é teatro: `ChannelSendFailed` é nossa e é
 * disciplinada, mas um erro de driver ou de HTTP pode trazer a URL com o número
 * do destinatário dentro — e esse é exatamente o dado que não pode viver numa
 * tabela que o suporte lê.
 */
import { ChannelSendFailed } from "@/src/channels/contract";

/** Teto em caracteres. Erro que não cabe aqui não é erro, é despejo de log. */
export const TAMANHO_MAXIMO_DE_ERRO = 200;

const TELEFONE = /\+?\d[\d\s().-]{7,}\d/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

export function normalizarErro(erro: unknown): string {
  const bruto =
    erro instanceof ChannelSendFailed
      ? `channel_send_failed:${erro.reason}`
      : erro instanceof Error
        ? `${erro.name}:${erro.message}`
        : "erro_desconhecido";

  return bruto
    .replace(/\s+/g, " ")
    .replace(EMAIL, "[email]")
    .replace(TELEFONE, "[numero]")
    .trim()
    .slice(0, TAMANHO_MAXIMO_DE_ERRO);
}
