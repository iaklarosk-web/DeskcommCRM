/**
 * O que o turno precisa saber da CONVERSA antes de pensar (§5.9, F04-T04).
 *
 * Duas leituras, as duas escopadas pelo `organization_id` do contexto ALÉM da
 * RLS: o estado atual da conversa (que decide se a IA sequer fala) e as últimas
 * mensagens (que são o único histórico que entra no prompt).
 *
 * ─── Por que a leitura mora aqui e não numa tool ───────────────────────────
 *
 * Uma tool é o que a IA PODE PEDIR; isto é o que ela RECEBE sem pedir. Pôr o
 * histórico no catálogo daria ao modelo a opção de não lê-lo — e um turno cujo
 * contexto depende de o modelo lembrar de buscá-lo não é reproduzível.
 *
 * ─── "Sem SQL livre" (D18) vale, e é isto que ele quer dizer ───────────────
 *
 * §5.9 proíbe o módulo de importar cliente Postgres e `fetch`. Aqui não há
 * nenhum dos dois: a porta é `withTenant` (§5.1, D20), a MESMA que
 * `src/knowledge/busca.ts` usa, e as duas consultas são parametrizadas e fixas.
 * SQL livre é SQL que o MODELO compõe; nada do que o cliente escreve chega a um
 * `$n` daqui a não ser como parâmetro, e nenhum texto dele entra na string.
 */
import { isConversationState, type ConversationState } from "@/src/conversation";
import type { ServicePool } from "@/src/tenant-context/db";
import { withTenant, type TenantCtx } from "@/src/tenant-context";

/** §5.9: "últimas 20 mensagens". O número é da DIRETRIZ, não uma escolha daqui. */
export const MENSAGENS_NO_CONTEXTO = 20;

export interface MensagemDoHistorico {
  readonly id: string;
  readonly direction: "inbound" | "outbound";
  readonly sent_via: string;
  readonly body: string | null;
  readonly created_at: string;
}

export interface ConversaDoTurno {
  readonly id: string;
  readonly estado: ConversationState;
  readonly contact_id: string;
  /** Da mais antiga para a mais nova — é a ordem em que o modelo lê. */
  readonly mensagens: readonly MensagemDoHistorico[];
}

export interface DepsDoHistorico {
  pool?: ServicePool;
}

interface LinhaDaConversa {
  id: string;
  saas_state: string;
  contact_id: string;
}

interface LinhaDaMensagem {
  id: string;
  direction: string;
  sent_via: string;
  body: string | null;
  created_at: Date | string;
}

function comoTexto(valor: Date | string): string {
  return valor instanceof Date ? valor.toISOString() : String(valor);
}

/**
 * A conversa e o seu histórico, ou `null` quando ela não é deste tenant.
 *
 * `null` e não exceção: id de outra organização é "não achei", e um erro diria à
 * IA que aquele id existe em algum lugar (mesma escolha de `src/crm/reads.ts`).
 *
 * Estado fora do vocabulário D16 também devolve `null`: um `saas_state` que o
 * código não reconhece não pode virar permissão para falar.
 */
export async function lerConversaDoTurno(
  ctx: TenantCtx,
  conversationId: string,
  deps: DepsDoHistorico = {},
): Promise<ConversaDoTurno | null> {
  return withTenant(
    ctx,
    async (db) => {
      const conversa = await db.query<LinhaDaConversa>(
        `select id, saas_state, contact_id
           from public.conversations
          where id = $1 and organization_id = $2`,
        [conversationId, ctx.organization_id],
      );
      const linha = conversa.rows[0];
      if (linha === undefined || !isConversationState(linha.saas_state)) return null;

      // `desc` + reversão em JS: as ÚLTIMAS 20 são o recorte; ordená-las
      // crescente no banco e cortar com LIMIT devolveria as PRIMEIRAS 20, que é
      // o histórico errado com a mesma contagem.
      const mensagens = await db.query<LinhaDaMensagem>(
        `select id, direction, sent_via, body, created_at
           from public.messages
          where conversation_id = $1 and organization_id = $2
          order by created_at desc, id desc
          limit $3`,
        [conversationId, ctx.organization_id, MENSAGENS_NO_CONTEXTO],
      );

      return {
        id: linha.id,
        estado: linha.saas_state,
        contact_id: linha.contact_id,
        mensagens: mensagens.rows
          .map((m) => ({
            id: m.id,
            direction: m.direction === "outbound" ? ("outbound" as const) : ("inbound" as const),
            sent_via: m.sent_via,
            body: m.body,
            created_at: comoTexto(m.created_at),
          }))
          .reverse(),
      };
    },
    deps,
  );
}

/**
 * Quantas vezes a IA já disse, NESTA conversa, o texto de "não sei" do tenant.
 *
 * É o contador de D19 ("pergunta fora da base de conhecimento após 1 tentativa")
 * lido do REGISTRO-FONTE (G-35) em vez de guardado em memória: o turno seguinte
 * pode acontecer noutro processo, noutro dia, e um contador em RAM diria zero
 * para sempre. Também não é tabela nova — a resposta já está gravada em
 * `messages`, e criar uma coluna para recontá-la seria duas verdades.
 */
export async function vezesQueRespondeuDesconhecido(
  ctx: TenantCtx,
  conversationId: string,
  textoDesconhecido: string,
  deps: DepsDoHistorico = {},
): Promise<number> {
  if (textoDesconhecido.trim().length === 0) return 0;
  return withTenant(
    ctx,
    async (db) => {
      const r = await db.query<{ v: string | number }>(
        `select count(*)::int as v
           from public.messages
          where conversation_id = $1
            and organization_id = $2
            and direction = 'outbound'
            and sent_via = 'ai'
            and body = $3`,
        [conversationId, ctx.organization_id, textoDesconhecido],
      );
      return Number(r.rows[0]?.v ?? 0);
    },
    deps,
  );
}
