/**
 * Action Policy — `execute()` (§5.8, D17/D33). A ÚNICA porta de efeito de IA,
 * automação ou humano.
 *
 * Ordem deliberada, e cada passo é uma pergunta que só este arquivo responde:
 *
 *   1. o nome está no catálogo?             → `unknown_action`
 *   2. o executor está no subset?           → `executor_not_allowed`
 *   3. o risco é `blocked`?                 → `risk_blocked` (nega para TODOS)
 *   4. a entrada casa com o `input_schema`? → `invalid_input`
 *   5. precisa de confirmação humana?       → PENDÊNCIA (D33), não efeito
 *   6. senão, a função de domínio executa.
 *
 * ─── Negado é RESULTADO, não exceção ───────────────────────────────────────
 *
 * §5.8, invariante 4: "nome fora do catálogo = denied, nunca exceção". Vale
 * para toda recusa de política: sobe como `{status:"denied", reason}` contável
 * e AUDITADO. Exceção fica para o que é defeito — banco fora do ar, invariante
 * violado.
 *
 * ─── `audit: always` ───────────────────────────────────────────────────────
 *
 * TODA saída daqui — executada, pendente ou negada — deixa uma linha em
 * `audit_events` e outra em `api_audit_log` (§5.17; `src/actions/audit.ts`
 * explica por que as duas). O id da primeira volta em `audit_id`.
 *
 * O efeito de canal mora em `outbound.ts`; o mapeamento tool → domínio, em
 * `tools/`. Aqui só a política.
 */
import { randomUUID } from "node:crypto";

import { IllegalTransition, transition } from "@/src/conversation";
import { papeisDaFila } from "@/src/handoff/registro";
import { membrosPorPapel, notify } from "@/src/notifications";
import { incrementCounter } from "@/src/obs/counters";
import { getSetting, getSettingIn } from "@/src/tenant-config/settings";
import { withTenant, type TenantCtx } from "@/src/tenant-context";

import { recordIn, type AuditActorType, type AuditResult } from "./audit";
import {
  ACTION_RISKS,
  findAction,
  nivelDeRisco,
  type ActionCatalogEntry,
  type ActionRisk,
} from "./catalog";
import { criarPendencia, resolverPendencia } from "./pending-store";
import { findHandler } from "./tools";
import type {
  ActionActor,
  ActionDenyReason,
  ExecuteDeps,
  ToolOutcome,
} from "./tools/contrato";

export type { ActionActor, ActionDenyReason, ExecuteDeps } from "./tools/contrato";
export { entregarSaida, MensagemDeSaidaAusente, type EntregaDeSaida } from "./outbound";

export type ActionStatus = "executed" | "pending" | "denied";

export interface ActionResult {
  readonly status: ActionStatus;
  readonly output: Record<string, unknown> | null;
  readonly audit_id: string;
  readonly reason?: ActionDenyReason;
  /**
   * O código do DOMÍNIO por trás de uma recusa `domain_rejected` (ou o do
   * movimento recusado), quando houver — o mesmo que vai ao `payload` da
   * auditoria. Etiqueta, nunca frase (G-78). Existe desde a F05-T08 para que
   * o corte do lembrete grave POR QUE a tarefa não nasceu.
   */
  readonly detalhe?: string;
  /** Preenchido só quando `status = "pending"` — é o id que `confirm()` recebe. */
  readonly pending_action_id?: string;
}

/** §5.17 fala de `user`; §5.8 fala de `human`. O mapa vive num lugar só. */
const ATOR_DA_AUDITORIA: Record<ActionActor["kind"], AuditActorType> = {
  human: "user",
  ai: "ai",
  automation: "automation",
};

const MS_POR_MINUTO = 60_000;

/** O default de §5.2 para `conversation.confirmation_timeout_minutes`. */
const TIMEOUT_PADRAO_MINUTOS = 60;

export function atorDaAuditoria(actor: ActionActor): {
  actor_type: AuditActorType;
  actor_id: string | null;
} {
  return {
    actor_type: ATOR_DA_AUDITORIA[actor.kind],
    // Só o humano tem linha em `auth.users`; a FK de `api_audit_log` recusaria
    // um id de agente. A identidade da IA, quando houver, vai no `payload`.
    actor_id: actor.kind === "human" ? (actor.user_id ?? null) : null,
  };
}

/**
 * `by_risk` de D33: pendência quando `risk ≥ actions.confirm_from_risk`.
 *
 * "Executor `human` nunca gera pendência para si" (§5.8) — quem aprovaria seria
 * a própria pessoa que pediu, e um passo que só pode terminar de um jeito não é
 * um controle, é um clique a mais.
 */
