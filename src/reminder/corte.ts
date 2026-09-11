/**
 * O CORTE do lembrete — o cliente NÃO respondeu até `cutoff_at` (§5.12,
 * §7.6 F05-T08: "sem resposta até o timeout configurado → task + notificação").
 *
 * ═══ O que acontece, por lembrete vencido ═══
 *
 *  1. `notify(reminder.no_reply)` (§5.16) para a fila de attendants — SEMPRE.
 *  2. `create_task` pelo CATÁLOGO, executor `automation`, vinculada ao pedido
 *     `draft` mais recente do cliente (a tarefa da Fase 1 é vinculada a um
 *     pedido, `src/crm/work`). O que o catálogo responder fica na linha:
 *     `task_id` se criou; `task_denied_code` se recusou.
 *  3. `no_reply_notified_at` carimbado — o corte é UMA vez por lembrete.
 *
 * ═══ LIMITE DECLARADO — a tarefa hoje é RECUSADA ═══
 *
 * `authorizeCrmCommand` (F02) exige executor humano com sessão; a tool
 * devolve `domain_rejected` com `non_human_executor_denied`, e a recusa é
 * auditada. Abrir a escrita do CRM a executor `automation` é decisão do
 * proprietário (VARREDURA-MELHORIAS §B5/§C6) — o corte TENTA pelo único
 * caminho legítimo (D17: "nenhum side effect fora do catálogo") e grava o que
 * aconteceu. Quando a decisão vier, este arquivo não muda: o catálogo passa a
 * responder `executed` e `task_id` passa a ser preenchido. Sem pedido `draft`
 * não há a que vincular a tarefa, e isso também fica gravado
 * (`no_draft_order`).
 *
 * O aviso, por outro lado, NÃO depende de decisão nenhuma: a pessoa é avisada
 * hoje, com os ids para abrir a conversa e o cliente.
 */
import { randomUUID } from "node:crypto";

import { execute } from "@/src/actions";
import { listOrderCards } from "@/src/crm/reads";
import { papeisDaFila } from "@/src/handoff/registro";
import { membrosPorPapel, notify } from "@/src/notifications";
import { incrementCounter } from "@/src/obs/counters";
import { getSettingIn, listarTenantsComLembreteLigado } from "@/src/tenant-config";
import { forEachEligibleTenant, withTenant, type TenantCtx } from "@/src/tenant-context";

import { fusoDoTenant } from "./config";
import { abrirJob, CRON_KEY_DO_LEMBRETE, fecharJob, type DepsDoLembrete } from "./envio";
import { chaveDoPeriodo, horaLocal } from "./periodo";

export interface CorteDeUmLembrete {
  readonly reminder_run_id: string;
  readonly customer_id: string;
  readonly notified: number;
  readonly task_id: string | null;
  readonly task_denied_code: string | null;
}

export interface ResultadoDoCorteDoTenant {
  readonly organization_id: string;
  readonly job_id: string | null;
  readonly runs_cut: number;
  readonly notified: number;
  readonly tasks_created: number;
  readonly tasks_denied: number;
  readonly cortes: readonly CorteDeUmLembrete[];
}

export interface ResultadoDosCortes {
  readonly tenants_eligible: number;
  readonly tenants_failed: number;
  readonly runs_cut: number;
  readonly notified: number;
  readonly tasks_created: number;
  readonly tasks_denied: number;
  readonly por_tenant: readonly ResultadoDoCorteDoTenant[];
}

interface LembreteVencido {
  readonly id: string;
  readonly customer_id: string;
  readonly conversation_id: string | null;
  readonly period_key: string;
}

async function pedidoDraftDoCliente(
  ctx: TenantCtx,
  customerId: string,
  deps: DepsDoLembrete,
): Promise<string | null> {
  const pedidos = await listOrderCards(ctx, customerId, 5, { pool: deps.pool });
  return pedidos.find((p) => p.status === "draft")?.id ?? null;
}

