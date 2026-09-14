/**
 * A VARREDURA DA CARÊNCIA por tenant (F12-T06, D44; D20 "cron: uma execução
 * por tenant elegível"). Elegível = tem assinatura `past_due` com
 * `grace_until` vencido — a lista vem de `subscriptions`, lida com o pool de
 * serviço, e cada tenant roda no próprio `TenantCtx` de origem `cron`.
 * `varrerCarencia` é idempotente (bloqueia 0 na segunda passada), então o
 * ciclo pode repetir sem duplicar bloqueio nem aviso.
 */
import { logger } from "@/lib/logger";
import type { ServicePool } from "@/src/tenant-context/db";
import { getServicePool } from "@/src/tenant-context/db";
import { forEachEligibleTenant } from "@/src/tenant-context";

import { varrerCarencia } from "./assinatura";

export const CRON_KEY_DA_CARENCIA = "billing.grace_sweep";

export interface ResultadoDaVarredura {
  readonly tenants_eligible: number;
  readonly tenants_failed: number;
  readonly blocked: number;
  readonly notified: number;
}

interface Deps {
  pool?: ServicePool;
  graceDays?: number;
  agora?: () => Date;
}

export async function listarTenantsComCarenciaVencida(agora: Date, deps: Deps = {}): Promise<string[]> {
  const pool = deps.pool ?? (await getServicePool());
  const { rows } = await pool.query<{ organization_id: string }>(
    `select organization_id from public.subscriptions
      where status = 'past_due' and grace_until is not null and grace_until <= $1
      order by grace_until asc`,
    [agora],
  );
  return rows.map((r) => r.organization_id);
}

export async function rodarVarreduraDaCarencia(deps: Deps = {}): Promise<ResultadoDaVarredura> {
  const agora = (deps.agora ?? (() => new Date()))();
  let blocked = 0;
  let notified = 0;
  const corridas = await forEachEligibleTenant(
    CRON_KEY_DA_CARENCIA,
    async (ctx) => {
      const r = await varrerCarencia(ctx, { pool: deps.pool, graceDays: deps.graceDays, agora: () => agora });
      blocked += r.blocked;
      notified += r.notified;
      // F06-T01: uma linha por tenant, com o organization_id.
      logger.info("job.run", {
        request_id: `grace-${ctx.organization_id}-${agora.getTime()}`,
        organization_id: ctx.organization_id,
        job_type: CRON_KEY_DA_CARENCIA,
        outcome: "ok",
        counts: { blocked: r.blocked, notified: r.notified },
      });
    },
    { pool: deps.pool, listEligible: () => listarTenantsComCarenciaVencida(agora, deps) },
  );
  return {
    tenants_eligible: corridas.length,
    tenants_failed: corridas.filter((c) => !c.ok).length,
    blocked,
    notified,
  };
}
