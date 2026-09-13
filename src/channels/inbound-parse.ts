/**
 * O parser de entrada no formato de envelope do WAHA — compartilhado pelos DOIS
 * adapters de F03.
 *
 * Por que um módulo e não uma cópia em cada adapter: o mock de `WHATSAPP_MODE=
 * mock` (D12) lê o MESMO formato, porque as fixtures de
 * `tests/fixtures/waha/2026.7.2/` são a entrada dele (§5.7). Duas cópias da
 * mesma leitura divergiriam na primeira vez que alguém mexesse numa só — e a
 * prova `channel-adapter-contract` existe justamente para medir que os dois
 * adapters se comportam igual.
 *
 * ─── A allowlist, nos dois sentidos ────────────────────────────────────────
 *
 * SAÍDA: o evento devolvido tem exatamente os campos de `InboundEvent` e nada
 * mais. Copiar o payload inteiro faria todo consumidor — fila, log, prompt de
 * IA — herdar dado de cliente que ele não pediu, e é o que o mutante
 * `tests/mutants/33-f03-adapter-allowlist.sh` sabota para deixar vermelho.
 *
 * ENTRADA: o catálogo de chaves conhecidas vem do PRÓPRIO schema
 * (`wahaPayloadSchema.shape`), nunca de uma segunda lista escrita à mão — uma
 * cópia divergiria do contrato no primeiro campo novo. Chave de topo fora do
 * catálogo é CONTADA (G-42) em vez de descartada em silêncio: o webhook de um
 * provedor real traz campo que ninguém catalogou, e o número é como se descobre
 * que o fio mudou.
 */
import { incrementCounter } from "@/src/obs/counters";
import { ackToStatus } from "@/lib/types/messaging";
import { wahaEnvelopeSchema, wahaPayloadSchema, type WahaPayload } from "@/lib/waha/envelope";
// `@/lib/waha/jid` e NÃO `@/lib/waha/ingest`: o segundo arrasta efeitos
// pós-entrada, escalação e, por transitividade, `@react-pdf/renderer`, que em
// Node puro impede o worker de saída de subir como processo solto (G-71). O
// módulo-folha existe por causa disso; ver o cabeçalho dele.
import {
  mediaMimeOf,
  mediaUrlOf,
  parseChatId,
  telefoneAlternativoDe,
} from "@/lib/waha/jid";

import {
  montarRefDeMidia,
  rejeitar,
  type AckStatus,
  type InboundEvent,
  type InboundMedia,
  type ParseInboundResult,
  type SaasChannelProvider,
} from "./contract";

/** Catálogo de chaves de topo do payload — derivado do contrato Zod real. */
export const CAMPOS_CATALOGADOS: readonly string[] = Object.keys(wahaPayloadSchema.shape);

/**
 * Eventos que ESTA task sabe ler. `message.edited` e `message.revoked` existem
 * no fio e chegam aqui como `unsupported_event` de propósito: tratá-los é
 * trabalho declarado de fase posterior, e fingir que viraram mensagem nova
 * duplicaria a conversa do cliente.
 */
const EVENTOS_DE_MENSAGEM = new Set(["message", "message.any"]);
const EVENTO_DE_ACK = "message.ack";

/** Relógio injetável — a prova não depende do instante em que roda. */
export type Relogio = () => Date;

export interface ParseDeps {
  provider: SaasChannelProvider;
  agora: Relogio;
}

/**
 * O `ack` do provedor no vocabulário de três valores de §5.7.
 *
 * Reusa `ackToStatus` (a mesma tabela que a ingestão herdada aplica) e estreita:
 * `sending` é estado NOSSO de mensagem ainda não confirmada, não algo que um ack
 * afirme — aqui ele vira `null`, que é "o provedor não disse".
 */
function ackDoPayload(p: WahaPayload): AckStatus | null {
  const status = ackToStatus(p.ack);
  return status === "sent" || status === "delivered" || status === "read" ? status : null;
}

/**
 * Ponteiro para o corpo arquivado. NUNCA o corpo.
 *
 * A tripla (provedor, conta, id da mensagem) é o que identifica a linha de
 * arquivo — é também a chave de idempotência de §5.7 —, então quem investigar
 * encontra o payload por ela sem que o evento carregue um byte do cliente.
 */
function ponteiroDoArquivo(
  provider: SaasChannelProvider,
  accountKey: string,
  providerMessageId: string,
): string {
  return `${provider}:${accountKey}:${providerMessageId}`;
}

