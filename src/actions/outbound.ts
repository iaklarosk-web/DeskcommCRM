/**
 * O caminho de SAÍDA das Actions (§5.7/§5.8, F03-T06/T07/T08).
 *
 * ⚠️ ESTE É O ÚNICO ARQUIVO DO PRODUTO QUE CHAMA `adapter.send`. O invariante 3
 * de §5.7 (`grep -rn "\.send(" src/ | grep -v src/actions/`) é medido em
 * `tests/integration/f03-saida.test.ts`. Quem precisar enviar chama `execute()`
 * ou `entregarSaida()`; nunca `getSaasAdapter(...).send` direto.
 *
 * Saiu de `execute.ts` na F04-T01 sem uma linha de comportamento alterada: lá
 * ficou a POLÍTICA (catálogo, executor, confirmação, auditoria), que agora
 * atende dez Actions; aqui ficou o efeito de canal, que é de uma só.
 *
 * ─── Por que `execute()` NÃO envia ─────────────────────────────────────────
 *
 * `execute()` valida, guarda o estado, grava a mensagem em `queued` e ENFILEIRA.
 * O envio é do worker (`src/jobs/outbound-worker.ts`), que chama
 * `entregarSaida()` — aqui mesmo. Enviar dentro do `execute()` reproduziria o
 * envio síncrono herdado (`app/api/v1/messages/_handler.ts:577-821`): sem lugar
 * para registrar tentativa, sem backoff e sem `blocked`, que é o que F03-T07/T08
 * existem para dar.
 */
import { getSaasAdapter } from "@/src/channels";
import type { SaasChannelAdapter, SaasChannelProvider } from "@/src/channels/contract";
import { isConversationState, type ConversationState } from "@/src/conversation";
import { enqueue } from "@/src/jobs/enqueue";
import { incrementCounter } from "@/src/obs/counters";
import type { ServicePool } from "@/src/tenant-context/db";
import { withTenant, type TenantCtx } from "@/src/tenant-context";

import { conversaAceitaEnvio, type ActionExecutor } from "./catalog";
import type { SendMessageOutput } from "./schemas";

export interface OutboundDeps {
  pool?: ServicePool;
  /** Seams de `getSaasAdapter` — a prova injeta o adapter em vez do ambiente. */
  adapters?: Partial<Record<SaasChannelProvider, SaasChannelAdapter>>;
  modo?: string;
}

/** A mensagem já gravada que o worker tem de pôr no fio. */
export interface EntregaDeSaida {
  readonly conversation_id: string;
  readonly message_id: string;
  readonly to_e164: string;
  readonly provider: SaasChannelProvider;
  readonly account_key: string | null;
  readonly idempotency_key: string;
}

/** A linha de saída sumiu ou está num estado que não comporta envio. */
export class MensagemDeSaidaAusente extends Error {
  constructor(public readonly messageId: string) {
    super(`mensagem de saída não encontrada em estado enviável: ${messageId}`);
    this.name = "MensagemDeSaidaAusente";
  }
}

/** Os status de `messages` de onde um envio pode (re)partir. */
const STATUS_ENVIAVEIS = ["queued", "sending", "failed"] as const;

/** Os status que provam que a mensagem JÁ saiu — reenviar seria duplicar. */
const STATUS_JA_ENVIADOS = ["sent", "delivered", "read"] as const;

/**
 * O que a marcação `queued → sending` descobriu. União discriminada porque os
 * dois desfechos levam o worker por caminhos diferentes, e um objeto com campos
 * opcionais deixaria "já enviada sem id" ser representável.
 */
type MarcacaoDeEnvio =
  | { readonly ja_enviada: false; readonly body: string }
  | { readonly ja_enviada: true; readonly provider_message_id: string };

const SENT_VIA_POR_EXECUTOR: Record<ActionExecutor, string> = {
  human: "crm",
  ai: "ai",
  automation: "automation",
};

/** As recusas que o caminho de saída sabe produzir — etiquetas, nunca frases. */
export type MotivoDeRecusaDeEnvio =
  | "conversation_not_found"
  | "conversation_closed"
  | "contact_without_phone"
  | "channel_account_missing";

