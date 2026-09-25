/**
 * F13-T05 (ADR-034 §2) — o relatório comercial, lido de `fn_crm_report`
 * (migration 9026) pelo pool de serviço DENTRO de `withTenant`.
 *
 * A função SQL é a fonte; este módulo só fixa o tipo, o período (default:
 * últimos 30 dias, `[from, to)`) e o total de indicadores que a suíte de
 * integração recalcula por fora (`report_indicators=K/K`). Nenhum número é
 * derivado aqui — somar duas linhas do relatório em TypeScript seria criar
 * um indicador sem origem.
 */
import { withTenant, type TenantCtx } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";

export interface EtapaDoRelatorio {
  pipeline_id: string;
  stage_id: string;
  stage_name: string;
  position: number;
  open: number;
  value_cents: number;
}
export interface RelatorioComercial {
  from: string;
  to: string;
  funnel: EtapaDoRelatorio[];
  closed: { won: number; won_value_cents: number; lost: number; lost_value_cents: number };
  by_owner: Array<{ user_id: string; open: number; won: number; lost: number }>;
  queue_size: number;
  tasks: { open: number; overdue: number; done: number };
  orders: Array<{ status: string; count: number; total_cents: number }>;
}

export const DIAS_PADRAO = 30;

/** Os nomes dos indicadores que a prova recalcula — o denominador de `report_indicators`. */
export const INDICADORES = Object.freeze([
  "funnel.open",
  "funnel.value_cents",
  "closed.won",
  "closed.won_value_cents",
  "closed.lost",
  "closed.lost_value_cents",
  "by_owner.open",
  "by_owner.won",
  "queue_size",
  "tasks.open",
  "tasks.overdue",
  "tasks.done",
  "orders.count",
  "orders.total_cents",
] as const);

export function periodoPadrao(agora = new Date()): { from: Date; to: Date } {
  const to = agora;
  const from = new Date(to.getTime() - DIAS_PADRAO * 86_400_000);
  return { from, to };
}

export async function relatorioComercial(
  ctx: TenantCtx,
  periodo: { from: Date; to: Date },
  deps: { pool?: ServicePool } = {},
): Promise<RelatorioComercial> {
  if (!(periodo.from < periodo.to)) throw new RangeError("período inválido: from deve ser anterior a to");
  return withTenant(
    ctx,
    async (db) => {
      const r = await db.query<{ rel: RelatorioComercial }>(`select public.fn_crm_report($1::uuid, $2::timestamptz, $3::timestamptz) as rel`, [
        ctx.organization_id,
        periodo.from.toISOString(),
        periodo.to.toISOString(),
      ]);
      return r.rows[0]!.rel;
    },
    deps,
  );
}
