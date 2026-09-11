/**
 * `recebeEntrada` — o pipeline de entrada do SaaS (F03-T03/T04/T05, ADR-017).
 *
 * É o único código que transforma um POST de webhook em linhas do CRM pelo
 * caminho novo. A rota (`app/api/v1/webhooks/saas/[provider]/route.ts`) só
 * traduz o resultado daqui em status HTTP: quem decide o que é recusa, o que é
 * quarentena e o que é reentrega é este arquivo, para que a mesma decisão possa
 * ser provada sem servidor no ar (G-41).
 *
 * ─── A escolha de arquitetura, escrita para quem chegar depois ─────────────
 *
 * Este caminho escreve por `withTenant` + SQL, chamando as RPCs HERDADAS
 * (`fn_upsert_wa_contact`, `fn_upsert_wa_conversation`, `fn_service_inbound`),
 * e NÃO pelo cliente Supabase JS. Dois motivos medidos:
 *
 *  1. a suíte de integração tem um Postgres real e nenhuma API Supabase, então
 *     um caminho escrito em `supabase-js` só teria prova contra um dublê;
 *  2. é assim que a camada `src/` da F02 já escreve (`src/crm/orders/service.ts`),
 *     e um segundo idioma de escrita seria a segunda fila do agent-engine de novo.
 *
 * A consequência que este arquivo respeita: os efeitos pós-entrada herdados
 * (`lib/channels/pos-entrada.ts` — opt-out, demanda, campanha, despacho) **não
 * são reimplementados aqui**. Reimplementá-los criaria duas cópias da ordem de
 * negócio que aquele arquivo documenta linha a linha, e elas divergiriam no
 * primeiro conserto feito num lado só. Em vez disso:
 *
 *  - `fn_service_inbound` é chamada, e é ela quem preserva reabertura, demanda
 *    e revisão de serviço;
 *  - o MESMO evento que a rota herdada publica no barramento
 *    (`ai_agent.dispatch_requested`, `lib/channels/pos-entrada.ts:305-318`) é
 *    publicado aqui, com o MESMO payload campo a campo, para que o pipeline
 *    assíncrono existente continue a valer sem saber por qual porta a mensagem
 *    entrou.
 *
 * ─── Ordem dos efeitos, e a única divergência da ordem escrita no desenho ──
 *
 * O desenho lista `fn_service_inbound` antes do INSERT. Não é possível: a RPC
 * declara no próprio comentário do baseline que "só recebe ID de mensagem
 * persistida" (`supabase/baseline.sql`, `fn_service_inbound(p_message uuid)`).
 * Ela é chamada logo DEPOIS do INSERT, e só quando o INSERT criou linha —
 * numa reentrega não há mensagem nova, e reprocessar a demanda a partir de uma
 * linha antiga é exatamente o que a idempotência existe para impedir.
 *
 * ─── Por que a transição roda DENTRO da mesma transação ───────────────────
 *
 * `transition()` abre o próprio `withTenant`. Chamada com o pool de produção,
 * ela pediria uma SEGUNDA conexão e ficaria bloqueada no `for no key update` da
 * conversa que ESTA transação acabou de travar — um impasse que só se resolve
 * por timeout. `poolNaTransacao()` abaixo entrega a `transition()` a MESMA
 * sessão, traduzindo `begin/commit/rollback` em savepoints: o movimento D16
 * fica atômico com a mensagem (ou entram as duas, ou nenhuma) e nenhuma
 * conexão nova é pedida.
 */
import { randomUUID } from "node:crypto";

