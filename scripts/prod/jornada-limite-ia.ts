/**
 * F15-T06 — a linha `ai_real:` (ADR-036 §3): o limite diário de turnos com
 * o PROVEDOR REAL, na organização do proprietário, dentro do teto que ele
 * autorizou (D54 g: ≤ 20 turnos `claude-haiku-4-5`).
 *
 * Roda DENTRO do container `crm-prod-worker` (como `jornada-sentry.ts`, F08):
 *   docker cp scripts/prod/jornada-limite-ia.ts crm-prod-worker:/app/scripts/prod-jornada-limite-ia.ts && \
 *   docker exec -w /app crm-prod-worker sh -c 'TSX_TSCONFIG_PATH=/app/tsconfig.json node --import /app/node_modules/tsx/dist/loader.mjs /app/scripts/prod-jornada-limite-ia.ts'
 *
 * O que faz, e por que é honesto:
 *  1. lê os turnos de HOJE da organização do dono e põe `ai.limits.daily_turns`
 *     em (usados + N) — N = 3 chamadas reais;
 *  2. N chamadas `ai.reply` pelo MESMO caminho do turno (`chamarModelo` →
 *     `withEntitlement` → resolver com limite diário → provedor real →
 *     `ai_usage_events`); cada uma custa de verdade e é contada;
 *  3. K = 3 tentativas depois do limite: `EntitlementDenied(daily_limit_reached)`
 *     ANTES do provedor — `calls_after_limit` é medido pelo saldo de
 *     `ai_usage_events` (G-20), não por promessa;
 *  4. o aviso `ai.limit_reached` ao tenant_admin (o próprio dono), UMA vez;
 *  5. o limite volta a 0 (sem teto) — nada fica ligado na organização do dono.
 * O verify força mock (D12); esta linha vive FORA do bloco, como `prod:`.
 */
import pg from "pg";

import { llmEdgeConfigFromEnv } from "@/lib/agent-engine/edge/llm/credentials";
import { env } from "@/lib/env";
import { chamarModelo } from "@/src/ai";
import { avisarLimiteDiario, estadoDoLimite } from "@/src/ai/limite";
import { EntitlementDenied } from "@/src/entitlement";
import { getSetting, setSetting } from "@/src/tenant-config/settings";
import type { TenantCtx } from "@/src/tenant-context";

const N = 3;
const K = 3;
const MODELO = process.env.AI_CHAT_MODEL ?? "claude-haiku-4-5";

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: env.SUPABASE_DB_URL, max: 2 });
  const cfg = llmEdgeConfigFromEnv(env);
  const dono = (process.env.OWNER_EMAIL ?? "").trim();
  if (!dono) throw new Error("OWNER_EMAIL vazio: a jornada só roda na organização do proprietário");
  const org = await pool.query<{ organization_id: string; user_id: string }>(
    `select uo.organization_id, uo.user_id from public.user_organizations uo
       join auth.users u on u.id = uo.user_id
      where lower(u.email) = lower($1) and uo.role = 'admin' and uo.revoked_at is null
      order by uo.created_at asc limit 1`,
    [dono],
  );
  const linha = org.rows[0];
  if (!linha) throw new Error("organização do proprietário não encontrada");
  const ctx: TenantCtx = { organization_id: linha.organization_id, source: "job" };
  const ctxAdmin: TenantCtx = { organization_id: linha.organization_id, source: "session", user_id: linha.user_id };
  const antes = await estadoDoLimite(ctx, { pool });
  const limiteAnterior = await getSetting(ctx, "ai.limits.daily_turns", { pool });
  await setSetting(ctxAdmin, "ai.limits.daily_turns", antes.used + N, "tenant_admin", { pool });
  const usados = async () => (await estadoDoLimite(ctx, { pool })).used;
  const custo = async () =>
    Number((await pool.query<{ c: string }>(`select coalesce(sum(estimated_cost_cents),0)::text as c from public.ai_usage_events where organization_id=$1 and operation='chat' and created_at >= $2`, [ctx.organization_id, antes.day])).rows[0]?.c ?? 0);

  let ok = 0;
  const custoAntes = await custo();
  for (let i = 0; i < N; i += 1) {
    const r = await chamarModelo(ctx, "ai.reply", {
      system: "Você é um assistente de teste. Responda apenas a palavra OK.",
      messages: [{ role: "user", content: `prova do limite diário ${i + 1}/${N}` }],
      model: MODELO,
    }, { pool, cfg });
    if (typeof r.result.text === "string") ok += 1;
  }
  const usadosAposN = await usados();
  const estadoNoLimite = await estadoDoLimite(ctx, { pool });

  let negadas = 0;
  const usadosAntesDasTentativas = await usados();
  for (let i = 0; i < K; i += 1) {
    try {
      await chamarModelo(ctx, "ai.reply", { messages: [{ role: "user", content: `tentativa depois do limite ${i + 1}` }], model: MODELO }, { pool, cfg });
    } catch (erro) {
      if (erro instanceof EntitlementDenied && erro.reason === "daily_limit_reached") negadas += 1;
      else throw erro;
    }
  }
  const chamadasDepois = (await usados()) - usadosAntesDasTentativas;
  const aviso = await avisarLimiteDiario(ctx, { pool });
  const custoDepois = await custo();

  await setSetting(ctxAdmin, "ai.limits.daily_turns", typeof limiteAnterior === "number" ? limiteAnterior : 0, "tenant_admin", { pool });
  const restaurado = await estadoDoLimite(ctx, { pool });

  console.info(
    `ai_real: turns=${ok}/${N} usage_delta=${usadosAposN - antes.used}/${N} provider=anthropic model=${MODELO} cost_cents=${custoDepois - custoAntes} ` +
      `limit_hit=${estadoNoLimite.allowed ? 0 : 1}/1 denied=${negadas}/${K} calls_after_limit=${chamadasDepois}/${K} ` +
      `paused=${aviso.notified > 0 || aviso.already ? 1 : 0}/1 notified=${aviso.notified} limit_restored=${restaurado.limit === (typeof limiteAnterior === "number" ? limiteAnterior : 0) ? 1 : 0}/1 day=${antes.day} at=${new Date().toISOString()}`,
  );
  await pool.end();
}

main().catch((erro) => {
  console.error(`ai_real: FALHOU ${erro instanceof Error ? erro.message : String(erro)}`);
  process.exit(1);
});
