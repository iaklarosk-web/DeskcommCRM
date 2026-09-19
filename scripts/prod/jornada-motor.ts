/**
 * F18-T05 — a linha `engine_real:` (ADR-040 §1): o DESPACHO em produção,
 * respondido pelo motor NOVO, com o provedor real, na organização do
 * proprietário e dentro do teto que ele autorizou (D56 f: ≤ 20 turnos
 * `claude-haiku-4-5`, somados aos da F14 no mesmo dia).
 *
 * Roda DENTRO do container `crm-prod-worker`:
 *   docker cp scripts/prod/jornada-motor.ts crm-prod-worker:/app/scripts/prod-jornada-motor.ts && \
 *   docker exec -w /app crm-prod-worker sh -c 'TSX_TSCONFIG_PATH=/app/tsconfig.json node --import /app/node_modules/tsx/dist/loader.mjs /app/scripts/prod-jornada-motor.ts'
 *
 * A DIFERENÇA para a jornada da F14, e é ela que justifica esta fase: lá o
 * turno era chamado à mão (`responderTurno`), aqui a mensagem do visitante
 * entra pelo mesmo caminho do produto e quem decide o motor é o roteamento do
 * despacho (`createInboundTurnHandler` → `motorDaOrganizacao`). O que se mede é
 * QUEM respondeu:
 *
 *  1. o padrão da organização é lido, não escrito: `ai.engine` ausente = `saas`;
 *  2. uma sessão de visitante, identificada com o e-mail do PRÓPRIO dono;
 *  3. a mensagem entra por `receberMensagemDoVisitante` (a mesma rota pública),
 *     que emite `ai_agent.dispatch_requested` — como qualquer canal;
 *  4. o job `inbound_turn` é processado pelo handler REAL, com o pool real;
 *  5. mede: resposta entregue e visível na página, consumo em `ai_usage_events`
 *     (o provedor foi chamado de verdade) e `action_runs`/`audit_events` — as
 *     travas da F15 valendo no caminho que antes não as tinha;
 *  6. troca para `legacy` e repete UMA vez: o herdado não responde (não há
 *     agente publicado nesta organização) — é a volta atrás, medida, não dita;
 *  7. apaga tudo e devolve as LINHAS de settings ao estado anterior.
 */
import { randomUUID } from "node:crypto";

import pg from "pg";

import { env } from "@/lib/env";
import { estadoDoLimite } from "@/src/ai/limite";
import { rodarCicloDeSaida } from "@/src/jobs/outbound-worker";
import { getSetting, getStoredSetting, setSetting } from "@/src/tenant-config/settings";
import type { TenantCtx } from "@/src/tenant-context";
import { criarSessao, identificar, listarMensagensDoVisitante, receberMensagemDoVisitante, sessaoPorToken } from "@/src/webchat";