import { incrementCounter } from "@/src/obs/counters";
import {
  transition,
  type ConversationState,
  type TransitionEffect,
} from "@/src/conversation";
import { fromWebhook, withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";

import {
  foiRejeitado,
  type AckStatus,
  type HeaderBag,
  type InboundEvent,
  type RejectReason,
  type SaasChannelAdapter,
  type SaasChannelProvider,
} from "./contract";
import { getSaasAdapter } from "./index";

/**
 * O tipo de evento do barramento. Literal COPIADO de
 * `lib/channels/pos-entrada.ts:305` — mesmo nome, mesmo `entity_kind`, mesmo
 * payload. Um nome próprio aqui faria o consumidor
 * (`lib/agent-engine/edge/crm/drain.ts`) ignorar tudo o que entra pela porta
 * nova, que é o defeito medido "QR 806 despachos, oficial 0" que aquele arquivo
 * existe para não repetir.
 */
const EVENTO_DE_DESPACHO = "ai_agent.dispatch_requested";

/**
 * Aviso de que o cliente respondeu enquanto a conversa está com gente. É o
 * efeito `notify_customer_replied_while_human` da tabela D16, e o barramento é
 * o portador: `event_log` já é o canal de notificação de §5.13, e inventar uma
 * segunda substância de aviso nesta task criaria mecanismo sem consumidor.
 */
const EVENTO_DE_RESPOSTA_COM_HUMANO = "conversation.customer_replied_while_human";

/** Quando nem o `account_key` deu para ler — a coluna de quarentena é NOT NULL. */
const ACCOUNT_KEY_AUSENTE = "(sem account_key)";

/** Motivos de quarentena: os do parser (enum de §5.7) mais os desta camada. */
export type MotivoDeQuarentena = RejectReason | "unknown_account";

export type ResultadoDaEntrada =
  /** Sem segredo de assinatura: a rota responde 503 e conta (G-27). */
  | { readonly status: "sem_credencial"; readonly provider: SaasChannelProvider }
  /** Assinatura inválida: 401 e ZERO escritas. */
  | { readonly status: "assinatura_invalida"; readonly provider: SaasChannelProvider }
  /** Evento sem dono ou fora do contrato: 1 linha em quarentena, 202. */
  | { readonly status: "quarentena"; readonly reason: MotivoDeQuarentena }
  /** A conta existe mas não aponta sessão herdada — configuração incompleta. */
  | { readonly status: "sem_sessao_de_canal" }
  | {
      readonly status: "ingerido";
      readonly conversation_id: string;
      readonly message_id: string;
      readonly saas_state: ConversationState;
    }
  /** A linha já existia: reentrega reconhecida, nada escrito, 200. */
  | { readonly status: "duplicado"; readonly provider_message_id: string }
  | {
      readonly status: "ack_aplicado";
      readonly provider_message_id: string;
      readonly ack_status: AckStatus;
    }
  | { readonly status: "ack_sem_mensagem"; readonly provider_message_id: string }
  /** O payload era válido e não continha nenhum evento a processar. */
  | { readonly status: "sem_evento" };

export interface RecebeEntradaDeps {
  pool?: ServicePool;
  /** Seams de `getSaasAdapter` — a prova injeta o adapter em vez do ambiente. */
  adapters?: Partial<Record<SaasChannelProvider, SaasChannelAdapter>>;
  modo?: string;
  /** Correlaciona a auditoria com a request (ADR-015). */
  requestId?: string;
}

/**
 * O `ServicePool` de mentira que devolve SEMPRE a sessão que já está aberta.
 *
 * `begin` vira `savepoint`, `commit` vira `release savepoint`, `rollback` vira
 * `rollback to savepoint` — a semântica de transação aninhada que o Postgres
 * tem de verdade. `release()` é no-op: a sessão é de quem a abriu.
 *
 * Sem isto, `transition()` (e as guardas, que também chamam `withTenant`)
 * pediriam conexão nova e travariam no `for no key update` da conversa que a
 * transação de fora acabou de travar.
 */
function poolNaTransacao(db: TenantDb): ServicePool {
  let profundidade = 0;
  const pilha: string[] = [];

  const query = async (texto: unknown, valores?: unknown): Promise<unknown> => {
    if (typeof texto === "string") {
      const comando = texto.trim().toLowerCase();
      if (comando === "begin") {
        profundidade += 1;
        const nome = `sp_entrada_${profundidade}`;
        pilha.push(nome);
        return db.query(`savepoint ${nome}`);
      }
      if (comando === "commit") {
        const nome = pilha.pop();
        if (nome === undefined) throw new Error("commit sem savepoint correspondente");
        return db.query(`release savepoint ${nome}`);
      }
      if (comando === "rollback") {
        const nome = pilha.pop();
        if (nome === undefined) throw new Error("rollback sem savepoint correspondente");
        return db.query(`rollback to savepoint ${nome}`);
      }
    }
    return db.query(texto as never, valores as never);
  };

  const cliente = { query, release: () => {} };
  return {
    connect: async () => cliente,
    query,
  } as unknown as ServicePool;
}

/**
 * Executor dos efeitos que ESTA task cumpre.
 *
 * `append_message` já aconteceu quando `transition()` roda — a linha de
 * `messages` foi gravada dois passos acima —, então o executor confirma o
 * efeito em vez de repetir a escrita. `notify_customer_replied_while_human`
 * vira uma linha no barramento. Os demais efeitos da tabela D16 NÃO são
 * tratados aqui e continuam levantando o erro tipado de `transition()`: quem
 * não tem executor tem de falhar alto, não sumir.
 */
function executorDeEfeitosDaEntrada(
  organizationId: string,
  conversationId: string,
  contactId: string,
  messageId: string,
) {
  return async (
    db: TenantDb,
    _ctx: TenantCtx,
    _conversationId: string,
    effect: TransitionEffect,
  ): Promise<boolean> => {
    if (effect === "append_message") return true;
    if (effect === "notify_customer_replied_while_human") {
      await db.query(
        `select public.emit_event($1::text,$2::text,$3::uuid,$4::jsonb,$5::jsonb,$6::uuid)`,
        [
          EVENTO_DE_RESPOSTA_COM_HUMANO,
          "conversation",
          conversationId,
          JSON.stringify({
            organization_id: organizationId,
            conversation_id: conversationId,
            contact_id: contactId,
            inbound_message_id: messageId,
          }),
          JSON.stringify({ severity: "warn", source: "webhook_saas" }),
          organizationId,
        ],
      );
      return true;
    }
    return false;
  };
}

/** O tipo de `messages` derivado do que o evento traz. Sem mídia é texto. */
export function tipoDaMensagem(evento: InboundEvent): string {
  const mime = evento.media[0]?.mime ?? null;
  if (evento.media.length === 0) return "text";
  if (mime === null) return "document";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

/** O `lid` do remetente, quando o endereço do provedor for `@lid`. */
function lidDoRemetente(evento: InboundEvent): string | null {
  const jid = evento.sender_raw_jid;
  if (jid === null || !jid.endsWith("@lid")) return null;
  return jid.slice(0, jid.indexOf("@"));
}

interface DepsDaQuarentena {
  pool?: ServicePool;
}

/**
 * Uma linha em `webhook_quarantine` e um contador. Nunca um descarte mudo: o
 * motivo é enum (G-78/D19) justamente para ser contável.
 *
 * Escreve com o pool de serviço direto (fora de `withTenant`) porque, por
 * definição, aqui NÃO há tenant resolvido — é isso que a quarentena registra.
 */
async function quarentenar(
  provider: SaasChannelProvider,
  accountKey: string,
  payload: unknown,
  reason: MotivoDeQuarentena,
  deps: DepsDaQuarentena,
): Promise<void> {
  const { getServicePool } = await import("@/src/tenant-context/db");
  const pool = deps.pool ?? (await getServicePool());
  await pool.query(
    `insert into public.webhook_quarantine (provider, account_key, payload, reason)
     values ($1,$2,$3::jsonb,$4)`,
    [provider, accountKey, payload === undefined ? null : JSON.stringify(payload), reason],
  );
  incrementCounter("webhook_quarantined", { provider, reason });
}

/** `sent → delivered → read`: um ack nunca rebaixa o que já se sabe. */
const ORDEM_DO_ACK: readonly AckStatus[] = ["sent", "delivered", "read"];

async function aplicarAck(
  ctx: TenantCtx,
  provider: SaasChannelProvider,
  evento: InboundEvent,
  deps: RecebeEntradaDeps,
): Promise<ResultadoDaEntrada> {
  const alvo = evento.ack_status;
  if (alvo === null) return { status: "sem_evento" };

  const posicao = ORDEM_DO_ACK.indexOf(alvo);
  const menores = ORDEM_DO_ACK.slice(0, posicao + 1);

  return withTenant(
    ctx,
    async (db) => {
      const atualizada = await db.query<{ id: string }>(
        `update public.messages
            set status = $4,
                delivered_at = case when $4 in ('delivered','read')
                                    then coalesce(delivered_at, now()) else delivered_at end,
                read_at = case when $4 = 'read' then coalesce(read_at, now()) else read_at end,
                updated_at = now()
          where organization_id = $1
            and external_id = $2
            and (provider = $3 or provider is null)
            and status = any($5::text[])
        returning id`,
        [ctx.organization_id, evento.provider_message_id, provider, alvo, menores],
      );
      if (atualizada.rows.length > 0) {
        return {
          status: "ack_aplicado",
          provider_message_id: evento.provider_message_id,
          ack_status: alvo,
        } as const;
      }
      // Duas causas com o MESMO desfecho e nomes diferentes seria pior que uma
      // etiqueta só: aqui interessa que o ack não encontrou o que atualizar —
      // mensagem inexistente ou já em estado igual/superior.
      incrementCounter("webhook_ack_sem_mensagem", { provider });
      return {
        status: "ack_sem_mensagem",
        provider_message_id: evento.provider_message_id,
      } as const;
    },
    { pool: deps.pool },
  );
}

async function ingerirMensagem(
  ctx: TenantCtx,
  provider: SaasChannelProvider,
  accountKey: string,
  evento: InboundEvent,
  deps: RecebeEntradaDeps,
): Promise<ResultadoDaEntrada> {
  const requestId = deps.requestId ?? randomUUID();

  return withTenant(
    ctx,
    async (db) => {
      // A sessão herdada por onde esta conta fala. `conversations` e `messages`
      // a exigem NOT NULL, e adivinhá-la escreveria na sessão errada no
      // primeiro tenant com dois números.
      const conta = await db.query<{ channel_session_id: string | null }>(
        `select channel_session_id from public.channel_accounts
          where provider = $1 and account_key = $2 and organization_id = $3 and status = 'active'`,
        [provider, accountKey, ctx.organization_id],
      );
      const channelSessionId = conta.rows[0]?.channel_session_id ?? null;
      if (channelSessionId === null) {
        incrementCounter("webhook_conta_sem_sessao", { provider });
        return { status: "sem_sessao_de_canal" } as const;
      }

      const contato = await db.query<{ fn_upsert_wa_contact: string | null }>(
        `select public.fn_upsert_wa_contact($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text)`,
        [
          ctx.organization_id,
          evento.sender_e164 === null ? "lid" : "phone",
          evento.sender_e164,
          lidDoRemetente(evento),
          evento.sender_raw_jid,
          null,
        ],
      );
      const contactId = contato.rows[0]?.fn_upsert_wa_contact ?? null;
      if (contactId === null) {
        throw new Error("fn_upsert_wa_contact não devolveu contato para a entrada do webhook");
      }

      // O lock por (org, contato) vem DEPOIS do contato e ANTES da conversa,
      // como no herdado: é ele que serializa duas entregas simultâneas da mesma
      // pessoa, e pedi-lo antes de saber quem é seria travar o nada.
      await db.query(`select public.fn_service_lock($1::uuid,$2::uuid)`, [
        ctx.organization_id,
        contactId,
      ]);

      const conversa = await db.query<{ fn_upsert_wa_conversation: string | null }>(
        `select public.fn_upsert_wa_conversation($1::uuid,$2::uuid,$3::uuid)`,
        [ctx.organization_id, contactId, channelSessionId],
      );
      const conversationId = conversa.rows[0]?.fn_upsert_wa_conversation ?? null;
      if (conversationId === null) {
        throw new Error("fn_upsert_wa_conversation não devolveu conversa para a entrada do webhook");
      }

      const midia = evento.media[0] ?? null;
      // ─── O ÁRBITRO da reentrega, nomeado ─────────────────────────────────
      //
      // Quem recusa a segunda linha é o ÍNDICE
      // (`messages_org_provider_external_uk`, migration 9015), nunca um
      // `select` antes do `insert`: entre a leitura e a escrita cabe a segunda
      // entrega do provedor, e essa janela é justamente o caso que a
      // idempotência existe para cobrir.
      //
      // A tripla é NOMEADA porque a forma sem alvo não existe nesta tabela:
      // `messages` tem a constraint herdada `messages_org_external_id_unique`,
      // que é DEFERRABLE, e o Postgres recusa `on conflict do nothing` sem alvo
      // quando há constraint diferível ("ON CONFLICT does not support
      // deferrable unique constraints as arbiters" — medido, não suposto). A
      // herdada continua valendo no commit, como sempre valeu; ela é que nunca
      // pode ser árbitro.
      const inserida = await db.query<{ id: string }>(
        `insert into public.messages
           (organization_id, conversation_id, channel_session_id, contact_id,
            external_id, provider, type, direction, status, body,
            media_url, media_mime, sent_via, sent_at, delivered_at, metadata)
         values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,
                 'inbound','delivered',$8::text,$9::text,$10::text,'external_device',
                 $11::timestamptz, now(), $12::jsonb)
         on conflict (organization_id, provider, external_id)
           where provider is not null and external_id is not null
           do nothing
        returning id`,
        [
          ctx.organization_id,
          conversationId,
          channelSessionId,
          contactId,
          evento.provider_message_id,
          provider,
          tipoDaMensagem(evento),
          evento.body,
          midia === null ? null : midia.ref,
          midia === null ? null : midia.mime,
          evento.sent_at.toISOString(),
          // Ponteiro e rótulos, nunca o payload: `raw_ref` é a tripla que
          // encontra o corpo arquivado (contract.ts), e copiar o corpo faria
          // toda leitura de `messages` herdar dado de cliente que não pediu.
          JSON.stringify({ provider, raw_ref: evento.raw_ref, account_key: accountKey }),
        ],
      );

      const messageId = inserida.rows[0]?.id ?? null;
      if (messageId === null) {
        // Reentrega. Não grava, não transiciona: o provedor reenviou o MESMO
        // evento, e mover a conversa de novo faria uma retentativa de rede
        // virar movimento de máquina de estados.
        incrementCounter("webhook_replay_ignored", { provider });
        return {
          status: "duplicado",
          provider_message_id: evento.provider_message_id,
        } as const;
      }

      // Reabertura, demanda e revisão de serviço são DELA. Só aceita id de
      // mensagem persistida, por isso vem depois do INSERT.
      await db.query(`select public.fn_service_inbound($1::uuid)`, [messageId]);

      const movimento = await transition(
        ctx,
        conversationId,
        "inbound.message",
        { kind: "system" },
        {
          pool: poolNaTransacao(db),
          effects: executorDeEfeitosDaEntrada(
            ctx.organization_id,
            conversationId,
            contactId,
            messageId,
          ),
        },
      );

      // O MESMO evento da rota herdada, com o MESMO payload campo a campo
      // (`lib/channels/pos-entrada.ts:305-318`). É o que faz opt-out, demanda,
      // campanha e despacho continuarem valendo sem serem reimplementados.
      await db.query(
        `select public.emit_event($1::text,$2::text,$3::uuid,$4::jsonb,$5::jsonb,$6::uuid)`,
        [
          EVENTO_DE_DESPACHO,
          "message",
          messageId,
          JSON.stringify({
            organization_id: ctx.organization_id,
            conversation_id: conversationId,
            contact_id: contactId,
            channel_session_id: channelSessionId,
            inbound_message_id: messageId,
          }),
          JSON.stringify({ source: `webhook_saas:${provider}`, request_id: requestId }),
          ctx.organization_id,
        ],
      );

      await db.query(
        `insert into public.api_audit_log
           (organization_id, action, resource_type, resource_id, request_id, bypassed_rls, metadata)
         values ($1::uuid,'message.received','messages',$2::uuid,$3::text,true,$4::jsonb)`,
        [
          ctx.organization_id,
          messageId,
          requestId,
          JSON.stringify({
            provider,
            conversation_id: conversationId,
            saas_state: movimento.to,
          }),
        ],
      );

      return {
        status: "ingerido",
        conversation_id: conversationId,
        message_id: messageId,
        saas_state: movimento.to,
      } as const;
    },
    { pool: deps.pool },
  );
}

/**
 * O pipeline inteiro, do corpo cru às linhas do CRM.
 *
 * `rawBody` é o corpo EXATO que chegou — a assinatura é sobre bytes, e
 * re-serializar o JSON antes de verificar trocaria o que se assina pelo que se
 * entende.
 */
export async function recebeEntrada(
  provider: SaasChannelProvider,
  rawBody: string | Buffer,
  headers: HeaderBag,
  deps: RecebeEntradaDeps = {},
): Promise<ResultadoDaEntrada> {
  const adapter = getSaasAdapter(provider, { adapters: deps.adapters, modo: deps.modo });
  const bytes = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");

  // 1 · Sem segredo não há como VERIFICAR: 503 e contador, nunca 200 a evento
  // não verificado (G-27).
  if (!adapter.isConfigured()) {
    incrementCounter("webhook_sem_credencial", { provider });
    return { status: "sem_credencial", provider };
  }

  // 2 · Assinatura inválida: ZERO escritas. Nem quarentena — gravar o payload
  // de quem não provou ser o provedor daria a qualquer um uma tabela para
  // encher.
  if (!adapter.verifySignature(bytes, headers)) {
    incrementCounter("webhook_assinatura_invalida", { provider });
    return { status: "assinatura_invalida", provider };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bytes.toString("utf8"));
  } catch {
    // Corpo assinado que não é JSON: o fio mudou, e isso é investigável.
    await quarentenar(provider, ACCOUNT_KEY_AUSENTE, null, "unsupported_event", deps);
    return { status: "quarentena", reason: "unsupported_event" };
  }

  // 3 · A conta que o payload nomeia. Sem ela não há tenant a resolver.
  const accountKey = adapter.resolveAccountKey(payload);
  if (accountKey === null || accountKey.length === 0) {
    await quarentenar(provider, ACCOUNT_KEY_AUSENTE, payload, "missing_account_key", deps);
    return { status: "quarentena", reason: "missing_account_key" };
  }

  // 4 · O tenant vem de `channel_accounts`, NUNCA do payload. Sem match,
  // `fromWebhook` já grava a quarentena e conta — a rota responde 202.
  let ctx: TenantCtx;
  try {
    ctx = await fromWebhook(provider, accountKey, payload, { pool: deps.pool });
  } catch {
    return { status: "quarentena", reason: "unknown_account" };
  }

  // 5 · O contrato do payload. Recusa é CONTADA por causa, nunca descartada.
  const lido = adapter.parseInbound(payload);
  if (foiRejeitado(lido)) {
    await quarentenar(provider, accountKey, payload, lido.reason, deps);
    return { status: "quarentena", reason: lido.reason };
  }

  let resultado: ResultadoDaEntrada = { status: "sem_evento" };
  for (const evento of lido.events) {
    resultado =
      evento.kind === "ack"
        ? await aplicarAck(ctx, provider, evento, deps)
        : await ingerirMensagem(ctx, provider, accountKey, evento, deps);
  }
  return resultado;
}
