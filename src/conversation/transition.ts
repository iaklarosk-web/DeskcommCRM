/**
 * `transition()` — a ÚNICA autoridade de evento da conversa (§5.6, ADR-016) e
 * o único código de aplicação que escreve `conversations.saas_state`.
 *
 * O que ela faz, nesta ordem, dentro de UMA transação de `withTenant`:
 *  1. trava a linha da conversa no tenant (`for no key update`);
 *  2. valida o par `(estado, evento)` contra a tabela D16 e o ator contra o
 *     subset da linha;
 *  3. pergunta a guarda ao resolvedor injetado e escolhe o destino;
 *  4. sinaliza `app.conversation_transition=1` — o gatilho de projeção cala,
 *     porque este movimento já tem dono;
 *  5. delega o lado LEGADO a `fn_service_status` (revisão por CAS, demanda,
 *     assignee) e só então escreve o estado D16;
 *  6. executa os efeitos declarados na linha.
 *
 * Par ilegal, ator fora do subset e guarda falsa sem destino alternativo
 * lançam `IllegalTransition` e contam `conversation_illegal_transition`.
 */
import { incrementCounter } from "@/src/obs/counters";
import type { ServicePool } from "@/src/tenant-context/db";
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";

import { resolverDeGuardasF03, type GuardConversation, type GuardResolver } from "./guards";
import { D16_TO_LEGACY, type LegacyStatus } from "./state-map";
import {
  findTransition,
  resolveTarget,
  type ConversationState,
  type TransitionActor,
  type TransitionEffect,
} from "./transitions";

/** Motivo da recusa — vira etiqueta do contador, nunca frase livre (D19). */
export type IllegalReason = "pair" | "actor" | "guard";

export class IllegalTransition extends Error {
  constructor(
    public readonly from: ConversationState,
    public readonly event: string,
    public readonly reason: IllegalReason,
  ) {
    super(`transição ilegal: ${from} -${event}-> recusada (${reason})`);
    this.name = "IllegalTransition";
  }
}

export class ConversationNotFound extends Error {
  constructor(public readonly conversationId: string) {
    super(`conversa não encontrada no tenant: ${conversationId}`);
    this.name = "ConversationNotFound";
  }
}

export class EffectNotImplemented extends Error {
  constructor(public readonly effect: TransitionEffect) {
    super(
      `efeito sem executor nesta fase: ${effect} (o chamador de F03-T05/T06 ou ` +
        "de F04/F05 é quem o executa; ignorar em silêncio seria perder o movimento)",
    );
    this.name = "EffectNotImplemented";
  }
}

/** Quem move a conversa, e — quando o efeito exige — sobre quem. */
export interface TransitionActorRef {
  readonly kind: TransitionActor;
  /** Atendente que assume; obrigatório para `assign_to_actor`. */
  readonly userId?: string;
  /** Destinatário da transferência; obrigatório para `assign_to_target`. */
  readonly targetUserId?: string;
}

export interface TransitionResult {
  from: ConversationState;
  to: ConversationState;
}

/**
 * Executor de efeito injetado pelo chamador. Devolve `true` quando ELE cumpriu
 * o efeito; `false` devolve o efeito ao executor interno (as RPCs de
 * atribuição) e, se lá também não houver portador, `EffectNotImplemented` sobe.
 *
 * Existe porque a tabela D16 declara efeitos que `transition()` não pode
 * cumprir sozinha: `append_message` é a linha de `messages` que o pipeline de
 * entrada acabou de gravar (`src/channels/inbound.ts`), e esta função não tem —
 * nem deve ter — a mensagem em mãos. Sem o seam, `inbound.message` seria
 * impossível de emitir por aqui, e o pipeline teria de escrever `saas_state`
 * por fora: uma SEGUNDA autoridade, que é exatamente o que a ADR-016 recusa.
 *
 * Omitir a dependência preserva o comportamento anterior byte a byte.
 */
export type EffectExecutor = (
  db: TenantDb,
  ctx: TenantCtx,
  conversationId: string,
  effect: TransitionEffect,
  actor: TransitionActorRef,
) => Promise<boolean>;