function midiaDoPayload(p: WahaPayload, accountKey: string): InboundMedia[] {
  const endereco = mediaUrlOf(p);
  if (endereco === null) return [];
  return [{ ref: montarRefDeMidia(accountKey, endereco), mime: mediaMimeOf(p) }];
}

/**
 * Conta cada chave de topo do payload fora do catálogo, no resultado E no
 * contador nomeado de §5.17 — o primeiro serve à prova, o segundo ao
 * VERIFY SUMMARY.
 */
function contarDesconhecidos(payload: Record<string, unknown>): Record<string, number> {
  const desconhecidos: Record<string, number> = {};
  for (const chave of Object.keys(payload)) {
    if (CAMPOS_CATALOGADOS.includes(chave)) continue;
    desconhecidos[chave] = (desconhecidos[chave] ?? 0) + 1;
    incrementCounter("unknown_fields", { name: chave });
  }
  return desconhecidos;
}

/** A chave da conta que o envelope nomeia: o nome da sessão do provedor. */
export function lerAccountKey(raw: unknown): string | null {
  const leitura = wahaEnvelopeSchema.safeParse(raw);
  if (!leitura.success) return null;
  const sessao = leitura.data.session;
  return typeof sessao === "string" && sessao.length > 0 ? sessao : null;
}

export function parseEnvelopeWaha(raw: unknown, deps: ParseDeps): ParseInboundResult {
  const leitura = wahaEnvelopeSchema.safeParse(raw);
  // Contrato violado NÃO é evento desconhecido: é payload que não é deste canal.
  if (!leitura.success) return rejeitar("unsupported_event");

  const envelope = leitura.data;
  const evento = envelope.event ?? "";
  const ehMensagem = EVENTOS_DE_MENSAGEM.has(evento);
  const ehAck = evento === EVENTO_DE_ACK;
  if (!ehMensagem && !ehAck) return rejeitar("unsupported_event");

  const accountKey = envelope.session;
  if (typeof accountKey !== "string" || accountKey.length === 0) {
    return rejeitar("missing_account_key");
  }

  const p = envelope.payload;
  if (!p) return rejeitar("missing_message_id");

  const providerMessageId = p.id;
  if (typeof providerMessageId !== "string" || providerMessageId.length === 0) {
    return rejeitar("missing_message_id");
  }

  // O endereço como o provedor o escreveu. Sem ele não há como saber de quem é
  // a mensagem — e "não sei" deixa rastro em vez de virar descarte mudo.
  const jidCru = p.from;
  if (typeof jidCru !== "string" || jidCru.length === 0) {
    return rejeitar("unrecognized_chat_id");
  }

  // Grupo e sufixo desconhecido são decididos ANTES do telefone alternativo: em
  // grupo o `participantAlt` traz o número de QUEM FALOU, e aceitá-lo aqui
  // transformaria um descarte esperado em contato criado por engano.
  const identidade = parseChatId(jidCru);
  if (identidade.kind === "group") return rejeitar("group_chat");
  if (identidade.kind === "unknown") return rejeitar("unrecognized_chat_id");

  // Ordem de G-34/G-73: `_data.key.remoteJidAlt`/`participantAlt` (o senderPn,
  // que o WhatsApp manda mesmo em chat `@lid`) antes do próprio `from`.
  const alternativo = telefoneAlternativoDe(p);
  const senderE164 = alternativo ?? identidade.phone;
  if (senderE164 === null) return rejeitar("lid_without_pn");

  // `timestamp` em segundos. Ausente, vale o instante da RECEPÇÃO — nunca uma
  // data inventada no passado, que ordenaria a conversa errado para sempre.
  const sentAt =
    typeof p.timestamp === "number" && Number.isFinite(p.timestamp)
      ? new Date(p.timestamp * 1000)
      : deps.agora();

  // ⚠️ A ALLOWLIST DE SAÍDA. Este literal é a única coisa que sai daqui: campo
  // que não está em `InboundEvent` não atravessa. Ver o mutante 33.
  const evento_de_entrada: InboundEvent = {
    account_key: accountKey,
    provider_message_id: providerMessageId,
    sender_e164: senderE164,
    sender_raw_jid: jidCru,
    body: p.body ?? null,
    media: midiaDoPayload(p, accountKey),
    sent_at: sentAt,
    raw_ref: ponteiroDoArquivo(deps.provider, accountKey, providerMessageId),
    kind: ehAck ? "ack" : "message",
    ack_status: ehAck ? ackDoPayload(p) : null,
  };

  return {
    events: [evento_de_entrada],
    unknownFields: contarDesconhecidos(p as Record<string, unknown>),
  };
}
