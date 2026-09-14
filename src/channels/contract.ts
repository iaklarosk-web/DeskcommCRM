/**
 * `SaasChannelAdapter` — o contrato de canal de §5.7 da DIRETRIZ (ADR-017).
 *
 * NÃO substitui o `ChannelAdapter` herdado (`lib/channels/types.ts:152`): aquele
 * continua servindo as três rotas de webhook e o envio síncrono da operação de
 * hoje, sem uma linha alterada. Este descreve a forma que o SaaS precisa — a
 * mesma para todo provedor — e os adapters de F03 a cumprem EMBRULHANDO o
 * herdado (`src/channels/waha.ts`) ou gravando em `mock_outbox`
 * (`src/channels/mock.ts`, D12).
 *
 * Duas escolhas do contrato que não são estilo:
 *
 *  - `raw_ref` é PONTEIRO, nunca o payload. Quem quiser o corpo cru vai ao
 *    arquivo (`webhook_events_log` hoje, o que a F03-T04 fixar depois). Carregar
 *    o payload dentro do evento faria todo consumidor — fila, log, IA — herdar
 *    dado de cliente que ele não pediu.
 *  - `reason` é ENUM (G-78/D19). Frase livre não é contável: `RejectReason`
 *    vira etiqueta de contador e coluna de quarentena, e um texto novo a cada
 *    caminho de recusa transformaria a métrica em prosa.
 */
import type { TenantCtx } from "@/src/tenant-context";

export type SaasChannelProvider = "waha" | "mock";

/** Os provedores em forma de dado — o `getSaasAdapter` e as provas os contam. */
export const SAAS_CHANNEL_PROVIDERS = ["waha", "mock"] as const satisfies readonly SaasChannelProvider[];

/**
 * O anexo como ele chega: um ponteiro e o MIME que o provedor declarou. Os bytes
 * só existem depois de `fetchMedia` — a URL de canal expira (~9 dias medidos no
 * WhatsApp) e guardá-la faria a mídia sumir sozinha.
 *
 * O ponteiro carrega a CONTA na frente (`<account_key>|<endereço do provedor>`)
 * porque `fetchMedia(ctx, ref)` recebe só `ctx` e `ref`: mídia de canal se
 * resolve por sessão, e um ref sem conta obrigaria o chamador a saber de que
 * sessão ele veio — conhecimento que o contrato de §5.7 não lhe dá.
 */
export interface InboundMedia {
  /** `<account_key>|<endereço do provedor>`. Ver `partirRefDeMidia`. */
  ref: string;
  /** MIME declarado no webhook. Dica, não verdade. */
  mime: string | null;
}

/** O separador do ref de mídia. Um caractere que não aparece em URL. */
const SEPARADOR_DE_REF = "|";

export function montarRefDeMidia(accountKey: string, endereco: string): string {
  return `${accountKey}${SEPARADOR_DE_REF}${endereco}`;
}

/**
 * Devolve `{accountKey, endereco}`. Ref sem separador é lido como endereço sem
 * conta conhecida — não é erro: o chamador pode ter montado o ref à mão, e
 * recusar seria trocar "mídia baixada" por "exceção" sem ganho nenhum.
 */
export function partirRefDeMidia(ref: string): { accountKey: string; endereco: string } {
  const corte = ref.indexOf(SEPARADOR_DE_REF);
  if (corte === -1) return { accountKey: "", endereco: ref };
  return { accountKey: ref.slice(0, corte), endereco: ref.slice(corte + 1) };
}

/** Estado de entrega que um `ack` carrega. `null` = o evento não é um ack. */
export type AckStatus = "sent" | "delivered" | "read";

/**
 * Por que um payload não vira evento. Enum fechado de propósito (G-78):
 *
 *  - `unsupported_event`     — o tipo de evento não é de entrada nem de ack
 *  - `group_chat`            — `@g.us`: descarte ESPERADO por doutrina
 *  - `unrecognized_chat_id`  — sufixo que ninguém catalogou (`@newsletter`, …)
 *  - `lid_without_pn`        — `@lid` sem telefone alternativo (G-34/G-73)
 *  - `missing_message_id`    — sem id não há idempotência possível
 *  - `missing_account_key`   — sem conta não há tenant a resolver
 *
 * O sexto motivo não é enfeite: payload sem `session` chega, e classificá-lo
 * como `unsupported_event` seria contar uma coisa dizendo outra — a diferença
 * é o que separa "o fio mudou" de "o evento veio sem remetente de conta".
 */
export const REJECT_REASONS = [
  "unsupported_event",
  "group_chat",
  "unrecognized_chat_id",
  "lid_without_pn",
  "missing_message_id",
  "missing_account_key",
] as const;

export type RejectReason = (typeof REJECT_REASONS)[number];

