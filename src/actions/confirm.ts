/**
 * `confirm(ctx, pending_id, decision, actor)` e o Job de timeout — os TRÊS
 * desfechos de uma pendência (§5.8, D16/D33, F04-T02).
 *
 *   aprovar  → a ação pendente EXECUTA antes → `confirmation.approved` → `ai_handling`
 *   recusar  → `confirmation.rejected` → `human_handling`, com `assignee_id` = quem recusou
 *   vencer   → `confirmation.timeout` → `waiting_human`
 *
 * ─── A ordem da aprovação, e por que ela é essa ────────────────────────────
 *
 * §5.6 escreve a guarda de `confirmation.approved` como "Action pendente
 * executa antes". Então: executa → fecha a linha → move. A guarda
 * `pending_action_executed` lê `pending_actions` e só é verdadeira depois dos
 * dois primeiros passos — é ela que torna IMPOSSÍVEL mover a conversa sem que a
 * ação tenha acontecido. Inverter a ordem (mover e depois executar) deixaria a
 * conversa de volta com a IA enquanto o pedido ainda não existe.
 *
 * ─── Quem executa a ação aprovada ──────────────────────────────────────────
 *
 * O `attendant` que aprovou, com a sessão dele. Não é detalhe: os serviços de
 * pedido da F02 exigem executor humano com sessão (`authorizeCrmCommand`), e
 * D33 diz que a confirmação registra "ator humano". Executar como IA exigiria
 * abrir a escrita do CRM a executor não-humano, que é decisão de §5.5.
 *
 * ─── Duas aprovações simultâneas ───────────────────────────────────────────
 *
 * `resolverPendencia` fecha com `where status = 'pending'`: só UMA ganha, e a
 * perdedora volta `pending_conflict`. As duas podem ter chamado o domínio, e é
 * por isso que a `idempotency_key` viaja DENTRO de `pending_actions.input` — a
 * segunda chamada replica o recibo em vez de criar um segundo pedido. A
 * idempotência é do banco, como no resto da casa.
 */
import { randomUUID } from "node:crypto";

import { IllegalTransition, resolverDeGuardasF03, transition } from "@/src/conversation";
import { incrementCounter } from "@/src/obs/counters";
import { withTenant, type TenantCtx } from "@/src/tenant-context";

import { findAction } from "./catalog";
import {
  listarVencidas,
  resolverPendencia,
  travarPendencia,
  type PendingAction,
} from "./pending-store";
import { auditar, concluir, negar, type ActionResult } from "./execute";
import { findHandler } from "./tools";
import type { ActionActor, ExecuteDeps } from "./tools/contrato";

/** O atendente decide entre dois; o terceiro desfecho é do relógio. */
export type ConfirmDecision = "approved" | "rejected";

/** A pendência lida, já conferida contra o catálogo. */
interface PendenciaViva {
  readonly linha: PendingAction;
  readonly conversationId: string;
}

async function lerPendenciaAberta(
  ctx: TenantCtx,
  pendingId: string,
  deps: ExecuteDeps,
): Promise<PendenciaViva | null> {
  const linha = await withTenant(ctx, async (db) => travarPendencia(db, ctx, pendingId), {
    pool: deps.pool,
  });
  if (linha === null || linha.status !== "pending" || linha.conversation_id === null) {
    return null;
  }
  return { linha, conversationId: linha.conversation_id };
}

