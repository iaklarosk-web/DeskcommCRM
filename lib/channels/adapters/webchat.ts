/**
 * Adapter HERDADO do chat do site (F14, ADR-038 §2 T01).
 *
 * O `webchat` é o único canal SEM transporte: a mensagem de saída "entregue" é
 * a própria linha de `messages` que `sendMessageHandler` acabou de gravar — a
 * página do visitante a lê pela rota pública (`GET /api/public/webchat/.../messages`).
 * Por isso `send` não fala com ninguém: devolve um `externalId` próprio (o
 * carimbo do momento da entrega), e o chamador grava `status='sent'` como faz
 * com os outros canais. Sem credencial, sem QR, sem template, sem mídia de
 * entrada — cada método opcional que não faz sentido fica ausente, e
 * `capabilitiesOf("webchat")` diz o resto (`liveVisitor: true`).
 *
 * `resolveRecipient` devolve um endereço FIXO: no site não há E.164 nem chatId
 * — quem endereça é a conversa (uma por visitante identificado). Devolver
 * `null` faria o chamador tratar como "contato sem endereço" e recusar.
 */
import { randomUUID } from "node:crypto";

import type { ChannelAdapter, ChannelHealth, ChannelTenantScope, OutboundEnvelope, RecipientInput } from "../types";

export const WEBCHAT_RECIPIENT = "webchat";

export const webchatAdapter: ChannelAdapter = {
  provider: "webchat",
  resolveRecipient(_input: RecipientInput): string {
    return WEBCHAT_RECIPIENT;
  },
  isConfigured(): boolean {
    return true;
  },
  async send(envelope: OutboundEnvelope): Promise<{ externalId: string | null }> {
    if (envelope.beforeSend) await envelope.beforeSend();
    // Sem transporte: a linha já está em `messages`; o id externo é o carimbo
    // desta entrega, único por chamada, para o chamador marcar `sent`.
    return { externalId: `webchat:${randomUUID()}` };
  },
  /**
   * O cron de saúde pergunta a TODO adapter registrado (a régua
   * `saude-dos-canais-oficiais` cobra); este canal não tem transporte que caia:
   * a "sessão" é a linha por organização, e ela está de pé enquanto existir.
   */
  async checkHealth(_input: ChannelTenantScope & { sessionRef: string }): Promise<ChannelHealth> {
    return { reachable: true, status: "WORKING", detail: null };
  },
  codes: {
    notConfigured: "webchat_not_configured",
    sendFailed: "webchat_send_failed",
    unknownError: "webchat_unknown_error",
  },
};