export interface TransitionDeps {
  pool?: ServicePool;
  guards?: GuardResolver;
  /** Ver `EffectExecutor`. Ausente = só os efeitos de atribuição têm executor. */
  effects?: EffectExecutor;
}

interface ConversationRow {
  id: string;
  status: LegacyStatus;
  saas_state: ConversationState;
  saas_state_entered_at: Date | null;
  last_outbound_at: Date | null;
  service_revision: string;
  contact_id: string;
}

const EFEITOS_DE_ATRIBUICAO: readonly TransitionEffect[] = [
  "assign_to_actor",
  "assign_to_target",
  "clear_assignee",
];

function recusar(from: ConversationState, event: string, reason: IllegalReason): never {
  incrementCounter("conversation_illegal_transition", { from, event, reason });
  throw new IllegalTransition(from, event, reason);
}

/**
 * O alvo de cada efeito de atribuição, conferido ANTES de qualquer escrita:
 * descobrir no meio do movimento que falta `userId` deixaria estado escrito e
 * efeito não executado.
 */
function alvoDaAtribuicao(
  effect: TransitionEffect,
  actor: TransitionActorRef,
): string | null | undefined {
  if (effect === "assign_to_actor") return actor.userId;
  if (effect === "assign_to_target") return actor.targetUserId;
  if (effect === "clear_assignee") return null;
  return undefined;
}

const MOTIVO_DA_ATRIBUICAO: Record<string, string> = {
  assign_to_actor: "claim",
  assign_to_target: "transfer",
  clear_assignee: "release",
};

async function aplicarEfeito(
  db: TenantDb,
  ctx: TenantCtx,
  conversationId: string,
  effect: TransitionEffect,
  actor: TransitionActorRef,
): Promise<void> {
  switch (effect) {
    case "assign_to_actor":
    case "assign_to_target":
    case "clear_assignee": {
      const alvo = alvoDaAtribuicao(effect, actor);
      // A atribuição inteira (dono, nome desnormalizado, evento de auditoria)
      // é da RPC herdada; F03 não reimplementa nada disso.
      await db.query(
        `select public.fn_conversation_assign($1::uuid,$2::uuid,$3::uuid,$4::text)`,
        [ctx.organization_id, conversationId, alvo ?? null, MOTIVO_DA_ATRIBUICAO[effect]],
      );
      return;
    }
    case "create_conversation_if_absent":
      // Alcançar `transition()` já significa que a conversa EXISTE (ela foi
      // travada `for no key update` acima): o efeito está cumprido por
      // construção. O caso "nenhuma" da tabela de §5.6 — não há conversa para
      // travar — é `iniciarPorAutomacao()`, abaixo, que cria a linha e a põe
      // em `waiting_customer` sem passar por aqui.
      return;
    case "append_message":
    case "new_conversation":
    case "notify_customer_replied_while_human":
    case "create_handoff":
      throw new EffectNotImplemented(effect);
    default: {
      // Efeito novo na tabela sem linha aqui vira erro de compilação.
      const naoTratado: never = effect;
      throw new EffectNotImplemented(naoTratado);
    }
  }
}

