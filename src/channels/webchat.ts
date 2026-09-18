/**
 * O adapter SaaS do chat do site (F14, ADR-038 §2 T01).
 *
 * É o único adapter SEM transporte e SEM webhook:
 *  - a ENTRADA não passa por aqui — o visitante fala com a rota pública
 *    (`app/api/public/webchat/[slug]/messages`), que grava a mensagem e chama
 *    `concluirEntrada` (`src/channels/inbound.ts`), o mesmo fim de caminho do
 *    WhatsApp. Por isso `verifySignature` é sempre falso, `resolveAccountKey`
 *    é nulo e `parseInbound` recusa: um envelope "de webhook" com provider
 *    `webchat` é, por definição, forjado;
 *  - a SAÍDA "entrega" gravando: quando `entregarSaida` chama `send`, a linha
 *    de `messages` já existe (`enviarMensagem` a gravou como `queued`); o que
 *    a página do visitante lê é essa linha marcada `sent`. `send` devolve um
 *    `provider_message_id` determinístico pela chave de idempotência — a
 *    reentrega do worker (`already sent`) continua reconhecida sem tabela nova.
 *
 * `isConfigured` é verdadeiro sem segredo porque não há terceiro a quem
 * provar nada: a organização liga o canal por `webchat.enabled` (D55 c).
 */
import { createHash } from "node:crypto";

import type { TenantCtx } from "@/src/tenant-context";

import {
  ChannelMediaUnavailable,
  ChannelSendFailed,
  rejeitar,
  type HeaderBag,
  type OutboundMessage,
  type ParseInboundResult,
  type SaasChannelAdapter,
} from "./contract";

/** `webchat:` + SHA-256 curto da (organização, chave): estável entre reentregas. */
export function idDeterministicoDoWebchat(organizationId: string, idempotencyKey: string): string {
  return `webchat:${createHash("sha256").update(`${organizationId}\n${idempotencyKey}`).digest("hex").slice(0, 32)}`;
}

export const webchatSaasAdapter: SaasChannelAdapter = {
  provider: "webchat",
  isConfigured(): boolean {
    return true;
  },
  verifySignature(_raw: Buffer, _headers: HeaderBag): boolean {
    return false;
  },
  resolveAccountKey(_raw: unknown): string | null {
    return null;
  },
  parseInbound(_raw: unknown): ParseInboundResult {
    return rejeitar("unsupported_event");
  },
  async send(ctx: TenantCtx, msg: OutboundMessage): Promise<{ provider_message_id: string }> {
    if (msg.organization_id !== ctx.organization_id) {
      throw new ChannelSendFailed("webchat", "tenant_mismatch");
    }
    return { provider_message_id: idDeterministicoDoWebchat(ctx.organization_id, msg.idempotency_key) };
  },
  async fetchMedia(_ctx: TenantCtx, _ref: string): Promise<ReadableStream> {
    throw new ChannelMediaUnavailable("webchat", "canal_sem_midia");
  },
};
