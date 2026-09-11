/**
 * O USO de IA do tenant por período (§5.3, §7.6 F05-T09) — o que a tela do
 * `tenant_admin` mostra e o que a prova compara com `sum(ai_usage_events)`.
 *
 * Uma consulta, agregada no BANCO, sobre o livro-razão de §5.3
 * (`ai_usage_events`, projeção de `llm_calls` desde a F04-T08). A tela não soma
 * nada no cliente: o número que aparece é o número que o Postgres devolveu, e é
 * contra o banco que o navegador é conferido ("valor exibido = sum(...)").
 *
 * `estimated_cost_cents` é `numeric` (9018) e chega como TEXTO do driver; a
 * conversão para número acontece aqui, uma vez, e o total é somado pelo banco —
 * somar no JavaScript acumularia erro binário em cima de centavos fracionários.
 *
 * O período é FECHADO em `[desde, ate)`: `ate` exclusivo, para que "setembro"
 * seja `[2026-09-01, 2026-10-01)` e nenhum dia pertença a dois meses.
 */
import type { ServicePool } from "@/src/tenant-context/db";
import { withTenant, type TenantCtx } from "@/src/tenant-context";

export interface PeriodoDeUso {
  /** Início, inclusivo (ISO 8601). */
  readonly desde: string;
  /** Fim, EXCLUSIVO (ISO 8601). */
  readonly ate: string;
}

export interface LinhaDeUso {
  readonly model: string;
  readonly operation: string;
  readonly calls: number;
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens: number;
  readonly estimated_cost_cents: number;
}

export interface ResumoDeUso {
  readonly periodo: PeriodoDeUso;
  readonly calls: number;
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens: number;
  readonly estimated_cost_cents: number;
  readonly por_modelo: readonly LinhaDeUso[];
}

/** Período inválido é defeito do chamador, não "sem uso". */
export class PeriodoInvalido extends Error {
  constructor(public readonly campo: string) {
    super(`período de uso inválido: ${campo}`);
    this.name = "PeriodoInvalido";
  }
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` → instante UTC à meia-noite. Só datas: hora é ruído para um relatório mensal. */
function instanteDe(data: string, campo: string): Date {
  if (!DATA.test(data)) throw new PeriodoInvalido(campo);
  const d = new Date(`${data}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new PeriodoInvalido(campo);
  return d;
}

/** O mês civil (UTC) que contém `instante`: `[1º, 1º do mês seguinte)`. */
export function mesDe(instante: Date): PeriodoDeUso {
  const inicio = new Date(Date.UTC(instante.getUTCFullYear(), instante.getUTCMonth(), 1));
  const fim = new Date(Date.UTC(instante.getUTCFullYear(), instante.getUTCMonth() + 1, 1));
  return { desde: inicio.toISOString(), ate: fim.toISOString() };
}

/** O mês anterior ao que contém `instante`. */
export function mesAnteriorA(instante: Date): PeriodoDeUso {
  const inicio = new Date(Date.UTC(instante.getUTCFullYear(), instante.getUTCMonth() - 1, 1));
  return mesDe(inicio);
}

/** Um período explícito por datas; `ate` inclusivo na URL vira exclusivo aqui (+1 dia). */
export function periodoDeDatas(desde: string, ateInclusivo: string): PeriodoDeUso {
  const inicio = instanteDe(desde, "desde");
  const fim = instanteDe(ateInclusivo, "ate");
  fim.setUTCDate(fim.getUTCDate() + 1);
  if (fim.getTime() <= inicio.getTime()) throw new PeriodoInvalido("ate < desde");
  return { desde: inicio.toISOString(), ate: fim.toISOString() };
}

const n = (v: string | number | null | undefined): number => Number(v ?? 0);

export async function resumoDeUso(
  ctx: TenantCtx,
  periodo: PeriodoDeUso,
  deps: { pool?: ServicePool } = {},
): Promise<ResumoDeUso> {
  return withTenant(
    ctx,
    async (db) => {
      const linhas = await db.query<{
        model: string;
        operation: string;
        calls: string | number;
        prompt_tokens: string | number;
        completion_tokens: string | number;
        estimated_cost_cents: string | number;
      }>(
        `select model, operation,
                count(*)::int as calls,
                coalesce(sum(prompt_tokens), 0)::bigint as prompt_tokens,
                coalesce(sum(completion_tokens), 0)::bigint as completion_tokens,
                coalesce(sum(estimated_cost_cents), 0)::numeric as estimated_cost_cents
           from public.ai_usage_events
          where organization_id = $1
            and created_at >= $2::timestamptz and created_at < $3::timestamptz
          group by model, operation
          order by estimated_cost_cents desc, model asc, operation asc`,
        [ctx.organization_id, periodo.desde, periodo.ate],
      );
      const porModelo: LinhaDeUso[] = linhas.rows.map((l) => ({
        model: l.model,
        operation: l.operation,
        calls: n(l.calls),
        prompt_tokens: n(l.prompt_tokens),
        completion_tokens: n(l.completion_tokens),
        total_tokens: n(l.prompt_tokens) + n(l.completion_tokens),
        estimated_cost_cents: n(l.estimated_cost_cents),
      }));
      // Os totais vêm do BANCO numa segunda agregação, não da soma das linhas
      // acima: é o que a prova compara com `sum(ai_usage_events)`.
      const total = await db.query<{
        calls: string | number;
        prompt_tokens: string | number;
        completion_tokens: string | number;
        estimated_cost_cents: string | number;
      }>(
        `select count(*)::int as calls,
                coalesce(sum(prompt_tokens), 0)::bigint as prompt_tokens,
                coalesce(sum(completion_tokens), 0)::bigint as completion_tokens,
                coalesce(sum(estimated_cost_cents), 0)::numeric as estimated_cost_cents
           from public.ai_usage_events
          where organization_id = $1
            and created_at >= $2::timestamptz and created_at < $3::timestamptz`,
        [ctx.organization_id, periodo.desde, periodo.ate],
      );
      const t = total.rows[0];
      return {
        periodo,
        calls: n(t?.calls),
        prompt_tokens: n(t?.prompt_tokens),
        completion_tokens: n(t?.completion_tokens),
        total_tokens: n(t?.prompt_tokens) + n(t?.completion_tokens),
        estimated_cost_cents: n(t?.estimated_cost_cents),
        por_modelo: porModelo,
      };
    },
    { pool: deps.pool },
  );
}