export async function transition(
  ctx: TenantCtx,
  conversationId: string,
  event: string,
  actor: TransitionActorRef,
  deps: TransitionDeps = {},
): Promise<TransitionResult> {
  const guards = deps.guards ?? resolverDeGuardasF03({ pool: deps.pool });

  return withTenant(
    ctx,
    async (db) => {
      const leitura = await db.query<ConversationRow>(
        `select id, status, saas_state, saas_state_entered_at, last_outbound_at,
                service_revision, contact_id
           from public.conversations
          where id = $1 and organization_id = $2
          for no key update`,
        [conversationId, ctx.organization_id],
      );
      const conversa = leitura.rows[0];
      if (conversa === undefined) throw new ConversationNotFound(conversationId);

      const from = conversa.saas_state;
      const linha = findTransition(from, event);
      if (linha === null) recusar(from, event, "pair");
      if (!linha.actor.includes(actor.kind)) recusar(from, event, "actor");

      const efeitos = linha.effects ?? [];
      for (const efeito of efeitos) {
        if (!EFEITOS_DE_ATRIBUICAO.includes(efeito)) continue;
        if (alvoDaAtribuicao(efeito, actor) === undefined) recusar(from, event, "actor");
      }

      const guardaSatisfeita = linha.guard
        ? await guards(linha.guard, ctx, conversa satisfies GuardConversation)
        : true;
      const to = resolveTarget(linha, guardaSatisfeita);
      if (to === null) recusar(from, event, "guard");

      // A partir daqui o movimento é escrita. O sinal cala a projeção: o
      // gatilho existe para escritor legado, e este não é um.
      await db.query(`select set_config('app.conversation_transition','1',true)`);

      const legado = D16_TO_LEGACY[to];
      if (legado !== conversa.status) {
        await db.query(`select public.fn_service_status($1::uuid,$2::uuid,$3::text,$4::bigint)`, [
          ctx.organization_id,
          conversationId,
          legado,
          conversa.service_revision,
        ]);
      }

      await db.query(
        `update public.conversations
            set saas_state = $3, saas_state_entered_at = clock_timestamp()
          where id = $1 and organization_id = $2`,
        [conversationId, ctx.organization_id, to],
      );

      for (const efeito of efeitos) {
        // O executor injetado tem a primeira palavra e a recusa é explícita:
        // `false` cai no executor interno, que lança se também não souber. Um
        // executor que devolvesse `undefined` por engano não engoliria o efeito.
        if (deps.effects !== undefined) {
          const cumprido = await deps.effects(db, ctx, conversationId, efeito, actor);
          if (cumprido === true) continue;
        }
        await aplicarEfeito(db, ctx, conversationId, efeito, actor);
      }

      // `fn_conversation_assign` reescreve `status` por conta própria (claimed
      // ao assumir, open ao liberar). Sem esta reconciliação, `human.return_to_ai`
      // terminaria com saas_state=ai_handling e status=open — e o próximo
      // escritor legado projetaria a conversa de volta para `open`.
      if (efeitos.some((efeito) => EFEITOS_DE_ATRIBUICAO.includes(efeito))) {
        const depois = await db.query<{ status: LegacyStatus; service_revision: string }>(
          `select status, service_revision from public.conversations
            where id = $1 and organization_id = $2`,
          [conversationId, ctx.organization_id],
        );
        const atual = depois.rows[0];
        if (atual !== undefined && atual.status !== legado) {
          await db.query(
            `select public.fn_service_status($1::uuid,$2::uuid,$3::text,$4::bigint)`,
            [ctx.organization_id, conversationId, legado, atual.service_revision],
          );
        }
      }

      return { from, to };
    },
    { pool: deps.pool },
  );
}

/**
 * O caso "nenhuma" da linha `automation.outbound` de §5.6: "a partir de
 * nenhuma a conversa é criada" e nasce em `waiting_customer`.
 *
 * ─── Por que não é `transition()` ──────────────────────────────────────────
 *
 * `transition()` valida um par `(estado, evento)`, e "nenhuma" não é estado —
 * não há linha para travar nem `from` para consultar na tabela. A tabela D16
 * declara o evento legal a partir de `resolved` e `waiting_customer`; qualquer
 * OUTRO estado (`open`, `ai_handling`, `waiting_human`, `human_handling`,
 * `waiting_confirmation`, `archived`) é uma conversa OCUPADA, e a automação não
 * fala no meio dela — a recusa sobe como `IllegalTransition`, que é a mesma
 * recusa que `transition()` daria.
 *
 * ─── O que este arquivo continua sendo ─────────────────────────────────────
 *
 * O único código de aplicação que escreve `saas_state` (ADR-016). A linha nova
 * é criada pela RPC herdada `fn_upsert_wa_conversation` (a MESMA que a entrada
 * usa; `uniq_conversations_1to1_per_contact_session` continua sendo a
 * identidade) e recebe o estado D16 aqui, na mesma transação, com o legado
 * projetado por `fn_service_status` como em todo movimento. Se a conversa já
 * existia — inclusive por corrida com uma entrada simultânea, serializada por
 * `fn_service_lock` —, o caminho volta a ser `transition()`, com o par
 * validado contra a tabela.
 */