export async function confirm(
  ctx: TenantCtx,
  pendingId: string,
  decision: ConfirmDecision,
  actor: ActionActor,
  deps: ExecuteDeps = {},
): Promise<ActionResult> {
  const requestId = deps.requestId ?? randomUUID();

  // Quem confirma é o `attendant`: a tabela D16 só admite esse ator nos dois
  // eventos, e sem `user_id` não há como preencher `assignee_id` na recusa.
  if (actor.kind !== "human" || typeof actor.user_id !== "string") {
    return negar(ctx, actor, null, "confirm", "actor_without_user", null, requestId, deps);
  }
  const userId = actor.user_id;

  const viva = await lerPendenciaAberta(ctx, pendingId, deps);
  if (viva === null) {
    return negar(ctx, actor, null, "confirm", "pending_conflict", null, requestId, deps);
  }
  const entrada = findAction(viva.linha.action_name);
  const handler = findHandler(viva.linha.action_name);
  if (entrada === null || handler === null) {
    // Pendência de uma ação que saiu do catálogo. Fechar como recusada é o
    // único desfecho honesto: executar seria rodar o que ninguém mais autoriza.
    await withTenant(
      ctx,
      async (db) => resolverPendencia(db, ctx, pendingId, "rejected", userId),
      { pool: deps.pool },
    );
    return negar(
      ctx,
      actor,
      null,
      viva.linha.action_name,
      "unknown_action",
      viva.conversationId,
      requestId,
      deps,
    );
  }

  if (decision === "rejected") {
    const fechada = await withTenant(
      ctx,
      async (db) => resolverPendencia(db, ctx, pendingId, "rejected", userId),
      { pool: deps.pool },
    );
    if (!fechada) {
      return negar(
        ctx,
        actor,
        entrada,
        entrada.name,
        "pending_conflict",
        viva.conversationId,
        requestId,
        deps,
      );
    }
    // `assign_to_actor`: §5.6 diz `assignee_id` = quem rejeitou.
    await transition(
      ctx,
      viva.conversationId,
      "confirmation.rejected",
      { kind: "attendant", userId },
      { pool: deps.pool },
    );
    incrementCounter("actions_confirmation", { action: entrada.name, decision: "rejected" });
    const auditId = await auditar(
      ctx,
      actor,
      entrada,
      entrada.name,
      requestId,
      {
        result: "denied",
        resourceId: viva.conversationId,
        payload: { decision: "rejected", pending_action_id: pendingId },
      },
      deps,
    );
    return {
      status: "denied",
      output: { pending_action_id: pendingId, decision: "rejected" },
      audit_id: auditId,
      reason: "confirmation_rejected",
    };
  }

  // ── Aprovação: EXECUTA, fecha a linha, e só então move a conversa ────────
  const desfecho = await handler.run(
    { ctx, actor, deps, requestId },
    viva.linha.input,
  );
  if (!desfecho.ok) {
    // A pendência CONTINUA aberta: o atendente pode corrigir o que o domínio
    // recusou e aprovar de novo, ou deixar o timeout levar para `waiting_human`.
    // Fechá-la aqui perderia o pedido do cliente sem ninguém decidir isso.
    return concluir(ctx, actor, entrada, requestId, desfecho, deps, {
      pending_action_id: pendingId,
    });
  }

  const fechada = await withTenant(
    ctx,
    async (db) => resolverPendencia(db, ctx, pendingId, "approved", userId),
    { pool: deps.pool },
  );
  if (!fechada) {
    return negar(
      ctx,
      actor,
      entrada,
      entrada.name,
      "pending_conflict",
      viva.conversationId,
      requestId,
      deps,
    );
  }

  await transition(
    ctx,
    viva.conversationId,
    "confirmation.approved",
    { kind: "attendant", userId },
    { pool: deps.pool },
  );
  incrementCounter("actions_confirmation", { action: entrada.name, decision: "approved" });

  return concluir(ctx, actor, entrada, requestId, desfecho, deps, {
    pending_action_id: pendingId,
    decision: "approved",
  });
}

export interface ResultadoDoTimeout {
  readonly vencidas: number;
  readonly movidas: number;
}

/**
 * O terceiro caminho: o Job varre as pendências vencidas do tenant e leva a
 * conversa para `waiting_human` (D16, `confirmation.timeout`).
 *
 * O movimento vem ANTES de fechar a linha, e a ordem importa: a guarda
 * `confirmation_timeout_elapsed` procura pendência AINDA ABERTA e vencida.
 * Fechar primeiro apagaria a evidência de que o prazo estourou, e o movimento
 * seria recusado pela própria limpeza.
 *
 * Se a conversa já tiver saído de `waiting_confirmation` (um atendente assumiu
 * por outro caminho), a linha é fechada como `timeout` mesmo assim: deixá-la
 * aberta travaria o índice único da conversa para sempre.
 */
export async function expirarConfirmacoes(
  ctx: TenantCtx,
  deps: ExecuteDeps = {},
): Promise<ResultadoDoTimeout> {
  const requestId = deps.requestId ?? randomUUID();
  const agora = (deps.agora ?? (() => new Date()))();
  const vencidas = await listarVencidas(ctx, agora, { pool: deps.pool });
  const ator: ActionActor = { kind: "automation" };

  let movidas = 0;
  for (const pendencia of vencidas) {
    if (pendencia.conversation_id === null) continue;
    let moveu = true;
    try {
      await transition(
        ctx,
        pendencia.conversation_id,
        "confirmation.timeout",
        { kind: "job" },
        {
          pool: deps.pool,
          // O relógio do JOB é o que a guarda usa. Sem passá-lo, `transition()`
          // montaria o resolvedor com `new Date()` e a varredura veria uma
          // pendência vencida que a guarda considera no prazo — duas horas
          // diferentes no mesmo movimento.
          guards: resolverDeGuardasF03({ pool: deps.pool, agora: () => agora }),
        },
      );
      movidas += 1;
    } catch (erro) {
      if (!(erro instanceof IllegalTransition)) throw erro;
      moveu = false;
    }

    await withTenant(
      ctx,
      async (db) => resolverPendencia(db, ctx, pendencia.id, "timeout", null),
      { pool: deps.pool },
    );
    incrementCounter("actions_confirmation", {
      action: pendencia.action_name,
      decision: "timeout",
    });
    await auditar(
      ctx,
      ator,
      findAction(pendencia.action_name),
      pendencia.action_name,
      requestId,
      {
        // `failed` e não `denied`: ninguém decidiu — o prazo acabou. §5.17
        // separa os dois de propósito, e colapsá-los faria "quantas pessoas
        // recusaram?" incluir as que nem chegaram a ver a pendência.
        result: "failed",
        resourceId: pendencia.conversation_id,
        payload: { decision: "timeout", pending_action_id: pendencia.id, moved: moveu },
      },
      deps,
    );
  }

  return { vencidas: vencidas.length, movidas };
}
