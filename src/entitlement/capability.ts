/**
 * As 6 Capabilities da Fase 1 (§5.3, D14). O enum existe para que nenhum outro
 * módulo invente a pergunta "posso?": quem quer exercer algo nomeia a
 * capability e pergunta ao entitlement — mesmo que hoje a resposta seja sempre
 * sim. Nova capability = 1 valor aqui.
 */
export const CAPABILITIES = [
  "ai.reply",
  "ai.embedding",
  "ai.summary",
  "channel.whatsapp.send",
  "users.invite",
  "knowledge.ingest",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface EntitlementResposta {
  allowed: boolean;
  remaining: number | null;
  reason: string;
}
