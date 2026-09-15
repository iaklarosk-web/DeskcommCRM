/**
 * F15-T04 — o motor de regras do SaaS (ADR-036 §2 T04).
 *
 * Um evento do `event_log` entra; as regras ATIVAS da organização com esse
 * `trigger_event` são lidas; as condições herdadas (`lib/automation/conditions`)
 * decidem quais casam sobre o mesmo contexto (evento + lead + contato); cada
 * ação da regra é uma entrada do CATÁLOGO executada pelo caminho único
 * (`execute(ctx, {kind:"automation"}, …)`) — auditada, sujeita à política da
 * organização (F15-T01) e ao limite (F15-T02) como qualquer outra; a run vai
 * para `automation_rule_runs` (tabela herdada), e o índice único da 9027 faz
 * do redespacho do MESMO evento um `duplicate` contado, não uma segunda
 * execução.
 *
 * ─── Por que não `lib/automation/engine.ts` ────────────────────────────────
 *
 * O motor herdado é o mesmo desenho (regras por gatilho, condições, runs), mas
 * fala com o banco pelo cliente Supabase/PostgREST, que o gate de integração
 * (Postgres descartável, sem PostgREST) não tem — a prova `rules=4 runs=4/4
 * replays=4 duplicate_runs=0` precisa rodar ali. Este arquivo reusa o que é
 * puro (condições) e as tabelas; troca só o acesso (pg via `withTenant`) e o
 * vocabulário de ações (catálogo). O handler do `event_log` passa a chamar
 * este motor para TODOS os gatilhos do SaaS (`lib/automation/engine.handler.ts`).
 */
import { evaluateConditions, type RuleCondition } from "@/lib/automation/conditions";
import { execute, type ActionResult, type ExecuteDeps } from "@/src/actions/execute";
import { incrementCounter } from "@/src/obs/counters";
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";

import { acaoDeRegraSchema, ehAcaoDeRegra, entradasDaAcao, type EventoDeRegra } from "./regras";

export interface ResultadoDaAcaoDeRegra {
  readonly type: string;
  readonly status: "success" | "failed" | "skipped";
  readonly error?: string;
  readonly detail?: Record<string, unknown>;
}

export interface RunDeRegra {
  readonly rule_id: string;
  readonly rule_name: string;
  /** `duplicate` = o índice da 9027 recusou a segunda run do mesmo (regra, evento). */
  readonly status: "success" | "partial" | "failed" | "duplicate" | "no_match";
  readonly actions: readonly ResultadoDaAcaoDeRegra[];
}

export interface ResultadoDoMotor {
  readonly rules_matched: number;
  readonly runs: readonly RunDeRegra[];
}

interface LinhaDeRegra {
  id: string;
  name: string;
  conditions: RuleCondition[];
  actions: unknown[];
}

async function contextoDoEvento(db: TenantDb, ctx: TenantCtx, evento: EventoDeRegra): Promise<Record<string, unknown>> {
  const contexto: Record<string, unknown> = { event: evento.payload };
  if (evento.entity_kind === "crm_lead" && evento.entity_id !== null) {
    const lead = await db.query(`select * from public.crm_leads where organization_id=$1 and id=$2`, [ctx.organization_id, evento.entity_id]);
    const l = lead.rows[0] as { contact_id?: string | null } | undefined;
    if (l) {
      contexto.lead = l;
      if (l.contact_id) {
        const contato = await db.query(`select * from public.contacts where organization_id=$1 and id=$2`, [ctx.organization_id, l.contact_id]);
        if (contato.rows[0]) contexto.contact = contato.rows[0];
      }
    }
  } else if (typeof evento.payload["contact_id"] === "string") {
    const contato = await db.query(`select * from public.contacts where organization_id=$1 and id=$2`, [ctx.organization_id, evento.payload["contact_id"]]);
    if (contato.rows[0]) contexto.contact = contato.rows[0];
  }
  return contexto;
}

function resultadoDaExecucao(tipo: string, r: ActionResult): ResultadoDaAcaoDeRegra {
  if (r.status === "executed") return { type: tipo, status: "success", detail: { audit_id: r.audit_id, output: r.output } };
  if (r.status === "pending") return { type: tipo, status: "success", detail: { audit_id: r.audit_id, pending_action_id: r.pending_action_id ?? null } };
  return { type: tipo, status: "failed", error: `${r.reason ?? "denied"}${r.detalhe ? `:${r.detalhe}` : ""}`, detail: { audit_id: r.audit_id } };
}

/**
 * Processa UM evento para a organização dele. Idempotente por (regra, evento)
 * pelo banco: a run é reservada e COMMITADA antes das ações — se o índice da
 * 9027 recusar, nada roda (`duplicate`).
 */
