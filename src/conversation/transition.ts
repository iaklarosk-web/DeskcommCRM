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

export interface TransitionDeps {
  pool?: ServicePool;
  guards?: GuardResolver;
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
    case "append_message":
    case "new_conversation":
    case "notify_customer_replied_while_human":
    case "create_handoff":
    case "create_conversation_if_absent":
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
