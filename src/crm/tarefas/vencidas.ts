/**
 * F15-T00 — `task.overdue`: a varredura por tenant que emite o gatilho de
 * tarefa vencida (ADR-036 §2 T00).
 *
 * "Vencida" não é evento — é uma condição de tempo — e por isso não tem
 * escritor natural como `order.confirmed` tem. O job roda por tenant elegível
 * (D20: cron = uma execução por tenant), dentro do ciclo do
 * `workers/lembrete-worker.ts`, e emite UMA linha por `(tarefa, due_date)`:
 * a idempotência é o `not exists` sobre o próprio `event_log` (mesmo evento,
 * mesma tarefa, mesmo prazo em epoch). Mudar o prazo da tarefa e vencer de
 * novo emite de novo — é um vencimento novo.
 *
 * Elegível = organização ativa com ao menos UMA regra ativa ouvindo
 * `task.overdue`: o evento existe para alimentar regras; emitir para quem não
 * escuta encheria o barramento sem leitor.
 */
import { logger } from "@/lib/logger";
import { emitirEvento } from "@/src/events/emitir";
import { forEachEligibleTenant, withTenant, type TenantCtx } from "@/src/tenant-context";
import { getServicePool, type ServicePool } from "@/src/tenant-context/db";

export const CRON_KEY_DE_TAREFAS_VENCIDAS = "tasks.overdue_sweep";

/** Estados em que uma tarefa ainda pode vencer (CHECK herdado de `crm_tasks`). */
const ESTADOS_ABERTOS = ["pending", "in_progress"] as const;

interface Deps {
  pool?: ServicePool;
  agora?: () => Date;
  listEligible?: (cronKey: string) => Promise<string[]>;
}

export interface ResultadoDaVarreduraDeVencidas {
  tenants_eligible: number;
  tenants_failed: number;
  overdue_found: number;
  emitted: number;
  already_emitted: number;
}

export async function listarTenantsComRegraDeTarefaVencida(deps: Deps = {}): Promise<string[]> {
  const pool = deps.pool ?? (await getServicePool());
  const { rows } = await pool.query<{ organization_id: string }>(
    `select distinct r.organization_id
       from public.automation_rules r
       join public.organizations o on o.id = r.organization_id
      where r.trigger_event = 'task.overdue'
        and r.is_active
        and o.status = 'active'
      order by r.organization_id`,
  );
  return rows.map((r) => r.organization_id);
}

interface TarefaVencida {
  id: string;
  due_epoch: string;
  assigned_to: string | null;
  lead_id: string | null;
  contact_id: string | null;
  priority: string;
}

/** Um tenant: encontra as vencidas ainda não anunciadas e emite uma por uma. */
export async function varrerTarefasVencidas(
  ctx: TenantCtx,
  deps: { pool?: ServicePool; agora?: () => Date } = {},
): Promise<{ overdue_found: number; emitted: number; already_emitted: number }> {
  const agora = (deps.agora ?? (() => new Date()))();
  return withTenant(
    ctx,
    async (db) => {
      const abertas = await db.query<TarefaVencida & { ja_emitida: boolean }>(
        `select t.id,
                extract(epoch from t.due_date)::bigint::text as due_epoch,
                t.assigned_to, t.lead_id, t.contact_id, t.priority,
                exists (
                  select 1 from public.event_log e
                   where e.organization_id = t.organization_id
                     and e.event_type = 'task.overdue'
                     and e.entity_id = t.id
                     and e.payload->>'due_epoch' = extract(epoch from t.due_date)::bigint::text
                ) as ja_emitida
           from public.crm_tasks t
          where t.organization_id = $1
            and t.status = any($2::text[])
            and t.due_date is not null
            and t.due_date <= $3
          order by t.due_date asc, t.id asc`,
        [ctx.organization_id, [...ESTADOS_ABERTOS], agora],
      );
      let emitted = 0;
      let already = 0;
      for (const tarefa of abertas.rows) {
        if (tarefa.ja_emitida) {
          already += 1;
          continue;
        }
        await emitirEvento(db, ctx, {
          type: "task.overdue",
          entity_id: tarefa.id,
          payload: {
            task_id: tarefa.id,
            due_epoch: tarefa.due_epoch,
            assigned_to: tarefa.assigned_to,
            lead_id: tarefa.lead_id,
            contact_id: tarefa.contact_id,
            priority: tarefa.priority,
          },
          source: "crm.tarefas.vencidas",
        });
        emitted += 1;
      }
      return { overdue_found: abertas.rows.length, emitted, already_emitted: already };
    },
    { pool: deps.pool },
  );
}

export async function rodarVarreduraDeTarefasVencidas(deps: Deps = {}): Promise<ResultadoDaVarreduraDeVencidas> {
  const agora = (deps.agora ?? (() => new Date()))();
  let overdue = 0;
  let emitted = 0;
  let already = 0;
  const corridas = await forEachEligibleTenant(
    CRON_KEY_DE_TAREFAS_VENCIDAS,
    async (ctx) => {
      const r = await varrerTarefasVencidas(ctx, { pool: deps.pool, agora: () => agora });
      overdue += r.overdue_found;
      emitted += r.emitted;
      already += r.already_emitted;
      logger.info("job.run", {
        request_id: `overdue-${ctx.organization_id}-${agora.getTime()}`,
        organization_id: ctx.organization_id,
        job_type: CRON_KEY_DE_TAREFAS_VENCIDAS,
        outcome: "ok",
        counts: { overdue_found: r.overdue_found, emitted: r.emitted, already_emitted: r.already_emitted },
      });
    },
    { pool: deps.pool, listEligible: deps.listEligible ?? (() => listarTenantsComRegraDeTarefaVencida(deps)) },
  );
  return {
    tenants_eligible: corridas.length,
    tenants_failed: corridas.filter((c) => !c.ok).length,
    overdue_found: overdue,
    emitted,
    already_emitted: already,
  };
}