export type Rejected = { rejected: true; reason: RejectReason };

export function rejeitar(reason: RejectReason): Rejected {
  return { rejected: true, reason };
}

export function foiRejeitado(
  resultado: ParseInboundResult,
): resultado is Rejected {
  return "rejected" in resultado;
}

export interface InboundEvent {
  /** Chave da conta do provedor (WAHA: nome da sessão). Resolve o tenant. */
  account_key: string;
  provider_message_id: string;
  /** E.164 quando o provedor deixou saber; `null` quando só há id opaco. */
  sender_e164: string | null;
  /** O endereço como o provedor o escreveu (`…@lid`, `…@c.us`). */
  sender_raw_jid: string | null;
  body: string | null;
  media: InboundMedia[];
  sent_at: Date;
  /** Ponteiro para o payload arquivado — NUNCA o payload. */
  raw_ref: string;
  /** `ack` alimenta a F03-T06 (sent → delivered → read). */
  kind: "message" | "ack";
  ack_status: AckStatus | null;
}

/**
 * A ALLOWLIST de saída, em forma de dado.
 *
 * A prova conta as chaves do evento CONTRA esta lista em vez de repetir os
 * nomes: uma segunda cópia mediria o parser contra a memória de quem escreveu.
 */
export const INBOUND_EVENT_FIELDS = [
  "account_key",
  "provider_message_id",
  "sender_e164",
  "sender_raw_jid",
  "body",
  "media",
  "sent_at",
  "raw_ref",
  "kind",
  "ack_status",
] as const satisfies readonly (keyof InboundEvent)[];

export interface ParsedInbound {
  events: InboundEvent[];
  /** Chave de topo do payload fora do catálogo → nome: quantas vezes (G-42). */
  unknownFields: Record<string, number>;
}

export type ParseInboundResult = ParsedInbound | Rejected;

/**
 * A mensagem de saída. `organization_id` é OBRIGATÓRIO e vem do `ctx` — o
 * adapter recusa divergência entre os dois em vez de escolher um (D06/D20).
 */
export interface OutboundMessage {
  organization_id: string;
  conversation_id: string;
  to_e164: string;
  body: string;
  /** Mesma chave ⇒ mesmo `provider_message_id`, e nenhum segundo envio. */
  idempotency_key: string;
  /**
   * Conta de canal por onde sai (WAHA: nome da sessão). OPCIONAL no tipo porque
   * quem a resolve é `channel_accounts`, e essa resolução é da F03-T03; o
   * adapter que precisa dela e não a recebe falha com erro TIPADO, nunca com um
   * default inventado que mandaria a mensagem pela sessão errada.
   */
  account_key?: string | null;
}

/** Falha de envio com motivo legível — nunca `{externalId: null}` mudo. */
export class ChannelSendFailed extends Error {
  constructor(
    public readonly provider: SaasChannelProvider,
    public readonly reason: string,
  ) {
    super(`envio recusado pelo canal ${provider}: ${reason}`);
    this.name = "ChannelSendFailed";
  }
}

/** O canal não sabe (ou não pode) baixar a mídia pedida. */
export class ChannelMediaUnavailable extends Error {
  constructor(
    public readonly provider: SaasChannelProvider,
    public readonly reason: string,
  ) {
    super(`mídia indisponível no canal ${provider}: ${reason}`);
    this.name = "ChannelMediaUnavailable";
  }
}

/** Cabeçalhos como a rota os tem: `Headers` do fetch ou objeto simples. */
export type HeaderBag = Headers | Record<string, string | undefined>;

/** Leitura case-insensitive nas duas formas — `Headers` já normaliza. */
export function lerCabecalho(headers: HeaderBag, nome: string): string | null {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(nome);
  }
  const bag = headers as Record<string, string | undefined>;
  const alvo = nome.toLowerCase();
  for (const chave of Object.keys(bag)) {
    if (chave.toLowerCase() === alvo) return bag[chave] ?? null;
  }
  return null;
}

export interface SaasChannelAdapter {
  readonly provider: SaasChannelProvider;
  /**
   * Tem credencial para trabalhar? Perguntado ANTES de tudo: sem segredo a rota
   * responde 503 e conta, em vez de responder 200 a evento não verificado
   * (G-27).
   */
  isConfigured(): boolean;
  verifySignature(raw: Buffer, headers: HeaderBag): boolean;
  /** A conta do provedor que o payload nomeia; `null` quando não dá para ler. */
  resolveAccountKey(raw: unknown): string | null;
  parseInbound(raw: unknown): ParseInboundResult;
  send(ctx: TenantCtx, msg: OutboundMessage): Promise<{ provider_message_id: string }>;
  fetchMedia(ctx: TenantCtx, ref: string): Promise<ReadableStream>;
}