async function exigeConfirmacao(
  ctx: TenantCtx,
  entrada: ActionCatalogEntry,
  actor: ActionActor,
  deps: ExecuteDeps,
): Promise<boolean> {
  if (actor.kind === "human") return false;
  if (entrada.confirmation === "none") return false;
  if (entrada.confirmation === "always") return true;

  const configurado = await getSetting(ctx, "actions.confirm_from_risk", {
    pool: deps.pool,
  });
  // Setting fora do vocabulário é fail-closed: exigir confirmação é o lado
  // seguro para errar quando não se sabe a partir de que risco confirmar.
  if (typeof configurado !== "string" || !ACTION_RISKS.includes(configurado as ActionRisk)) {
    return true;
  }
  return nivelDeRisco(entrada.risk) >= nivelDeRisco(configurado as ActionRisk);
}

export async function minutosDeTimeout(
  ctx: TenantCtx,
  deps: ExecuteDeps,
): Promise<number> {
  const valor = await getSetting(ctx, "conversation.confirmation_timeout_minutes", {
    pool: deps.pool,
  });
  // Um valor fora do tipo não vira "sem prazo": pendência sem prazo é pendência
  // que nunca chega ao `waiting_human`.
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0
    ? valor
    : TIMEOUT_PADRAO_MINUTOS;
}

interface LinhaDeAuditoria {
  readonly result: AuditResult;
  readonly resourceId: string | null;
  readonly payload: Record<string, unknown>;
}

export async function auditar(
  ctx: TenantCtx,
  actor: ActionActor,
  entrada: ActionCatalogEntry | null,
  name: string,
  requestId: string,
  linha: LinhaDeAuditoria,
  deps: ExecuteDeps,
): Promise<string> {
  return withTenant(
    ctx,
    async (db) =>
      recordIn(db, ctx, {
        ...atorDaAuditoria(actor),
        action_name: name,
        risk: entrada?.risk ?? null,
        result: linha.result,
        // Nome fora do catálogo não tem `resource_type`: `action` é o que ele é.
        resource_type: entrada?.resource_type ?? "action",
        resource_id: linha.resourceId,
        request_id: requestId,
        payload: { actor_kind: actor.kind, ...linha.payload },
      }),
    { pool: deps.pool },
  );
}

export async function negar(
  ctx: TenantCtx,
  actor: ActionActor,
  entrada: ActionCatalogEntry | null,
  name: string,
  reason: ActionDenyReason,
  resourceId: string | null,
  requestId: string,
  deps: ExecuteDeps,
  detalhe?: string,
): Promise<ActionResult> {
  incrementCounter("actions_denied", { action: name, reason });
  const auditId = await auditar(
    ctx,
    actor,
    entrada,
    name,
    requestId,
    {
      result: "denied",
      resourceId,
      payload: detalhe === undefined ? { reason } : { reason, detalhe },
    },
    deps,
  );
  return {
    status: "denied",
    output: null,
    audit_id: auditId,
    reason,
    ...(detalhe === undefined ? {} : { detalhe }),
  };
}

/** O que `execute()` e `confirm()` fazem com o desfecho de um handler. */
export async function concluir(
  ctx: TenantCtx,
  actor: ActionActor,
  entrada: ActionCatalogEntry,
  requestId: string,
  desfecho: ToolOutcome,
  deps: ExecuteDeps,
  payloadExtra: Record<string, unknown> = {},
): Promise<ActionResult> {
  if (!desfecho.ok) {
    return negar(
      ctx,
      actor,
      entrada,
      entrada.name,
      desfecho.reason,
      desfecho.resourceId,
      requestId,
      deps,
      desfecho.detalhe,
    );
  }
  const auditId = await auditar(
    ctx,
    actor,
    entrada,
    entrada.name,
    requestId,
    {
      result: "executed",
      resourceId: desfecho.resourceId,
      // Sem corpo de mensagem nem texto de item: auditoria é quem/quando/o quê.
      payload: payloadExtra,
    },
    deps,
  );
  incrementCounter("actions_executed", { action: entrada.name, executor: actor.kind });
  return { status: "executed", output: desfecho.output, audit_id: auditId };
}

