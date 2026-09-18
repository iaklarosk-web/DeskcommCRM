/**
 * F14-T05 — a linha `webchat_real:` (ADR-038 §4): o chat do site com o
 * PROVEDOR REAL, na organização do proprietário, dentro do teto que ele
 * autorizou (D55 f: ≤ 20 turnos `claude-haiku-4-5`).
 *
 * Roda DENTRO do container `crm-prod-worker` (como `jornada-limite-ia.ts`, F15):
 *   docker cp scripts/prod/jornada-webchat.ts crm-prod-worker:/app/scripts/prod-jornada-webchat.ts && \
 *   docker exec -w /app crm-prod-worker sh -c 'TSX_TSCONFIG_PATH=/app/tsconfig.json node --import /app/node_modules/tsx/dist/loader.mjs /app/scripts/prod-jornada-webchat.ts'
 *
 * O que faz, e por que é honesto:
 *  1. liga `webchat.enabled` e `ai.enabled` na organização do dono (guarda as LINHAS anteriores — presentes ou não — e as devolve ao fim, apagando o que não existia);
 *  2. abre UMA sessão de visitante pelo MESMO caminho da rota pública
 *     (`criarSessao`), identifica com o e-mail do PRÓPRIO dono (nenhuma pessoa
 *     que não seja ele) e manda N mensagens pelo `receberMensagemDoVisitante`;
 *  3. responde cada uma pelo turno SaaS com o provedor real (`responderTurno`
 *     → `chamarModelo` → Anthropic → `ai_usage_events`) e entrega pela fila de
 *     saída (`rodarCicloDeSaida` → adapter `webchat`), medindo `sent`;
 *  4. lê o que a página do visitante leria (`listarMensagensDoVisitante`);
 *  5. o freio: com o teto diário posto em (usados+N), a (N+1)ª resposta é negada
 *     ANTES do provedor (`flood_capped`);
 *  6. apaga sessão, conversa, mensagens e o contato criado (`cleaned`) e devolve
 *     `webchat.enabled` e o limite ao que eram — nada fica ligado na organização.
 * O verify força mock (D12); esta linha vive FORA do bloco, como `ai_real:`.
 */
import { randomUUID } from "node:crypto";

import pg from "pg";

import { llmEdgeConfigFromEnv } from "@/lib/agent-engine/edge/llm/credentials";
import { env } from "@/lib/env";
import { responderTurno } from "@/src/ai";
import { estadoDoLimite } from "@/src/ai/limite";
import { rodarCicloDeSaida } from "@/src/jobs/outbound-worker";
import { getSetting, getStoredSetting, setSetting } from "@/src/tenant-config/settings";
import type { TenantCtx } from "@/src/tenant-context";
import { criarSessao, identificar, listarMensagensDoVisitante, receberMensagemDoVisitante, sessaoPorToken } from "@/src/webchat";

