/**
 * A identificação do visitante (F14, ADR-038 §2 T01; decisão do proprietário:
 * nome + e-mail/telefone ANTES da primeira resposta, D55 c).
 *
 * O que acontece, numa transação:
 *  1. valida nome e contato (e-mail pelo mesmo formato que `contacts_email_format`
 *     aceita; telefone em E.164 como `contacts_phone_e164_format`);
 *  2. acha o contato da organização por e-mail normalizado ou telefone — ou o
 *     cria com `source='webchat'` (contato de VERDADE do CRM: o atendente o vê
 *     como qualquer outro; é o que evita o lead perdido e o contato vazio);
 *  3. garante a sessão de canal `webchat` da organização (uma por organização,
 *     `channel_sessions.provider='webchat'` + `channel_accounts`), criada sob
 *     demanda quando a primeira pessoa se identifica;
 *  4. abre (ou reencontra) a conversa `channel='webchat'` do contato nessa
 *     sessão — o mesmo índice `uniq_conversations_1to1_per_contact_session`
 *     do WhatsApp: visitante que volta continua a conversa;
 *  5. prende a sessão do visitante ao contato e à conversa (`identified_at`).
 *
 * O `webhook_secret_encrypted` da sessão de canal é bytes aleatórios sem uso:
 * a coluna herdada é NOT NULL e o webchat não tem webhook (ADR-038 §3).
 */
import { randomBytes } from "node:crypto";

import { incrementCounter } from "@/src/obs/counters";
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";

import { type SessaoDoVisitante, type WebchatDeps } from "./sessao";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const E164 = /^\+\d{8,15}$/;

export type MotivoDeRecusaDaIdentificacao = "invalid_name" | "invalid_contact" | "already_identified";

export type ResultadoDaIdentificacao =
  | { readonly ok: true; readonly contact_id: string; readonly conversation_id: string; readonly created_contact: boolean }
  | { readonly ok: false; readonly reason: MotivoDeRecusaDaIdentificacao };

/** Normaliza o que o visitante digitou: e-mail em minúsculas; telefone só dígitos com `+`. */
export function normalizarContato(bruto: string): { kind: "email" | "phone"; value: string } | null {
  const texto = bruto.trim();
  if (EMAIL.test(texto)) return { kind: "email", value: texto.toLowerCase() };
  const digitos = texto.replace(/[\s().-]/g, "");
  const e164 = digitos.startsWith("+") ? digitos : `+${digitos}`;
  if (E164.test(e164)) return { kind: "phone", value: e164 };
  return null;
}

/** A sessão de canal `webchat` da organização — cria na primeira vez. */
export async function garantirCanalWebchat(db: TenantDb, ctx: TenantCtx): Promise<string> {
  const chave = `webchat:${ctx.organization_id}`;
  const existente = await db.query<{ id: string }>(
    `select id from public.channel_sessions where organization_id = $1 and provider = 'webchat' and waha_session_name = $2 limit 1`,
    [ctx.organization_id, chave],
  );
  let sessionId = existente.rows[0]?.id ?? null;
  if (sessionId === null) {
    const criada = await db.query<{ id: string }>(
      `insert into public.channel_sessions (organization_id, waha_session_name, provider, webhook_secret_encrypted, status, display_name)
       values ($1::uuid, $2::text, 'webchat', $3::bytea, 'WORKING', 'Chat do site')
       returning id`,
      [ctx.organization_id, chave, randomBytes(32)],
    );
    sessionId = criada.rows[0]?.id ?? null;
    if (sessionId === null) throw new Error("insert de channel_sessions (webchat) não devolveu id");
  }
  await db.query(
    `insert into public.channel_accounts (organization_id, provider, account_key, channel_session_id)
     values ($1::uuid, 'webchat', $2::text, $3::uuid)
     on conflict (provider, account_key) do nothing`,
    [ctx.organization_id, chave, sessionId],
  );
  return sessionId;
}

async function contatoDoVisitante(
  db: TenantDb,
  ctx: TenantCtx,
  nome: string,
  contato: { kind: "email" | "phone"; value: string },
): Promise<{ id: string; created: boolean }> {
  const coluna = contato.kind === "email" ? "email_normalized" : "phone_number";
  const achado = await db.query<{ id: string }>(
    `select id from public.contacts where organization_id = $1 and ${coluna} = $2 and is_merged_into is null order by created_at asc limit 1`,
    [ctx.organization_id, contato.value],
  );
  const id = achado.rows[0]?.id;
  if (id !== undefined) return { id, created: false };
  const criado = await db.query<{ id: string }>(
    `insert into public.contacts (organization_id, name, display_name, email, phone_number, source, source_metadata)
     values ($1::uuid, $2::text, $2::text, $3::text, $4::text, 'webchat', '{"channel":"webchat"}'::jsonb)
     returning id`,
    [ctx.organization_id, nome, contato.kind === "email" ? contato.value : null, contato.kind === "phone" ? contato.value : null],
  );
  const novo = criado.rows[0]?.id;
  if (novo === undefined) throw new Error("insert de contacts (webchat) não devolveu id");
  return { id: novo, created: true };
}

export async function identificar(
  sessao: SessaoDoVisitante,
  entrada: { readonly name: string; readonly contact: string },
  deps: WebchatDeps = {},
): Promise<ResultadoDaIdentificacao> {
  const nome = entrada.name.trim();
  if (nome.length < 2 || nome.length > 120) return { ok: false, reason: "invalid_name" };
  const contato = normalizarContato(entrada.contact);
  if (contato === null) return { ok: false, reason: "invalid_contact" };
  if (sessao.identified_at !== null || sessao.conversation_id !== null) return { ok: false, reason: "already_identified" };
  const ctx: TenantCtx = { organization_id: sessao.organization_id, source: "webhook" };
  return withTenant(
    ctx,
    async (db) => {
      const canal = await garantirCanalWebchat(db, ctx);
      const pessoa = await contatoDoVisitante(db, ctx, nome, contato);
      // Serializa duas identificações simultâneas da mesma pessoa, como a entrada do WhatsApp.
      await db.query(`select public.fn_service_lock($1::uuid,$2::uuid)`, [ctx.organization_id, pessoa.id]);
      const conversa = await db.query<{ id: string }>(
        `insert into public.conversations (organization_id, contact_id, channel_session_id, channel, status, is_group, unread_count_for_assignee, metadata)
         values ($1::uuid, $2::uuid, $3::uuid, 'webchat', 'open', false, 0, '{"channel":"webchat"}'::jsonb)
         on conflict (organization_id, contact_id, channel_session_id) where is_group = false
         do update set updated_at = now()
         returning id`,
        [ctx.organization_id, pessoa.id, canal],
      );
      const conversationId = conversa.rows[0]?.id;
      if (conversationId === undefined) throw new Error("upsert de conversations (webchat) não devolveu id");
      await db.query(
        `update public.webchat_sessions
            set contact_id = $2, conversation_id = $3, visitor_name = $4, visitor_contact = $5, identified_at = now(), last_seen_at = now()
          where id = $1 and organization_id = $6`,
        [sessao.id, pessoa.id, conversationId, nome, contato.value, ctx.organization_id],
      );
      incrementCounter("webchat_visitor_identified", { created_contact: String(pessoa.created) });
      return { ok: true, contact_id: pessoa.id, conversation_id: conversationId, created_contact: pessoa.created } as const;
    },
    { pool: deps.pool },
  );
}