export interface InicioPorAutomacao {
  readonly conversation_id: string;
  /** `null` quando a conversa acabou de ser criada ("nenhuma"). */
  readonly from: ConversationState | null;
  readonly to: ConversationState;
  readonly created: boolean;
}

export async function iniciarPorAutomacao(
  ctx: TenantCtx,
  alvo: { readonly contact_id: string; readonly channel_session_id: string },
  deps: TransitionDeps = {},
): Promise<InicioPorAutomacao> {
  const existente = await withTenant(
    ctx,
    async (db) => {
      const r = await db.query<{ id: string }>(
        `select id from public.conversations
          where organization_id = $1 and contact_id = $2 and channel_session_id = $3
            and is_group = false`,
        [ctx.organization_id, alvo.contact_id, alvo.channel_session_id],
      );
      return r.rows[0]?.id ?? null;
    },
    { pool: deps.pool },
  );

  if (existente === null) {
    const criada = await withTenant(
      ctx,
      async (db) => {
        // Serializa com a entrada (§5.7): duas criações simultâneas da mesma
        // pessoa terminam com uma criando e a outra vendo a criada.
        await db.query(`select public.fn_service_lock($1::uuid,$2::uuid)`, [
          ctx.organization_id,
          alvo.contact_id,
        ]);
        const upsert = await db.query<{ fn_upsert_wa_conversation: string | null }>(
          `select public.fn_upsert_wa_conversation($1::uuid,$2::uuid,$3::uuid)`,
          [ctx.organization_id, alvo.contact_id, alvo.channel_session_id],
        );
        const id = upsert.rows[0]?.fn_upsert_wa_conversation ?? null;
        if (id === null) throw new Error("fn_upsert_wa_conversation não devolveu conversa para a automação");

        // Criada NESTA transação ⇔ `created_at = now()` (o default da coluna é
        // o `now()` da transação). Se outra sessão criou entre a leitura e o
        // lock, a linha é mais velha e o caminho é o de conversa existente.
        const linha = await db.query<{ nova: boolean; service_revision: string; status: LegacyStatus }>(
          `select (created_at = now()) as nova, service_revision, status
             from public.conversations where id = $1 and organization_id = $2
             for no key update`,
          [id, ctx.organization_id],
        );
        const atual = linha.rows[0];
        if (atual === undefined || !atual.nova) return { id, nova: false as const };

        const to: ConversationState = "waiting_customer";
        await db.query(`select set_config('app.conversation_transition','1',true)`);
        const legado = D16_TO_LEGACY[to];
        if (legado !== atual.status) {
          await db.query(`select public.fn_service_status($1::uuid,$2::uuid,$3::text,$4::bigint)`, [
            ctx.organization_id,
            id,
            legado,
            atual.service_revision,
          ]);
        }
        await db.query(
          `update public.conversations
              set saas_state = $3, saas_state_entered_at = clock_timestamp()
            where id = $1 and organization_id = $2`,
          [id, ctx.organization_id, to],
        );
        if (deps.effects !== undefined) {
          await deps.effects(db, ctx, id, "create_conversation_if_absent", { kind: "automation" });
        }
        incrementCounter("conversation_created_by_automation");
        return { id, nova: true as const, to };
      },
      { pool: deps.pool },
    );
    if (criada.nova) {
      return { conversation_id: criada.id, from: null, to: criada.to, created: true };
    }
    const movimento = await transition(ctx, criada.id, "automation.outbound", { kind: "automation" }, deps);
    return { conversation_id: criada.id, from: movimento.from, to: movimento.to, created: false };
  }

  const movimento = await transition(ctx, existente, "automation.outbound", { kind: "automation" }, deps);
  return { conversation_id: existente, from: movimento.from, to: movimento.to, created: false };
}