export type ResultadoDeEnvio =
  | { readonly ok: true; readonly output: SendMessageOutput }
  | {
      readonly ok: false;
      readonly reason: MotivoDeRecusaDeEnvio;
      readonly resourceId: string | null;
    };

interface ConversaDeSaida {
  saas_state: string;
  contact_id: string;
  channel_session_id: string;
  phone_number: string | null;
  account_key: string | null;
  provider: string | null;
}

export interface PedidoDeEnvio {
  readonly conversation_id: string;
  readonly body: string;
  readonly idempotency_key?: string;
}

/**
 * Grava a mensagem em `queued` e enfileira o job de saída.
 *
 * Ordem deliberada: guarda de estado ANTES da escrita — descobrir no meio que a
 * conversa está arquivada deixaria mensagem gravada sem job. A leitura de
 * política acontece fora da transação de escrita: a recusa tem de ser barata e
 * não pode deixar rastro de escrita pela metade.
 */
export async function enviarMensagem(
  ctx: TenantCtx,
  executor: ActionExecutor,
  userId: string | null,
  pedido: PedidoDeEnvio,
  deps: OutboundDeps = {},
): Promise<ResultadoDeEnvio> {
  const conversa = await withTenant(
    ctx,
    async (db) => {
      const linha = await db.query<ConversaDeSaida>(
        `select c.saas_state, c.contact_id, c.channel_session_id,
                ct.phone_number, ca.account_key, ca.provider
           from public.conversations c
           join public.contacts ct
             on ct.id = c.contact_id and ct.organization_id = c.organization_id
           left join public.channel_accounts ca
             on ca.channel_session_id = c.channel_session_id
            and ca.organization_id = c.organization_id
            and ca.status = 'active'
          where c.id = $1 and c.organization_id = $2`,
        [pedido.conversation_id, ctx.organization_id],
      );
      return linha.rows[0] ?? null;
    },
    { pool: deps.pool },
  );

  if (conversa === null) {
    return { ok: false, reason: "conversation_not_found", resourceId: null };
  }

  const estado: ConversationState | null = isConversationState(conversa.saas_state)
    ? conversa.saas_state
    : null;
  if (estado === null || !conversaAceitaEnvio(estado)) {
    return {
      ok: false,
      reason: "conversation_closed",
      resourceId: pedido.conversation_id,
    };
  }
  if (conversa.phone_number === null || conversa.phone_number.length === 0) {
    return {
      ok: false,
      reason: "contact_without_phone",
      resourceId: pedido.conversation_id,
    };
  }
  if (conversa.account_key === null || conversa.provider === null) {
    // Fail-closed (G-27): sem conta de canal ativa não há por onde sair, e
    // inventar um provider default mandaria a mensagem pela sessão errada.
    return {
      ok: false,
      reason: "channel_account_missing",
      resourceId: pedido.conversation_id,
    };
  }

  const provider = conversa.provider as SaasChannelProvider;

  // A mensagem nasce `queued` — o vocabulário herdado de `messages.status` já
  // tem o valor (baseline.sql:1665); F03 não inventa estado nenhum.
  const gravada = await withTenant(
    ctx,
    async (db) => {
      const linha = await db.query<{ id: string }>(
        `insert into public.messages
           (organization_id, conversation_id, channel_session_id, contact_id,
            type, direction, status, body, sent_via, sent_by_user_id, metadata)
         values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'text','outbound','queued',
                 $5::text,$6::text,$7::uuid,$8::jsonb)
        returning id`,
        [
          ctx.organization_id,
          pedido.conversation_id,
          conversa.channel_session_id,
          conversa.contact_id,
          pedido.body,
          SENT_VIA_POR_EXECUTOR[executor],
          userId,
          JSON.stringify({ provider, account_key: conversa.account_key }),
        ],
      );
      const id = linha.rows[0]?.id;
      if (id === undefined) throw new Error("insert de mensagem de saída não devolveu id");
      return id;
    },
    { pool: deps.pool },
  );

  const idempotencyKey = pedido.idempotency_key ?? gravada;

  const fila = await enqueue(
    ctx,
    "outbound_message",
    {
      organization_id: ctx.organization_id,
      conversation_id: pedido.conversation_id,
      message_id: gravada,
      to_e164: conversa.phone_number,
      provider,
      account_key: conversa.account_key,
      idempotency_key: idempotencyKey,
    },
    { pool: deps.pool },
  );

  return {
    ok: true,
    output: { message_id: gravada, job_id: fila.job_id, enqueued: fila.created },
  };
}