async function cortarUm(
  ctx: TenantCtx,
  vencido: LembreteVencido,
  agora: Date,
  deps: DepsDoLembrete,
): Promise<CorteDeUmLembrete> {
  // 2 · A tarefa, pelo catálogo. O desfecho é o que o catálogo disser.
  let taskId: string | null = null;
  let taskDenied: string | null = null;
  const pedido = await pedidoDraftDoCliente(ctx, vencido.customer_id, deps);
  if (pedido === null) {
    taskDenied = "no_draft_order";
  } else {
    const tarefa = await execute(
      ctx,
      { kind: "automation" },
      "create_task",
      {
        order_id: pedido,
        title: `Cliente sem resposta ao lembrete do período ${vencido.period_key}`,
        description: "Lembrete recorrente enviado e sem resposta até o prazo configurado. Verifique o pedido com o cliente.",
        priority: "high",
        idempotency_key: randomUUID(),
      },
      {
        pool: deps.pool,
        ...(deps.adapters === undefined ? {} : { adapters: deps.adapters }),
        ...(deps.modo === undefined ? {} : { modo: deps.modo }),
      },
    );
    if (tarefa.status === "executed") {
      taskId = String(tarefa.output?.["task_id"] ?? "");
      if (taskId.length === 0) taskId = null;
    } else {
      taskDenied = tarefa.detalhe ?? tarefa.reason ?? "denied";
    }
  }
  incrementCounter(taskId === null ? "reminder_cutoff_task_denied" : "reminder_cutoff_task_created", {
    code: taskDenied ?? "created",
  });

  // 1 + 3 · O aviso e o carimbo, na MESMA transação.
  const notificados = await withTenant(
    ctx,
    async (db) => {
      const fila = await membrosPorPapel(
        db,
        ctx,
        papeisDaFila(await getSettingIn(db, ctx, "handoff.queue_roles")),
      );
      const aviso = await notify(db, ctx, "reminder.no_reply", fila, {
        reminder_run_id: vencido.id,
        customer_id: vencido.customer_id,
        conversation_id: vencido.conversation_id,
        period_key: vencido.period_key,
        task_id: taskId,
        task_denied_code: taskDenied,
      });
      await db.query(
        `update public.reminder_runs
            set no_reply_notified_at = $3, task_id = $4::uuid, task_denied_code = $5
          where id = $1 and organization_id = $2 and no_reply_notified_at is null`,
        [vencido.id, ctx.organization_id, agora.toISOString(), taskId, taskDenied],
      );
      return aviso.count;
    },
    { pool: deps.pool },
  );

  return {
    reminder_run_id: vencido.id,
    customer_id: vencido.customer_id,
    notified: notificados,
    task_id: taskId,
    task_denied_code: taskDenied,
  };
}

/** O corte de UM tenant: só abre job quando há lembrete vencido para cortar. */
export async function cortarParaTenant(
  ctx: TenantCtx,
  agora: Date,
  deps: DepsDoLembrete,
): Promise<ResultadoDoCorteDoTenant> {
  const vencidos = await withTenant(
    ctx,
    async (db) => {
      const r = await db.query<LembreteVencido>(
        `select id, customer_id, conversation_id, period_key
           from public.reminder_runs
          where organization_id = $1
            and sent_message_id is not null
            and replied_at is null
            and no_reply_notified_at is null
            and cutoff_at <= $2::timestamptz
          order by cutoff_at asc, id asc`,
        [ctx.organization_id, agora.toISOString()],
      );
      return r.rows;
    },
    { pool: deps.pool },
  );
  if (vencidos.length === 0) {
    return { organization_id: ctx.organization_id, job_id: null, runs_cut: 0, notified: 0, tasks_created: 0, tasks_denied: 0, cortes: [] };
  }

  const period = chaveDoPeriodo(horaLocal(agora, await fusoDoTenant(ctx, { pool: deps.pool })));
  const jobId = await abrirJob(ctx, "recurring_reminder_cutoff", period, agora, deps);
  const cortes: CorteDeUmLembrete[] = [];
  try {
    for (const vencido of vencidos) cortes.push(await cortarUm(ctx, vencido, agora, deps));
    const counts = {
      runs_cut: cortes.length,
      notified: cortes.reduce((s, c) => s + c.notified, 0),
      tasks_created: cortes.filter((c) => c.task_id !== null).length,
      tasks_denied: cortes.filter((c) => c.task_id === null).length,
    };
    await fecharJob(ctx, jobId, counts, null, deps);
    return { organization_id: ctx.organization_id, job_id: jobId, ...counts, cortes };
  } catch (erro) {
    await fecharJob(ctx, jobId, { runs_cut: cortes.length }, erro instanceof Error ? erro.name : "erro", deps);
    throw erro;
  }
}

/** O cron do corte (§5.12: `orders.recurring_reminder.cutoff`, uma vez por `reminder_run`). */
export async function rodarCortes(deps: DepsDoLembrete = {}): Promise<ResultadoDosCortes> {
  const agora = (deps.agora ?? (() => new Date()))();
  const listEligible =
    deps.listEligible ?? (() => listarTenantsComLembreteLigado({ pool: deps.pool }));
  const porTenant: ResultadoDoCorteDoTenant[] = [];
  const corridas = await forEachEligibleTenant(
    CRON_KEY_DO_LEMBRETE,
    async (ctx) => {
      porTenant.push(await cortarParaTenant(ctx, agora, deps));
    },
    { pool: deps.pool, listEligible },
  );
  return {
    tenants_eligible: corridas.length,
    tenants_failed: corridas.filter((c) => !c.ok).length,
    runs_cut: porTenant.reduce((s, t) => s + t.runs_cut, 0),
    notified: porTenant.reduce((s, t) => s + t.notified, 0),
    tasks_created: porTenant.reduce((s, t) => s + t.tasks_created, 0),
    tasks_denied: porTenant.reduce((s, t) => s + t.tasks_denied, 0),
    por_tenant: porTenant,
  };
}