const N = 3;
const MODELO = process.env.AI_CHAT_MODEL ?? "claude-haiku-4-5";

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: env.SUPABASE_DB_URL, max: 2 });
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
  let turnos = 0, entregues = 0, negadas = 0, vistas = 0, chamadasDepois = 0, voltaAtras = 0;
  try {
    await setSetting(ctxAdmin, "webchat.enabled", true, "tenant_admin", { pool });
    await setSetting(ctxAdmin, "ai.enabled", true, "tenant_admin", { pool });
    await setSetting(ctxAdmin, "ai.limits.daily_turns", antes.used + N, "tenant_admin", { pool });
    const aberta = await criarSessao({ slug: linha.slug, ip: "127.0.0.1", page_url: "https://crm.kntecnologia.app/chat-prova" }, deps);
    if (!aberta.ok) throw new Error(`sessão recusada: ${aberta.reason}`);
    sessaoId = aberta.sessao.id;
    const existente = await pool.query<{ id: string }>(`select id from public.contacts where organization_id=$1 and email_normalized=lower($2) and is_merged_into is null limit 1`, [ctx.organization_id, dono]);
    contatoNovo = existente.rows.length === 0;
    const ident = await identificar(aberta.sessao, { name: "Proprietário (prova F18)", contact: dono }, deps);
    if (!ident.ok) throw new Error(`identificação recusada: ${ident.reason}`);
    contatoId = ident.contact_id;
    conversaId = ident.conversation_id;
    const viva = await sessaoPorToken(linha.slug, aberta.token, deps);
    if (viva === null) throw new Error("sessão sumiu");

    // Quantas respostas da IA já existem nesta conversa (base da espera).
    const respostasDaIa = async (): Promise<number> =>
      Number(
        (
          await pool.query<{ n: string }>(
            `select count(*)::text as n from public.messages
              where organization_id=$1 and conversation_id=$2 and direction='outbound'`,
            [ctx.organization_id, conversaId],
          )
        ).rows[0]?.n ?? 0,
      );

    /** Espera o WORKER responder — não chamamos o turno; quem chama é o despacho. */
    const esperarResposta = async (alvo: number, segundos = 120): Promise<boolean> => {
      for (let i = 0; i < segundos; i += 1) {
        if ((await respostasDaIa()) >= alvo) return true;
        await new Promise((r) => setTimeout(r, 1000));
      }
      return false;
    };

    for (let i = 0; i < N; i += 1) {
      const r = await receberMensagemDoVisitante(
        viva,
        { client_message_id: randomUUID(), body: `Prova do motor ${i + 1}/${N}: responda só a palavra OK.` },
        deps,
      );
      if (!r.ok) throw new Error(`mensagem ${i + 1} recusada: ${r.reason}`);
      // Nada de `responderTurno` aqui: a mensagem emitiu `ai_agent.dispatch_requested`
      // e o worker de produção decide o motor pela chave da organização. É
      // exatamente isso que a F18 mudou, e é isso que esta espera mede.
      if (await esperarResposta(i + 1)) turnos += 1;
      else console.error(`turno ${i + 1}: o despacho não respondeu em 120 s`);
      for (let ciclo = 0; ciclo < 5; ciclo += 1) await rodarCicloDeSaida({ pool, lote: 50, backoffMs: [0, 0] });
    }
    entregues = Number(
      (
        await pool.query<{ n: string }>(
          `select count(*)::text as n from public.messages where conversation_id=$1 and direction='outbound' and status='sent'`,
          [conversaId],
        )
      ).rows[0]?.n ?? 0,
    );
    vistas = (await listarMensagensDoVisitante(viva, null, deps)).filter((m) => m.author === "ai").length;

    // O freio da F15 no caminho do DESPACHO: com o teto batido, a próxima não
    // vira resposta — e nenhum byte novo sai para o provedor.
    const usadosAntes = (await estadoDoLimite(ctx, { pool })).used;
    const extra = await receberMensagemDoVisitante(viva, { client_message_id: randomUUID(), body: "e mais uma?" }, deps);
    if (!extra.ok) throw new Error(`mensagem extra recusada: ${extra.reason}`);
    const respondeuAlemDoTeto = await esperarResposta(N + 1, 45);
    if (!respondeuAlemDoTeto) negadas += 1;
    else console.error("extra: o teto diário NÃO segurou — houve resposta além do limite");
    chamadasDepois = (await estadoDoLimite(ctx, { pool })).used - usadosAntes;

    // A volta atrás, medida: com `legacy`, quem responderia é o motor herdado —
    // e esta organização não tem agente publicado, então NINGUÉM responde. É a
    // prova de que a chave decide o caminho, não o acaso.
    await setSetting(ctxAdmin, "ai.limits.daily_turns", antes.used + N + 5, "tenant_admin", { pool });
    await setSetting(ctxAdmin, "ai.engine", "legacy", "tenant_admin", { pool });
    const antesDoLegacy = await respostasDaIa();
    const noLegacy = await receberMensagemDoVisitante(viva, { client_message_id: randomUUID(), body: "e agora, quem responde?" }, deps);
    if (!noLegacy.ok) throw new Error(`mensagem legacy recusada: ${noLegacy.reason}`);
    await new Promise((r) => setTimeout(r, 45_000));
    const depoisDoLegacy = await respostasDaIa();
    voltaAtras = depoisDoLegacy === antesDoLegacy ? 1 : 0;
    if (voltaAtras === 0) console.error("volta atrás: com ai.engine=legacy ALGUÉM respondeu — o roteamento não obedeceu à chave");
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
    `engine_real: dispatch_turns=${turnos}/${N} delivered=${entregues}/${N} visible=${vistas}/${N} volta_atras=${voltaAtras}/1 provider=anthropic model=${MODELO} cost_cents=${(custoDepois - custoAntes).toFixed(5)} ` +
      `limite_segurou=${negadas}/1 calls_after_limit=${chamadasDepois}/1 cleaned=${restante === 0 && ligadoDepois === (ligadoAntes === true) && iaDepois === (iaAntes === true) && linhasDevolvidas ? 1 : 0}/1 settings_rows_restored=${linhasDevolvidas ? 1 : 0}/1 at=${new Date().toISOString()}`,
  );
  await pool.end();
}

main().catch((erro) => {
  console.error(`webchat_real: FALHOU ${erro instanceof Error ? erro.message : String(erro)}`);
  process.exit(1);
});
