/**
 * A mensagem do VISITANTE entrando no CRM (F14, ADR-038 §2 T01).
 *
 * Espelha `ingerirMensagem` do WhatsApp a partir do ponto em que a mensagem
 * existe: grava a linha em `messages` (inbound, `provider='webchat'`,
 * `external_id` = id que o navegador gerou — é ele o árbitro da reentrega,
 * pelo índice `messages_org_provider_external_uk`) e entrega o resto a
 * `concluirEntrada` (fronteira, transição `inbound.message`, despacho da IA,
 * auditoria) — o MESMO fim de caminho de todo canal. Sessão não identificada
 * não fala: a decisão do proprietário é nome + contato antes da 1ª resposta.
 *
 * Os freios por IP/organização batem AQUI também (ADR-038 §6, objeção 2):
 * abrir sessão passou pelo freio, mas é a mensagem que dispara turno de IA.
 */
import { randomUUID } from "node:crypto";

import { concluirEntrada, type ResultadoDaEntrada } from "@/src/channels/inbound";
import { incrementCounter } from "@/src/obs/counters";
import { withTenant, type TenantCtx } from "@/src/tenant-context";

import { contagensDoFreio, decidirFreio, type MotivoDoFreio } from "./freios";
import type { SessaoDoVisitante, WebchatDeps } from "./sessao";

export type MotivoDeRecusaDaMensagem = "not_identified" | "empty_body" | "body_too_long" | MotivoDoFreio;

export type ResultadoDaMensagemDoVisitante =
  | { readonly ok: true; readonly entrada: Extract<ResultadoDaEntrada, { status: "ingerido" | "fora_da_fronteira" | "duplicado" }> }
  | { readonly ok: false; readonly reason: MotivoDeRecusaDaMensagem };

export const TAMANHO_MAXIMO_DA_MENSAGEM = 4000;

export interface MensagemDoVisitante {
  /** uuid gerado pelo navegador: mesma chave ⇒ mesma linha, sem segunda entrada. */
  readonly client_message_id: string;
  readonly body: string;
}

export async function receberMensagemDoVisitante(
  sessao: SessaoDoVisitante,
  mensagem: MensagemDoVisitante,
  deps: WebchatDeps & { requestId?: string } = {},
): Promise<ResultadoDaMensagemDoVisitante> {
  if (sessao.identified_at === null || sessao.conversation_id === null || sessao.contact_id === null) {
    return { ok: false, reason: "not_identified" };
  }
  const corpo = mensagem.body.trim();
  if (corpo.length === 0) return { ok: false, reason: "empty_body" };
  if (corpo.length > TAMANHO_MAXIMO_DA_MENSAGEM) return { ok: false, reason: "body_too_long" };
  const conversationId = sessao.conversation_id;
  const contactId = sessao.contact_id;
  const ctx: TenantCtx = { organization_id: sessao.organization_id, source: "webhook" };
  const requestId = deps.requestId ?? randomUUID();
  return withTenant(
    ctx,
    async (db) => {
      const freio = decidirFreio(await contagensDoFreio(db, ctx.organization_id, sessao.ip_hash));
      if (freio !== null) {
        incrementCounter("webchat_message_rejected", { reason: freio });
        return { ok: false, reason: freio } as const;
      }
      const canal = await db.query<{ channel_session_id: string }>(
        `select channel_session_id from public.conversations where id = $1 and organization_id = $2`,
        [conversationId, ctx.organization_id],
      );
      const channelSessionId = canal.rows[0]?.channel_session_id;
      if (channelSessionId === undefined) throw new Error("conversa do visitante sem sessão de canal");
      await db.query(`select public.fn_service_lock($1::uuid,$2::uuid)`, [ctx.organization_id, contactId]);
      const inserida = await db.query<{ id: string }>(
        `insert into public.messages
           (organization_id, conversation_id, channel_session_id, contact_id,
            external_id, provider, type, direction, status, body,
            sent_via, sent_at, delivered_at, metadata)
         values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,'webchat','text',
                 'inbound','delivered',$6::text,'external_device', now(), now(), $7::jsonb)
         on conflict (organization_id, provider, external_id)
           where provider is not null and external_id is not null
           do nothing
        returning id`,
        [ctx.organization_id, conversationId, channelSessionId, contactId, mensagem.client_message_id, corpo,
         JSON.stringify({ provider: "webchat", webchat_session_id: sessao.id })],
      );
      const messageId = inserida.rows[0]?.id ?? null;
      if (messageId === null) {
        incrementCounter("webchat_replay_ignored", {});
        return { ok: true, entrada: { status: "duplicado", provider_message_id: mensagem.client_message_id } } as const;
      }
      // A prévia, o "última entrada" e o não-lido da conversa — o que o inbox
      // lista. Desde a F18-T04 quem chama a RPC é `concluirEntrada`, para todo
      // canal (§B18) — aqui não é mais preciso chamá-la.
      incrementCounter("webchat_message_received", {});
      const entrada = await concluirEntrada(db, ctx, {
        provider: "webchat",
        conversationId,
        contactId,
        messageId,
        providerMessageId: mensagem.client_message_id,
        requestId,
        source: "webchat",
      });
      return { ok: true, entrada } as const;
    },
    { pool: deps.pool },
  );
}