/**
 * A ENTREGA — chamada pelo worker de saída, uma vez por tentativa.
 *
 * Três passos, em três transações curtas de propósito: `sending` commitado
 * ANTES da chamada externa (senão uma queda no meio deixaria a mensagem em
 * `queued` sem ninguém saber que ela já foi ao fio), a chamada ao adapter FORA
 * de transação (segurar conexão durante I/O de rede é como um pool de 4 morre),
 * e `sent` commitado depois.
 */
export async function entregarSaida(
  ctx: TenantCtx,
  entrega: EntregaDeSaida,
  deps: OutboundDeps = {},
): Promise<{ provider_message_id: string; ja_enviada: boolean }> {
  const marcacao: MarcacaoDeEnvio = await withTenant(
    ctx,
    async (db) => {
      const marcada = await db.query<{ body: string | null }>(
        `update public.messages
            set status = 'sending', updated_at = now()
          where id = $1 and organization_id = $2 and status = any($3::text[])
        returning body`,
        [entrega.message_id, ctx.organization_id, [...STATUS_ENVIAVEIS]],
      );
      const linha = marcada.rows[0];
      if (linha !== undefined) return { ja_enviada: false, body: linha.body ?? "" };

      // Não deu para marcar: ou a mensagem já saiu (reprocessamento do MESMO
      // job depois de um crash entre o envio e o commit), ou ela não existe.
      // Os dois casos são diferentes e só um deles é defeito.
      const atual = await db.query<{ status: string; external_id: string | null }>(
        `select status, external_id from public.messages
          where id = $1 and organization_id = $2`,
        [entrega.message_id, ctx.organization_id],
      );
      const linhaAtual = atual.rows[0];
      if (
        linhaAtual !== undefined &&
        (STATUS_JA_ENVIADOS as readonly string[]).includes(linhaAtual.status)
      ) {
        return { ja_enviada: true, provider_message_id: linhaAtual.external_id ?? "" };
      }
      throw new MensagemDeSaidaAusente(entrega.message_id);
    },
    { pool: deps.pool },
  );

  if (marcacao.ja_enviada) {
    incrementCounter("outbound_reenvio_evitado", { provider: entrega.provider });
    return { provider_message_id: marcacao.provider_message_id, ja_enviada: true };
  }

  const adapter = getSaasAdapter(entrega.provider, {
    adapters: deps.adapters,
    modo: deps.modo,
  });

  const { provider_message_id } = await adapter.send(ctx, {
    organization_id: ctx.organization_id,
    conversation_id: entrega.conversation_id,
    to_e164: entrega.to_e164,
    body: marcacao.body,
    idempotency_key: entrega.idempotency_key,
    account_key: entrega.account_key,
  });

  await withTenant(
    ctx,
    async (db) => {
      // `provider` é o do ADAPTER que de fato enviou, não o do payload: sob
      // `WHATSAPP_MODE=mock` o `getSaasAdapter` devolve o mock qualquer que seja
      // o pedido (D12), e gravar `waha` numa linha que saiu pelo mock faria o
      // webhook de status procurar a mensagem pelo par errado.
      await db.query(
        `update public.messages
            set status = 'sent', external_id = $3, provider = $4,
                sent_at = now(), updated_at = now()
          where id = $1 and organization_id = $2`,
        [entrega.message_id, ctx.organization_id, provider_message_id, adapter.provider],
      );
    },
    { pool: deps.pool },
  );

  incrementCounter("outbound_sent", { provider: adapter.provider });
  return { provider_message_id, ja_enviada: false };
}