export interface DepsDoMotor {
  pool?: ServicePool;
  agora?: () => Date;
  /** Seams de canal de `execute()` — a prova injeta o adapter mock. */
  adapters?: ExecuteDeps["adapters"];
  modo?: string;
}

export async function processarEventoDeRegra(
  evento: EventoDeRegra & { readonly organization_id: string },
  deps: DepsDoMotor = {},
): Promise<ResultadoDoMotor> {
  const ctx: TenantCtx = { organization_id: evento.organization_id, source: "job" };
  const regras = await withTenant(
    ctx,
    async (db) =>
      (
        await db.query<LinhaDeRegra>(
          `select id, name, conditions, actions from public.automation_rules
            where organization_id=$1 and trigger_event=$2 and is_active
            order by created_at asc, id asc`,
          [ctx.organization_id, evento.event_type],
        )
      ).rows,
    { pool: deps.pool },
  );
  if (regras.length === 0) return { rules_matched: 0, runs: [] };

  const contexto = await withTenant(ctx, (db) => contextoDoEvento(db, ctx, evento), { pool: deps.pool });
  const runs: RunDeRegra[] = [];
  let casadas = 0;
  for (const regra of regras) {
    if (!evaluateConditions(regra.conditions ?? [], contexto)) {
      runs.push({ rule_id: regra.id, rule_name: regra.name, status: "no_match", actions: [] });
      continue;
    }
    casadas += 1;
    // 1. A run nasce primeiro, `failed` por padrão, COMMITADA — o índice da
    //    9027 é a trava: redespacho do mesmo evento cai aqui e sai `duplicate`
    //    sem executar nada. Reservar e executar na mesma transação deixaria
    //    a segunda cópia esperando o lock enquanto a primeira envia.
    const runId = await withTenant(
      ctx,
      async (db) =>
        (
          await db.query<{ id: string }>(
            `insert into public.automation_rule_runs (organization_id, rule_id, event_id, status, actions_result)
             values ($1,$2,$3,'failed','[]'::jsonb)
             on conflict (rule_id, event_id) where event_id is not null and status <> 'adiado' do nothing
             returning id`,
            [ctx.organization_id, regra.id, evento.id],
          )
        ).rows[0]?.id ?? null,
      { pool: deps.pool },
    );
    if (runId === null) {
      incrementCounter("automation_run_duplicada");
      runs.push({ rule_id: regra.id, rule_name: regra.name, status: "duplicate", actions: [] });
      continue;
    }
    // 2. As ações, cada uma pelo caminho único do catálogo (transação própria).
    const resultados: ResultadoDaAcaoDeRegra[] = [];
    for (const bruta of regra.actions ?? []) {
      const tipo = typeof bruta === "object" && bruta !== null ? (bruta as { type?: unknown }).type : undefined;
      if (!ehAcaoDeRegra(tipo)) {
        // Ação fora do catálogo (regra herdada/legada): nada executa; fica dito.
        incrementCounter("automation_acao_fora_do_catalogo");
        resultados.push({ type: String(tipo), status: "failed", error: "outside_catalog" });
        continue;
      }
      const acao = acaoDeRegraSchema.safeParse(bruta);
      if (!acao.success) {
        resultados.push({ type: tipo, status: "failed", error: "invalid_config" });
        continue;
      }
      const entradas = await entradasDaAcao(ctx, acao.data, evento, { ruleId: regra.id }, { pool: deps.pool, agora: deps.agora });
      if (!entradas.ok) {
        resultados.push({ type: tipo, status: "skipped", detail: { reason: entradas.reason } });
        continue;
      }
      const r = await execute(ctx, { kind: "automation" }, tipo, entradas.input, {
        pool: deps.pool,
        requestId: `rule:${regra.id}:${evento.id}`,
        ...(deps.adapters === undefined ? {} : { adapters: deps.adapters }),
        ...(deps.modo === undefined ? {} : { modo: deps.modo }),
      });
      resultados.push(resultadoDaExecucao(tipo, r));
    }
    // 3. O desfecho na run e o contador na regra.
    const falhas = resultados.filter((r) => r.status !== "success").length;
    const status: RunDeRegra["status"] = falhas === 0 ? "success" : falhas === resultados.length ? "failed" : "partial";
    await withTenant(
      ctx,
      async (db) => {
        await db.query(`update public.automation_rule_runs set status=$2, actions_result=$3::jsonb where id=$1`, [runId, status, JSON.stringify(resultados)]);
        await db.query(`update public.automation_rules set last_run_at=now(), run_count=run_count+1 where id=$1 and organization_id=$2`, [regra.id, ctx.organization_id]);
      },
      { pool: deps.pool },
    );
    incrementCounter("automation_run", { status });
    const run: RunDeRegra = { rule_id: regra.id, rule_name: regra.name, status, actions: resultados };
    runs.push(run);
  }
  return { rules_matched: casadas, runs };
}