const N = 3;
const MODELO = process.env.AI_CHAT_MODEL ?? "claude-haiku-4-5";

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: env.SUPABASE_DB_URL, max: 2 });
  const cfg = llmEdgeConfigFromEnv(env);
  const dono = (process.env.OWNER_EMAIL ?? "").trim();
  if (!dono) throw new Error("OWNER_EMAIL vazio: a jornada só roda na organização do proprietário");
  const org = await pool.query<{ organization_id: string; user_id: string; slug: string }>(
    `select uo.organization_id, uo.user_id, o.slug::text as slug from public.user_organizations uo
       join auth.users u on u.id = uo.user_id
       join public.organizations o on o.id = uo.organization_id
      where lower(u.email) = lower($1) and uo.role = 'admin' and uo.revoked_at is null
      order by uo.created_at asc limit 1`,
    [dono],
  );
  const linha = org.rows[0];
  if (!linha) throw new Error("organização do proprietário não encontrada");
  const ctx: TenantCtx = { organization_id: linha.organization_id, source: "job" };
  const ctxAdmin: TenantCtx = { organization_id: linha.organization_id, source: "session", user_id: linha.user_id };
  const deps = { pool, salDoIp: env.INTERNAL_SECRET };

  // Guarda a LINHA (presente ou não), não o valor efetivo: devolver o padrão
  // como valor gravado deixaria três linhas novas em tenant_settings que não
  // existiam antes — foi o que a primeira rodada fez (ai.enabled=true gravado).
  const CHAVES = ["webchat.enabled", "ai.enabled", "ai.limits.daily_turns"] as const;
  const linhasAntes = new Map<string, { present: boolean; value: unknown }>();
  for (const chave of CHAVES) linhasAntes.set(chave, await getStoredSetting(ctx, chave, { pool }));
  const ligadoAntes = await getSetting(ctx, "webchat.enabled", { pool });
  const iaAntes = await getSetting(ctx, "ai.enabled", { pool });
  const devolverLinhas = async () => {
    for (const chave of CHAVES) {
      const linha = linhasAntes.get(chave);
      if (linha?.present) await setSetting(ctxAdmin, chave, linha.value, "tenant_admin", { pool });
      else await pool.query(`delete from public.tenant_settings where organization_id=$1 and key=$2`, [ctx.organization_id, chave]);
    }
  };
  const linhasIguais = async () => {
    for (const chave of CHAVES) {
      const agora = await getStoredSetting(ctx, chave, { pool });
      const antes = linhasAntes.get(chave);
      if (agora.present !== antes?.present || JSON.stringify(agora.value) !== JSON.stringify(antes?.value)) return false;
    }
    return true;
  };
  const antes = await estadoDoLimite(ctx, { pool });
  const custo = async () =>
    Number((await pool.query<{ c: string }>(`select coalesce(sum(estimated_cost_cents),0)::text as c from public.ai_usage_events where organization_id=$1 and operation='chat' and created_at >= $2`, [ctx.organization_id, antes.day])).rows[0]?.c ?? 0);
  const custoAntes = await custo();

  let sessaoId: string | null = null;
  let contatoId: string | null = null;
  let conversaId: string | null = null;
  let contatoNovo = false;
  let turnos = 0, entregues = 0, negadas = 0, vistas = 0, chamadasDepois = 0;
  try {
    await setSetting(ctxAdmin, "webchat.enabled", true, "tenant_admin", { pool });
    await setSetting(ctxAdmin, "ai.enabled", true, "tenant_admin", { pool });
    await setSetting(ctxAdmin, "ai.limits.daily_turns", antes.used + N, "tenant_admin", { pool });
    const aberta = await criarSessao({ slug: linha.slug, ip: "127.0.0.1", page_url: "https://crm.kntecnologia.app/chat-prova" }, deps);
    if (!aberta.ok) throw new Error(`sessão recusada: ${aberta.reason}`);
    sessaoId = aberta.sessao.id;
    const existente = await pool.query<{ id: string }>(`select id from public.contacts where organization_id=$1 and email_normalized=lower($2) and is_merged_into is null limit 1`, [ctx.organization_id, dono]);
    contatoNovo = existente.rows.length === 0;
    const ident = await identificar(aberta.sessao, { name: "Proprietário (prova F14)", contact: dono }, deps);
    if (!ident.ok) throw new Error(`identificação recusada: ${ident.reason}`);
    contatoId = ident.contact_id;
    conversaId = ident.conversation_id;
    const viva = await sessaoPorToken(linha.slug, aberta.token, deps);
    if (viva === null) throw new Error("sessão sumiu");
    for (let i = 0; i < N; i += 1) {
      const r = await receberMensagemDoVisitante(viva, { client_message_id: randomUUID(), body: `Prova do chat do site ${i + 1}/${N}: responda só a palavra OK.` }, deps);
      if (!r.ok) throw new Error(`mensagem ${i + 1} recusada: ${r.reason}`);
      const t = await responderTurno(ctx, { conversation_id: conversaId, mensagem_do_cliente: `Prova do chat do site ${i + 1}/${N}: responda só a palavra OK.` }, { pool, cfg, env: { ...process.env, AI_CHAT_MODEL: MODELO } });
      if (t.status === "respondido") turnos += 1;
      else console.error(`turno ${i + 1}: status=${t.status} motivo=${String((t as { motivo?: unknown }).motivo ?? "")}`);
      for (let ciclo = 0; ciclo < 5; ciclo += 1) await rodarCicloDeSaida({ pool, lote: 50, backoffMs: [0, 0] });
    }
    entregues = Number((await pool.query<{ n: string }>(`select count(*)::text as n from public.messages where conversation_id=$1 and direction='outbound' and status='sent'`, [conversaId])).rows[0]?.n ?? 0);
    vistas = (await listarMensagensDoVisitante(viva, null, deps)).filter((m) => m.author === "ai").length;
    // O freio: a (N+1)ª é negada ANTES do provedor (saldo de ai_usage_events inalterado).
    const usadosAntes = (await estadoDoLimite(ctx, { pool })).used;
    const extra = await receberMensagemDoVisitante(viva, { client_message_id: randomUUID(), body: "e mais uma?" }, deps);
    if (!extra.ok) throw new Error(`mensagem extra recusada: ${extra.reason}`);
    const t = await responderTurno(ctx, { conversation_id: conversaId, mensagem_do_cliente: "e mais uma?" }, { pool, cfg, env: { ...process.env, AI_CHAT_MODEL: MODELO } });
    // O freio bate numa de duas camadas, as duas ANTES do provedor: a guarda
    // `ai_available` da entrada (a conversa vai para `waiting_human` e o turno é
    // silenciado) ou o próprio turno (`handoff` por `tenant_rule`). Medido: a
    // primeira — o entitlement com o limite diário nega já na entrada.
    const estadoDaConversa = (await pool.query<{ saas_state: string }>(`select saas_state from public.conversations where id=$1`, [conversaId])).rows[0]?.saas_state;
    const negadaNoTurno = t.status === "handoff" && t.motivo === "tenant_rule";
    const negadaNaEntrada = t.status === "silenciado" && estadoDaConversa === "waiting_human";
    if (negadaNoTurno || negadaNaEntrada) negadas += 1;
    else console.error(`extra: status=${t.status} motivo=${String((t as { motivo?: unknown }).motivo ?? "")} estado=${estadoDaConversa} usados=${usadosAntes} limite=${antes.used + N}`);
    chamadasDepois = (await estadoDoLimite(ctx, { pool })).used - usadosAntes;
    console.error(`freio: camada=${negadaNoTurno ? "turno" : negadaNaEntrada ? "entrada(ai_available)" : "nenhuma"} estado=${estadoDaConversa}`);
  } finally {
    // Limpeza: nada da prova fica na organização do dono.
    if (conversaId) {
      await pool.query(`delete from public.handoffs where organization_id=$1 and conversation_id=$2`, [ctx.organization_id, conversaId]);
      await pool.query(`delete from public.messages where organization_id=$1 and conversation_id=$2`, [ctx.organization_id, conversaId]);
      await pool.query(`update public.webchat_sessions set conversation_id=null where conversation_id=$1`, [conversaId]);
      await pool.query(`delete from public.conversations where organization_id=$1 and id=$2`, [ctx.organization_id, conversaId]);
    }
    if (sessaoId) await pool.query(`delete from public.webchat_sessions where id=$1`, [sessaoId]);
    if (contatoId && contatoNovo) await pool.query(`delete from public.contacts where organization_id=$1 and id=$2`, [ctx.organization_id, contatoId]);
    await devolverLinhas();
  }
  const restante = Number((await pool.query<{ n: string }>(`select count(*)::text as n from public.webchat_sessions where organization_id=$1`, [ctx.organization_id])).rows[0]?.n ?? 0);
  const ligadoDepois = await getSetting(ctx, "webchat.enabled", { pool });
  const iaDepois = await getSetting(ctx, "ai.enabled", { pool });
  const linhasDevolvidas = await linhasIguais();
  const custoDepois = await custo();
  console.info(
    `webchat_real: sessions=1/1 identified=1/1 turns=${turnos}/${N} delivered=${entregues}/${N} visible=${vistas}/${N} provider=anthropic model=${MODELO} cost_cents=${(custoDepois - custoAntes).toFixed(5)} ` +
      `flood_capped=${negadas}/1 calls_after_limit=${chamadasDepois}/1 cleaned=${restante === 0 && ligadoDepois === (ligadoAntes === true) && iaDepois === (iaAntes === true) && linhasDevolvidas ? 1 : 0}/1 settings_rows_restored=${linhasDevolvidas ? 1 : 0}/1 at=${new Date().toISOString()}`,
  );
  await pool.end();
}

main().catch((erro) => {
  console.error(`webchat_real: FALHOU ${erro instanceof Error ? erro.message : String(erro)}`);
  process.exit(1);
});