export async function execute(
  ctx: TenantCtx,
  actor: ActionActor,
  name: string,
  input: unknown,
  deps: ExecuteDeps = {},
): Promise<ActionResult> {
  const requestId = deps.requestId ?? randomUUID();

  const entrada = findAction(name);
  if (entrada === null) {
    return negar(ctx, actor, null, name, "unknown_action", null, requestId, deps);
  }
  if (!entrada.executors.includes(actor.kind)) {
    return negar(ctx, actor, entrada, name, "executor_not_allowed", null, requestId, deps);
  }
  // §5.8: "`blocked` nega para todo executor e audita a tentativa".
  if (entrada.risk === "blocked") {
    return negar(ctx, actor, entrada, name, "risk_blocked", null, requestId, deps);
  }

  const lido = entrada.input_schema.safeParse(input);
  if (!lido.success) {
    return negar(ctx, actor, entrada, name, "invalid_input", null, requestId, deps);
  }
  const pedido = lido.data as Record<string, unknown>;

  const handler = findHandler(name);
  if (handler === null) {
    // Impossível pelo registro total de `tools/index.ts` — mas se um dia for
    // possível, é recusa contada, não um `undefined is not a function`.
    return negar(ctx, actor, entrada, name, "unknown_action", null, requestId, deps);
  }

  if (await exigeConfirmacao(ctx, entrada, actor, deps)) {
    return pendurar(ctx, actor, entrada, pedido, requestId, deps);
  }

  const desfecho = await handler.run({ ctx, actor, deps, requestId }, pedido);
  return concluir(ctx, actor, entrada, requestId, desfecho, deps);
}

/**
 * O caminho de D33: a ação vira LINHA e a conversa vai para
 * `waiting_confirmation` pelo evento D16 `ai.confirmation_requested`.
 *
 * A pendência é COMMITADA antes do movimento de propósito: a guarda
 * `action_requires_confirmation` lê `pending_actions` de fora da transação de
 * `transition()`, e uma linha ainda não commitada seria invisível para ela — o
 * movimento seria recusado por causa de uma pendência que existe.
 *
 * Se o movimento for recusado (a conversa não estava em `ai_handling`), a
 * pendência MORRE junto, marcada `rejected`: deixá-la aberta travaria o índice
 * único da conversa com algo que nenhum atendente jamais veria.
 */
async function pendurar(
  ctx: TenantCtx,
  actor: ActionActor,
  entrada: ActionCatalogEntry,
  pedido: Record<string, unknown>,
  requestId: string,
  deps: ExecuteDeps,
): Promise<ActionResult> {
  const conversationId = pedido["conversation_id"];
  if (typeof conversationId !== "string") {
    return negar(
      ctx,
      actor,
      entrada,
      entrada.name,
      "invalid_input",
      null,
      requestId,
      deps,
      "conversation_required_for_confirmation",
    );
  }

  const agora = (deps.agora ?? (() => new Date()))();
  const expiraEm = new Date(
    agora.getTime() + (await minutosDeTimeout(ctx, deps)) * MS_POR_MINUTO,
  );

  const pendencia = await withTenant(
    ctx,
    async (db) =>
      criarPendencia(db, ctx, {
        conversation_id: conversationId,
        action_name: entrada.name,
        input: pedido,
        requested_by: actor.kind,
        expires_at: expiraEm,
      }),
    { pool: deps.pool },
  );

  try {
    await transition(
      ctx,
      conversationId,
      "ai.confirmation_requested",
      { kind: actor.kind === "ai" ? "ai" : "automation" },
      { pool: deps.pool },
    );
  } catch (erro) {
    await withTenant(
      ctx,
      async (db) => resolverPendencia(db, ctx, pendencia.id, "rejected", null),
      { pool: deps.pool },
    );
    if (erro instanceof IllegalTransition) {
      return negar(
        ctx,
        actor,
        entrada,
        entrada.name,
        "illegal_transition",
        conversationId,
        requestId,
        deps,
        `${erro.from}:${erro.event}:${erro.reason}`,
      );
    }
    throw erro;
  }

  // `notify(confirmation.requested)` (§5.16) para quem confirma: os mesmos
  // papéis que veem a fila de handoff (D33: "quem confirma: attendant do
  // tenant, pelo inbox"). Vem DEPOIS do movimento porque uma pendência que a
  // máquina recusou morre `rejected` acima, e avisar alguém dela seria avisar
  // de uma pergunta que ninguém vai ver.
  await withTenant(
    ctx,
    async (db) => {
      const fila = await membrosPorPapel(
        db,
        ctx,
        papeisDaFila(await getSettingIn(db, ctx, "handoff.queue_roles")),
      );
      await notify(db, ctx, "confirmation.requested", fila, {
        pending_action_id: pendencia.id,
        conversation_id: conversationId,
        action_name: entrada.name,
        risk: entrada.risk,
        requested_by: actor.kind,
        expires_at: expiraEm.toISOString(),
      });
    },
    { pool: deps.pool },
  );

  const auditId = await auditar(
    ctx,
    actor,
    entrada,
    entrada.name,
    requestId,
    {
      result: "pending",
      resourceId: conversationId,
      payload: { pending_action_id: pendencia.id, expires_at: expiraEm.toISOString() },
    },
    deps,
  );
  incrementCounter("actions_pending", { action: entrada.name, executor: actor.kind });

  return {
    status: "pending",
    output: { pending_action_id: pendencia.id, expires_at: expiraEm.toISOString() },
    audit_id: auditId,
    pending_action_id: pendencia.id,
  };
}
