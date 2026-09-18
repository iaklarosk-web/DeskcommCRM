/**
 * F14 — chat do site, agenda adotada e IA que marca horário (ADR-038; ADR-039 §2).
 *
 * Grava a linha `channels:` do bloco (`gravarLinhaDoVerify`) no ÚLTIMO caso,
 * com todos os campos medidos aqui — cada um com denominador (G-14). Roda no
 * Postgres descartável do `test:integration`, com o provedor de IA dublado
 * (`createFakeRegistry`) e o canal `webchat` de verdade (adapter sem transporte).
 *
 * T01 (este arquivo, parte 1): sessão anônima, identificação → contato +
 * conversa, mensagem → mesmo fim de caminho (`concluirEntrada`), resposta da
 * IA pelo turno, entrega pelo adapter `webchat`, três freios (IP sessões, IP
 * mensagens, organização), enxurrada de 50 sessões ≤ teto da F15, token de A
 * no slug de B recusado, janela desarmada pela capability `liveVisitor`.
 */
import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { capabilitiesOf } from "@/lib/channels/capabilities";
import { decidePacing } from "@/lib/agent-engine/pacing/engine";
import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { createFakeRegistry } from "@/lib/agent-engine/edge/llm/providers";
import { comoTextoDoProvedor, responderTurno } from "@/src/ai";
import { rodarCicloDeSaida } from "@/src/jobs/outbound-worker";
import { setSetting } from "@/src/tenant-config/settings";
import type { TenantCtx } from "@/src/tenant-context";
import { ROLE_RANK } from "@/lib/auth/types";
import { confirm } from "@/src/actions/confirm";
import { execute } from "@/src/actions/execute";
import { toolsFor } from "@/src/actions/catalog";
import { cancelar, horariosLivresDaOrganizacao, marcar, remarcar } from "@/src/agenda";
import { can, type PapelD15 } from "@/src/rbac/matrix";
import {
  criarSessao,
  estadoDaConversaDoVisitante,
  hashDoIp,
  identificar,
  janelaDoHumano,
  listarMensagensDoVisitante,
  receberMensagemDoVisitante,
  sessaoPorToken,
  LIMITES_DO_WEBCHAT,
} from "@/src/webchat";

import { gravarLinhaDoVerify } from "@/tests/lib/verify-metrics";

import { CFG_LLM, semearTenant, type ConfigDeTenant } from "./f04-turno-fixtures";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`, max: 4 });

const ORG_A = "f1400001-0000-4000-8000-00000000000a";
const ORG_B = "f1400001-0000-4000-8000-00000000000b";
const ADMIN_A = "f1400001-1000-4000-8000-00000000000a";
const SAL = "sal-ficticio-da-f14";
const IP_1 = "203.0.113.10";
const IP_2 = "203.0.113.20";

const tenant = (org: string, slug: string, usuario: string, sessao: string): ConfigDeTenant => ({
  org,
  slug,
  usuario,
  sessao,
  conta: `${slug}-conta`,
  contatos: [],
  conversas: [],
  produtos: [],
  materiais: [],
  settings: { "ai.enabled": true, "ai.unknown_answer": "Ainda não tenho essa informação aqui.", "ai.confidence_threshold": 0.6 },
});
const TENANT_A = tenant(ORG_A, "f14-site-a", ADMIN_A, "f1400001-3000-4000-8000-00000000000a");
const TENANT_B = tenant(ORG_B, "f14-site-b", "f1400001-1000-4000-8000-00000000000b", "f1400001-3000-4000-8000-00000000000b");
const ctxAdminA: TenantCtx = { organization_id: ORG_A, source: "session", user_id: ADMIN_A };
const ctxJobA: TenantCtx = { organization_id: ORG_A, source: "job" };
const deps = { pool, salDoIp: SAL };

const medidas = {
  webchat_sessions: 0,
  identified: 0,
  identified_total: 0,
  contacts_created: 0,
  contacts_total: 0,
  messages_in: 0,
  ai_replies: 0,
  ai_replies_total: 0,
  ai_outside_window: 0,
  ip_limited: 0,
  org_limited: 0,
  flood_calls_capped: 0,
  cross_org_denied: 0,
  handoff_queued: 0,
  roles_denied: 0,
  roles_denied_total: 0,
  appointments: 0,
  conflicts_blocked: 0,
  revoked_blocked: 0,
  tz_ok: 0,
  proposed: 0,
  proposed_total: 0,
  approved: 0,
  denied_by_policy: 0,
};
const ATENDENTE_A = "f1400001-1002-4000-8000-00000000000a";
const TIPO_A = "f1400001-8000-4000-8000-00000000000a";
const CONEXAO_A = "f1400001-9000-4000-8000-00000000000a";
const CAL_A = "f1400001-9100-4000-8000-00000000000a";
/** Terça, 06/10/2026, 14:00 em São Paulo (UTC-3) = 17:00Z — dentro da jornada 09–18 do atendente. */
const TERCA_14H_SP = new Date("2026-10-06T17:00:00.000Z");
const AGORA_FIXO = () => new Date("2026-10-01T12:00:00.000Z");

function registroQueResponde(handoff: { wanted: boolean; reason: "customer_request" | null } = { wanted: false, reason: null }) {
  const estado = { chamadas: 0 };
  const registry = createFakeRegistry(async () => {
    estado.chamadas += 1;
    return {
      content: [{ type: "text" as const, text: comoTextoDoProvedor({ reply: handoff.wanted ? "Vou chamar uma pessoa da equipe." : "Olá! Posso ajudar com o seu pedido.", intent: "saudacao", confidence: 0.95, tool_calls: [], handoff }) }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
      warnings: [],
    };
  });
  return { registry, estado };
}
const depsDoTurno = (registry: ReturnType<typeof createFakeRegistry>) => ({ pool, cfg: CFG_LLM, registry, modo: "mock" });

async function conta(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

async function abrirIdentificada(slug: string, ip: string, nome: string, contato: string) {
  const sessao = await criarSessao({ slug, ip }, deps);
  if (!sessao.ok) throw new Error(`sessão recusada: ${sessao.reason}`);
  const ident = await identificar(sessao.sessao, { name: nome, contact: contato }, deps);
  if (!ident.ok) throw new Error(`identificação recusada: ${ident.reason}`);
  const viva = await sessaoPorToken(slug, sessao.token, deps);
  if (viva === null) throw new Error("sessão sumiu depois de identificar");
  return { token: sessao.token, sessao: viva, ident };
}

/** Visitante identificado que JÁ FALOU: a conversa está em `ai_handling` — é de onde a IA propõe. */
async function visitanteQueFalou(ip: string, nome: string, contato: string, texto: string) {
  const v = await abrirIdentificada(TENANT_A.slug, ip, nome, contato);
  medidas.webchat_sessions += 1;
  medidas.identified_total += 1;
  medidas.identified += 1;
  medidas.contacts_total += 1;
  medidas.contacts_created += v.ident.created_contact ? 1 : 0;
  const r = await receberMensagemDoVisitante(v.sessao, { client_message_id: randomUUID(), body: texto }, deps);
  if (!r.ok) throw new Error(`mensagem recusada: ${r.reason}`);
  medidas.messages_in += 1;
  return v;
}

beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await semearTenant(client, TENANT_A);
    await semearTenant(client, TENANT_B);
    await client.query("commit");
  } catch (erro) {
    await client.query("rollback");
    throw erro;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await pool.end();
});

describe("F14-T01 — sessão anônima do visitante", () => {
  it("chat desligado (default) recusa; ligado abre sessão com token de 64 hex e só o hash no banco", async () => {
    const recusada = await criarSessao({ slug: TENANT_A.slug, ip: IP_1 }, deps);
    expect(recusada.ok).toBe(false);
    if (recusada.ok) throw new Error("inalcançável");
    expect(recusada.reason).toBe("webchat_disabled");

    await setSetting(ctxAdminA, "webchat.enabled", true, "tenant_admin", { pool });
    const aberta = await criarSessao({ slug: TENANT_A.slug, ip: IP_1, page_url: "https://site-a.ficticio.test/" }, deps);
    expect(aberta.ok).toBe(true);
    if (!aberta.ok) throw new Error("inalcançável");
    expect(aberta.token).toMatch(/^[0-9a-f]{64}$/);
    const linha = await pool.query<{ token_hash: string; identified_at: string | null; ip_hash: string }>(
      `select token_hash, identified_at::text, ip_hash from public.webchat_sessions where id=$1`, [aberta.sessao.id]);
    expect(linha.rows[0]?.token_hash).not.toBe(aberta.token);
    expect(linha.rows[0]?.identified_at).toBeNull();
    expect(linha.rows[0]?.ip_hash).toBe(hashDoIp(IP_1, SAL));
    medidas.webchat_sessions += 1;
    const desconhecida = await criarSessao({ slug: "nao-existe-f14", ip: IP_1 }, deps);
    expect(desconhecida.ok === false && desconhecida.reason).toBe("unknown_organization");
    console.info("f14-t01-sessao: disabled_denied=1/1 opened=1/1 unknown_org_denied=1/1");
  });

  it("token de A apresentado ao slug de B é recusado (cross_org_denied)", async () => {
    await setSetting({ organization_id: ORG_B, source: "session", user_id: TENANT_B.usuario }, "webchat.enabled", true, "tenant_admin", { pool });
    const a = await criarSessao({ slug: TENANT_A.slug, ip: IP_2 }, deps);
    if (!a.ok) throw new Error("sessão A recusada");
    medidas.webchat_sessions += 1;
    expect(await sessaoPorToken(TENANT_A.slug, a.token, deps)).not.toBeNull();
    expect(await sessaoPorToken(TENANT_B.slug, a.token, deps)).toBeNull();
    expect(await sessaoPorToken(TENANT_A.slug, "f".repeat(64), deps)).toBeNull();
    medidas.cross_org_denied = 1;
    console.info("f14-t01-cross-org: cross_org_denied=1/1 unknown_token_denied=1/1");
  });
});

describe("F14-T01 — identificação → contato e conversa; mensagem → mesmo fim de caminho", () => {
  it("nome + e-mail vira contato do CRM e conversa channel=webchat; a mesma pessoa numa sessão nova reencontra os dois", async () => {
    const antes = await conta(`select count(*)::text as n from public.contacts where organization_id=$1`, [ORG_A]);
    const s1 = await abrirIdentificada(TENANT_A.slug, IP_1, "Ana Visitante", "Ana.Visitante@ficticio.test");
    medidas.webchat_sessions += 1;
    medidas.identified_total += 1;
    medidas.identified += s1.sessao.identified_at === null ? 0 : 1;
    medidas.contacts_total += 1;
    medidas.contacts_created += s1.ident.created_contact ? 1 : 0;
    const contato = await pool.query<{ email: string; source: string; name: string }>(`select email, source, name from public.contacts where id=$1`, [s1.ident.contact_id]);
    expect(contato.rows[0]).toMatchObject({ email: "ana.visitante@ficticio.test", source: "webchat", name: "Ana Visitante" });
    const conversa = await pool.query<{ channel: string; saas_state: string; provider: string }>(
      `select c.channel, c.saas_state, cs.provider from public.conversations c join public.channel_sessions cs on cs.id=c.channel_session_id where c.id=$1`,
      [s1.ident.conversation_id]);
    expect(conversa.rows[0]).toMatchObject({ channel: "webchat", provider: "webchat" });
    expect(await conta(`select count(*)::text as n from public.contacts where organization_id=$1`, [ORG_A])).toBe(antes + 1);

    // Mesma pessoa, sessão nova (outro navegador): reencontra contato e conversa.
    const s2 = await abrirIdentificada(TENANT_A.slug, IP_1, "Ana V.", "ana.visitante@ficticio.test");
    medidas.webchat_sessions += 1;
    medidas.identified_total += 1;
    medidas.identified += s2.sessao.identified_at === null ? 0 : 1;
    expect(s2.ident.created_contact).toBe(false);
    expect(s2.ident.contact_id).toBe(s1.ident.contact_id);
    expect(s2.ident.conversation_id).toBe(s1.ident.conversation_id);

    // Telefone também identifica; identificação pela metade é recusada.
    const s3 = await abrirIdentificada(TENANT_A.slug, IP_2, "Bruno Visitante", "(11) 93456-7890");
    medidas.webchat_sessions += 1;
    medidas.identified_total += 1;
    medidas.identified += s3.sessao.identified_at === null ? 0 : 1;
    medidas.contacts_total += 1;
    medidas.contacts_created += s3.ident.created_contact ? 1 : 0;
    const fone = await pool.query<{ phone_number: string }>(`select phone_number from public.contacts where id=$1`, [s3.ident.contact_id]);
    expect(fone.rows[0]?.phone_number).toBe("+11934567890");
    const anonima = await criarSessao({ slug: TENANT_A.slug, ip: IP_2 }, deps);
    if (!anonima.ok) throw new Error("sessão recusada");
    medidas.webchat_sessions += 1;
    expect(await identificar(anonima.sessao, { name: "X", contact: "sem-contato" }, deps)).toMatchObject({ ok: false, reason: "invalid_name" });
    expect(await identificar(anonima.sessao, { name: "Carla", contact: "sem-contato" }, deps)).toMatchObject({ ok: false, reason: "invalid_contact" });
    console.info(`f14-t01-identificacao: identified=${medidas.identified}/${medidas.identified_total} contacts_created=${medidas.contacts_created}/${medidas.contacts_total} reused=1/1 half_denied=2/2`);
  });

  it("sessão sem identificação não fala; identificada, a mensagem entra pelo mesmo fim de caminho e a reentrega não duplica", async () => {
    const anonima = await criarSessao({ slug: TENANT_A.slug, ip: IP_2 }, deps);
    if (!anonima.ok) throw new Error("sessão recusada");
    medidas.webchat_sessions += 1;
    expect(await receberMensagemDoVisitante(anonima.sessao, { client_message_id: randomUUID(), body: "oi" }, deps)).toMatchObject({ ok: false, reason: "not_identified" });

    const s = await abrirIdentificada(TENANT_A.slug, IP_2, "Dora Visitante", "dora@ficticio.test");
    medidas.webchat_sessions += 1;
    medidas.identified_total += 1;
    medidas.identified += 1;
    medidas.contacts_total += 1;
    medidas.contacts_created += s.ident.created_contact ? 1 : 0;
    const clientId = randomUUID();
    const r1 = await receberMensagemDoVisitante(s.sessao, { client_message_id: clientId, body: "Quero saber o prazo de entrega" }, deps);
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error("inalcançável");
    expect(r1.entrada.status).toBe("ingerido");
    medidas.messages_in += 1;
    const r2 = await receberMensagemDoVisitante(s.sessao, { client_message_id: clientId, body: "Quero saber o prazo de entrega" }, deps);
    expect(r2.ok && r2.entrada.status).toBe("duplicado");
    const linhas = await pool.query<{ provider: string; direction: string; external_id: string; saas_state: string }>(
      `select m.provider, m.direction, m.external_id, c.saas_state from public.messages m join public.conversations c on c.id=m.conversation_id where m.conversation_id=$1`,
      [s.ident.conversation_id]);
    expect(linhas.rows).toHaveLength(1);
    expect(linhas.rows[0]).toMatchObject({ provider: "webchat", direction: "inbound", external_id: clientId });
    const despachos = await conta(
      `select count(*)::text as n from public.event_log where organization_id=$1 and event_type='ai_agent.dispatch_requested' and payload->>'conversation_id'=$2`,
      [ORG_A, s.ident.conversation_id]);
    expect(despachos).toBe(1);
    expect(await receberMensagemDoVisitante(s.sessao, { client_message_id: randomUUID(), body: "   " }, deps)).toMatchObject({ ok: false, reason: "empty_body" });
    console.info(`f14-t01-entrada: not_identified_denied=1/1 ingested=1/1 replay_ignored=1/1 dispatch_events=${despachos}/1`);
  });

  it("a IA responde pelo turno, o adapter webchat entrega gravando e a página do visitante lê as duas mensagens", async () => {
    const s = await abrirIdentificada(TENANT_A.slug, IP_1, "Eva Visitante", "eva@ficticio.test");
    medidas.webchat_sessions += 1;
    medidas.identified_total += 1;
    medidas.identified += 1;
    medidas.contacts_total += 1;
    medidas.contacts_created += s.ident.created_contact ? 1 : 0;
    const r = await receberMensagemDoVisitante(s.sessao, { client_message_id: randomUUID(), body: "Vocês entregam no sábado?" }, deps);
    if (!r.ok) throw new Error(`mensagem recusada: ${r.reason}`);
    medidas.messages_in += 1;
    const { registry, estado } = registroQueResponde();
    const turno = await responderTurno(ctxJobA, { conversation_id: s.ident.conversation_id, mensagem_do_cliente: "Vocês entregam no sábado?" }, depsDoTurno(registry));
    medidas.ai_replies_total += 1;
    expect(turno.status).toBe("respondido");
    expect(estado.chamadas).toBe(1);
    // A fila de saída é do banco inteiro (as outras suítes do gate deixam jobs
    // nela): roda ciclos até a NOSSA mensagem sair, com lote largo.
    const lerSaida = () => pool.query<{ status: string; provider: string; external_id: string | null; sent_via: string }>(
      `select status, provider, external_id, sent_via from public.messages where conversation_id=$1 and direction='outbound' order by created_at desc limit 1`,
      [s.ident.conversation_id]);
    let entregues = 0;
    for (let ciclo = 0; ciclo < 8 && (await lerSaida()).rows[0]?.status !== "sent"; ciclo += 1) {
      entregues += (await rodarCicloDeSaida({ pool, lote: 50, backoffMs: [0, 0] })).entregues;
    }
    expect(entregues).toBeGreaterThanOrEqual(1);
    const saida = await lerSaida();
    expect(saida.rows[0]).toMatchObject({ status: "sent", provider: "webchat", sent_via: "ai" });
    expect(saida.rows[0]?.external_id).toMatch(/^webchat:[0-9a-f]{32}$/);
    medidas.ai_replies += saida.rows[0]?.status === "sent" ? 1 : 0;
    const visto = await listarMensagensDoVisitante(s.sessao, null, deps);
    expect(visto.map((m) => [m.direction, m.author])).toEqual([["inbound", "visitor"], ["outbound", "ai"]]);
    // Cursor inclusivo (ms × µs): só a última vista pode voltar; nada anterior a ela.
    const depois = await listarMensagensDoVisitante(s.sessao, visto[1]!.created_at, deps);
    expect(depois.every((m) => m.id === visto[1]!.id)).toBe(true);
    expect(visto[1]!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    console.info(`f14-t01-ia: ai_replies=${medidas.ai_replies}/${medidas.ai_replies_total} delivered_by_webchat_adapter=1/1 visible_to_visitor=2/2`);
  });
});

describe("F14-T01 — os três freios do endpoint público (ADR-038 §6, objeção 2)", () => {
  it("30 sessões na hora do mesmo IP: a 31ª é recusada (ip_limited)", async () => {
    const ip = "198.51.100.1";
    let abertas = 0;
    let recusada: string | null = null;
    for (let i = 0; i < LIMITES_DO_WEBCHAT.sessoes_por_ip_hora + 1; i += 1) {
      const r = await criarSessao({ slug: TENANT_A.slug, ip }, deps);
      if (r.ok) abertas += 1;
      else {
        recusada = r.reason;
        break;
      }
    }
    expect(abertas).toBe(LIMITES_DO_WEBCHAT.sessoes_por_ip_hora);
    expect(recusada).toBe("ip_sessions");
    medidas.webchat_sessions += abertas;
    medidas.ip_limited = 1;
    console.info(`f14-t01-freio-ip: opened=${abertas}/${LIMITES_DO_WEBCHAT.sessoes_por_ip_hora} ip_limited=1/1`);
  });

  it("600 mensagens na hora da organização: a próxima é recusada (org_limited) — mesmo vindo de outro IP", async () => {
    // Quem enche a hora é OUTRO visitante, de OUTRO IP: o freio por IP de quem
    // manda a 601ª fica em zero — só o da organização pode barrar.
    const cheio = await abrirIdentificada(TENANT_A.slug, "198.51.100.3", "Gil Enchente", "gil@enchente.test");
    const s = await abrirIdentificada(TENANT_A.slug, "198.51.100.2", "Fábio Visitante", "fabio@ficticio.test");
    for (const v of [cheio, s]) {
      medidas.webchat_sessions += 1;
      medidas.identified_total += 1;
      medidas.identified += 1;
      medidas.contacts_total += 1;
      medidas.contacts_created += v.ident.created_contact ? 1 : 0;
    }
    const canal = await pool.query<{ id: string }>(`select channel_session_id as id from public.conversations where id=$1`, [cheio.ident.conversation_id]);
    try {
      // Enche a hora da organização por SQL (não pelo caminho — o que se mede é o freio, não 600 turnos).
      await pool.query(
        `insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, provider, type, direction, status, body, sent_via, external_id)
         select $1, $2, $3, $4, 'webchat', 'text', 'inbound', 'delivered', 'enchente ' || g, 'external_device', 'f14-enchente-' || g
           from generate_series(1, $5::int) g`,
        [ORG_A, cheio.ident.conversation_id, canal.rows[0]!.id, cheio.ident.contact_id, LIMITES_DO_WEBCHAT.mensagens_por_organizacao_hora]);
      const r = await receberMensagemDoVisitante(s.sessao, { client_message_id: randomUUID(), body: "mais uma" }, deps);
      expect(r).toMatchObject({ ok: false, reason: "org_messages" });
    } finally {
      // Limpa a enchente para não contaminar os casos seguintes.
      await pool.query(`delete from public.messages where organization_id=$1 and external_id like 'f14-enchente-%'`, [ORG_A]);
    }
    medidas.org_limited = 1;
    console.info("f14-t01-freio-org: org_limited=1/1 other_ip=1/1");
  });

  it("enxurrada: 50 sessões de 50 IPs mandam mensagem; a IA responde no máximo o teto diário da F15 (flood_calls_capped)", async () => {
    const TETO = 5;
    await setSetting(ctxAdminA, "ai.limits.daily_turns", TETO, "tenant_admin", { pool });
    const usadosAntes = await conta(`select count(*)::text as n from public.ai_usage_events where organization_id=$1 and operation='chat'`, [ORG_A]);
    const { registry, estado } = registroQueResponde();
    const conversas: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      const s = await abrirIdentificada(TENANT_A.slug, `192.0.2.${i + 1}`, `Robô ${i}`, `robo${i}@enxurrada.test`);
      medidas.webchat_sessions += 1;
      const r = await receberMensagemDoVisitante(s.sessao, { client_message_id: randomUUID(), body: `pergunta ${i}` }, deps);
      if (!r.ok) throw new Error(`mensagem ${i} recusada: ${r.reason}`);
      medidas.messages_in += 1;
      conversas.push(s.ident.conversation_id);
    }
    let respondidos = 0;
    let negados = 0;
    for (const [i, conversa] of conversas.entries()) {
      const t = await responderTurno(ctxJobA, { conversation_id: conversa, mensagem_do_cliente: `pergunta ${i}` }, depsDoTurno(registry));
      if (t.status === "respondido") respondidos += 1;
      else negados += 1;
    }
    const usadosDepois = await conta(`select count(*)::text as n from public.ai_usage_events where organization_id=$1 and operation='chat'`, [ORG_A]);
    expect(estado.chamadas, "o provedor foi chamado além do teto diário").toBeLessThanOrEqual(TETO);
    expect(usadosDepois - usadosAntes).toBeLessThanOrEqual(TETO);
    expect(respondidos + negados).toBe(50);
    expect(negados).toBeGreaterThanOrEqual(50 - TETO);
    medidas.flood_calls_capped = estado.chamadas <= TETO ? 1 : 0;
    await setSetting(ctxAdminA, "ai.limits.daily_turns", 0, "tenant_admin", { pool });
    console.info(`f14-t01-enxurrada: sessions=50/50 provider_calls=${estado.chamadas}/${TETO} flood_calls_capped=${medidas.flood_calls_capped}/1`);
  });
});

describe("F14-T01 — a janela de cortesia não vale para o visitante na página", () => {
  it("às 3h, a sessão webchat responde e a de WhatsApp adia — pela capability lida do provider da sessão", async () => {
    const MADRUGADA = new Date("2026-07-28T06:00:00Z"); // 03h BRT — fora da janela 7h–22h
    const providers = await pool.query<{ provider: string }>(
      `select provider from public.channel_sessions where organization_id=$1 order by provider`, [ORG_A]);
    const lidos = providers.rows.map((r) => r.provider);
    expect(lidos).toContain("webchat");
    const decide = (provider: string) => {
      const { banRisk, liveVisitor } = capabilitiesOf(provider as "waha" | "webchat");
      return decidePacing({ now: MADRUGADA, knobs: PACING_DEFAULTS, state: { lastSentAt: null, sentToday: 0, numberActivatedAt: null }, crmDailyLimit: null, banRisk, liveVisitor, rng: () => 0 });
    };
    expect(decide("webchat").allow).toBe(true);
    const whatsapp = decide("waha");
    expect(whatsapp.allow).toBe(false);
    medidas.ai_outside_window = 1;
    console.info("f14-t01-janela: ai_outside_window=1/1 whatsapp_still_deferred=1/1");
  });
});

describe("F14-T02 — o humano segue a janela; a fila e o aviso ao visitante", () => {
  it("visitante pede uma pessoa: o handoff entra na fila e a página vê waiting_human + a próxima abertura fora da janela", async () => {
    const s = await abrirIdentificada(TENANT_A.slug, "198.51.100.9", "Helena Visitante", "helena@ficticio.test");
    medidas.webchat_sessions += 1;
    medidas.identified_total += 1;
    medidas.identified += 1;
    medidas.contacts_total += 1;
    medidas.contacts_created += s.ident.created_contact ? 1 : 0;
    const r = await receberMensagemDoVisitante(s.sessao, { client_message_id: randomUUID(), body: "quero falar com uma pessoa" }, deps);
    if (!r.ok) throw new Error(`mensagem recusada: ${r.reason}`);
    medidas.messages_in += 1;
    const { registry } = registroQueResponde({ wanted: true, reason: "customer_request" });
    const turno = await responderTurno(ctxJobA, { conversation_id: s.ident.conversation_id, mensagem_do_cliente: "quero falar com uma pessoa" }, depsDoTurno(registry));
    expect(turno.status).toBe("handoff");
    const fila = await conta(`select count(*)::text as n from public.handoffs where organization_id=$1 and conversation_id=$2 and claimed_at is null`, [ORG_A, s.ident.conversation_id]);
    expect(fila).toBe(1);
    const estado = await estadoDaConversaDoVisitante(s.sessao, deps);
    expect(estado.waiting_human).toBe(true);
    // A janela do humano: às 3h no fuso da organização o aviso traz a próxima abertura; às 10h não há aviso.
    const madrugada = janelaDoHumano(new Date("2026-07-28T06:00:00Z"), estado.timezone);
    const comercial = janelaDoHumano(new Date("2026-07-28T13:00:00Z"), estado.timezone);
    expect(madrugada.human_available).toBe(false);
    expect(madrugada.next_human_at).toMatch(/^2026-07-28T10:00:00/);
    expect(comercial).toMatchObject({ human_available: true, next_human_at: null });
    medidas.handoff_queued = 1;
    console.info("f14-t02-handoff: handoff_queued=1/1 waiting_human_visible=1/1 next_human_at_outside_window=1/1");
  });

  it("configurar o chat do site é settings.manage (rota PATCH /settings/webchat): attendant e platform_admin negados; o rank mínimo é manager", () => {
    // O que a rota nova da T02 exige: `settings.manage` + rank `manager` (viewer < agent < manager).
    const negados: PapelD15[] = ["attendant", "platform_admin"];
    for (const papel of negados) {
      medidas.roles_denied_total += 1;
      if (!can(papel, "settings.manage")) medidas.roles_denied += 1;
    }
    const rankNega = ROLE_RANK.viewer < ROLE_RANK.manager && ROLE_RANK.agent < ROLE_RANK.manager;
    expect(medidas.roles_denied).toBe(negados.length);
    expect(rankNega).toBe(true);
    expect(can("tenant_admin", "settings.manage") && can("manager", "settings.manage")).toBe(true);
    console.info(`f14-t02-papeis: roles_denied=${medidas.roles_denied}/${medidas.roles_denied_total} rank_min_manager=1/1`);
  });
});

describe("F14-T03 — a agenda herdada pela fachada SaaS (D41: adotada, por membro)", () => {
  beforeAll(async () => {
    await pool.query(`insert into auth.users (id, email) values ($1, 'f14-atendente-a@integration.test') on conflict do nothing`, [ATENDENTE_A]);
    await pool.query(`insert into public.user_organizations (organization_id, user_id, role, accepted_at) values ($1,$2,'agent',now()) on conflict do nothing`, [ORG_A, ATENDENTE_A]);
    await pool.query(
      `insert into public.attendant_availability (organization_id, user_id, is_available, schedule)
       values ($1,$2,true,$3::jsonb) on conflict (organization_id, user_id) do update set schedule = excluded.schedule, is_available = true`,
      [ORG_A, ATENDENTE_A, JSON.stringify({ timezone: "America/Sao_Paulo", windows: [1, 2, 3, 4, 5].map((dow) => ({ dow, start: "09:00", end: "18:00" })) })],
    );
    await pool.query(
      `insert into public.calendar_event_types (id, organization_id, name, slug, duration_minutes, minimum_notice_minutes, booking_window_days, default_owner_user_id, is_active)
       values ($1,$2,'Consulta','consulta-f14',60,120,60,$3,true)`,
      [TIPO_A, ORG_A, ATENDENTE_A],
    );
  });

  it("horários livres vêm do motor herdado; marcar cria; o mesmo horário para o mesmo responsável é CONFLITO com nome; remarcar e cancelar passam pela RPC herdada", async () => {
    const ctx: TenantCtx = { organization_id: ORG_A, source: "session", user_id: ADMIN_A };
    const livres = await horariosLivresDaOrganizacao(ctx, { event_type_id: TIPO_A, de: new Date("2026-10-06T00:00:00Z"), ate: new Date("2026-10-07T00:00:00Z") }, { pool, agora: AGORA_FIXO });
    expect(livres.ok).toBe(true);
    if (!livres.ok) throw new Error("inalcançável");
    expect(livres.slots.some((sl) => sl.inicio.getTime() === TERCA_14H_SP.getTime())).toBe(true);
    expect(livres.fuso).toBe("America/Sao_Paulo");

    const visitante = await abrirIdentificada(TENANT_A.slug, "198.51.100.30", "Iris Visitante", "iris@ficticio.test");
    medidas.webchat_sessions += 1;
    medidas.identified_total += 1;
    medidas.identified += 1;
    medidas.contacts_total += 1;
    medidas.contacts_created += visitante.ident.created_contact ? 1 : 0;
    const m1 = await marcar(ctx, { kind: "human", user_id: ADMIN_A }, { event_type_id: TIPO_A, starts_at: TERCA_14H_SP.toISOString(), contact_id: visitante.ident.contact_id, conversation_id: visitante.ident.conversation_id }, { pool, agora: AGORA_FIXO });
    expect(m1.ok, m1.ok ? "" : `${m1.reason}: ${m1.detalhe}`).toBe(true);
    if (!m1.ok) throw new Error("inalcançável");
    medidas.appointments += 1;
    expect(m1.compromisso).toMatchObject({ status: "confirmed", time_zone: "America/Sao_Paulo", owner_user_id: ATENDENTE_A });
    const ligado = await pool.query<{ contact_id: string; conversation_id: string; created_by_kind: string }>(`select contact_id, conversation_id, created_by_kind from public.calendar_appointments where id=$1`, [m1.compromisso.id]);
    expect(ligado.rows[0]).toEqual({ contact_id: visitante.ident.contact_id, conversation_id: visitante.ident.conversation_id, created_by_kind: "user" });

    // O mesmo horário, o mesmo responsável: conflito COM NOME (conflicts_blocked).
    const m2 = await marcar(ctx, { kind: "human", user_id: ADMIN_A }, { event_type_id: TIPO_A, starts_at: TERCA_14H_SP.toISOString() }, { pool, agora: AGORA_FIXO });
    expect(m2.ok).toBe(false);
    if (m2.ok) throw new Error("inalcançável");
    expect(m2.reason).toBe("conflict");
    expect(m2.conflicting_id).toBe(m1.compromisso.id);
    // Meia hora depois também colide (sobreposição), e às 16h não.
    const m3 = await marcar(ctx, { kind: "human", user_id: ADMIN_A }, { event_type_id: TIPO_A, starts_at: new Date(TERCA_14H_SP.getTime() + 30 * 60_000).toISOString() }, { pool, agora: AGORA_FIXO });
    expect(m3.ok === false && m3.reason).toBe("conflict");
    const m4 = await marcar(ctx, { kind: "human", user_id: ADMIN_A }, { event_type_id: TIPO_A, starts_at: new Date(TERCA_14H_SP.getTime() + 2 * 3_600_000).toISOString() }, { pool, agora: AGORA_FIXO });
    expect(m4.ok, m4.ok ? "" : `${m4.reason}: ${m4.detalhe}`).toBe(true);
    if (!m4.ok) throw new Error("inalcançável");
    medidas.appointments += 1;
    medidas.conflicts_blocked = 1;
    // Fora da jornada (22h SP = 01:00Z do dia seguinte) não é conflito: é indisponível.
    const m5 = await marcar(ctx, { kind: "human", user_id: ADMIN_A }, { event_type_id: TIPO_A, starts_at: "2026-10-07T01:00:00.000Z" }, { pool, agora: AGORA_FIXO });
    expect(m5.ok === false && m5.reason).toBe("slot_unavailable");

    // Remarcar a das 16h para as 11h (mesma linha; revisão sobe); remarcar para as 14h é conflito; cancelar exige motivo.
    const r1 = await remarcar(ctx, { kind: "human", user_id: ADMIN_A }, { id: m4.compromisso.id, revision: m4.compromisso.revision, starts_at: new Date(TERCA_14H_SP.getTime() - 3 * 3_600_000).toISOString() }, { pool, agora: AGORA_FIXO });
    expect(r1.ok, r1.ok ? "" : `${r1.reason}: ${r1.detalhe}`).toBe(true);
    if (!r1.ok) throw new Error("inalcançável");
    expect(r1.compromisso.id).toBe(m4.compromisso.id);
    expect(r1.compromisso.revision).toBeGreaterThan(m4.compromisso.revision);
    const r2 = await remarcar(ctx, { kind: "human", user_id: ADMIN_A }, { id: m4.compromisso.id, revision: r1.compromisso.revision, starts_at: TERCA_14H_SP.toISOString() }, { pool, agora: AGORA_FIXO });
    expect(r2.ok === false && r2.reason).toBe("conflict");
    const velha = await remarcar(ctx, { kind: "human", user_id: ADMIN_A }, { id: m4.compromisso.id, revision: m4.compromisso.revision, starts_at: new Date(TERCA_14H_SP.getTime() - 2 * 3_600_000).toISOString() }, { pool, agora: AGORA_FIXO });
    expect(velha.ok === false && velha.reason).toBe("stale");
    const c0 = await cancelar(ctx, { kind: "human", user_id: ADMIN_A }, { id: m4.compromisso.id, revision: r1.compromisso.revision, reason: "  " }, { pool });
    expect(c0.ok === false && c0.reason).toBe("invalid");
    const c1 = await cancelar(ctx, { kind: "human", user_id: ADMIN_A }, { id: m4.compromisso.id, revision: r1.compromisso.revision, reason: "cliente desistiu" }, { pool });
    expect(c1.ok && c1.compromisso.status).toBe("cancelled");
    // Cancelado libera: marcar às 11h volta a funcionar.
    const m6 = await marcar(ctx, { kind: "human", user_id: ADMIN_A }, { event_type_id: TIPO_A, starts_at: new Date(TERCA_14H_SP.getTime() - 3 * 3_600_000).toISOString() }, { pool, agora: AGORA_FIXO });
    expect(m6.ok).toBe(true);
    medidas.appointments += 1;
    const auditadas = await conta(`select count(*)::text as n from public.audit_events where organization_id=$1 and action_name like 'agenda.appointment_%'`, [ORG_A]);
    expect(auditadas).toBeGreaterThanOrEqual(5);
    console.info(`f14-t03-agenda: slots_from_engine=1/1 appointments=${medidas.appointments} conflicts_blocked=2/2 slot_unavailable=1/1 rescheduled=1/1 stale=1/1 cancelled=1/1 freed=1/1 audited=${auditadas}`);
  });

  it("fuso: o mesmo instante combinado em Manaus grava o mesmo starts_at e outro time_zone (tz_ok)", async () => {
    const ctx: TenantCtx = { organization_id: ORG_A, source: "session", user_id: ADMIN_A };
    // 13:00 em Manaus (UTC-4) = 17:00Z = 14:00 em São Paulo — o mesmo instante da m1, em OUTRO dia (quarta) para não colidir.
    const quarta = new Date(TERCA_14H_SP.getTime() + 24 * 3_600_000);
    const m = await marcar(ctx, { kind: "human", user_id: ADMIN_A }, { event_type_id: TIPO_A, starts_at: quarta.toISOString(), timezone: "America/Manaus" }, { pool, agora: AGORA_FIXO });
    expect(m.ok, m.ok ? "" : `${m.reason}: ${m.detalhe}`).toBe(true);
    if (!m.ok) throw new Error("inalcançável");
    medidas.appointments += 1;
    const gravado = await pool.query<{ starts_at: string; time_zone: string; hora_manaus: string; hora_sp: string }>(
      `select starts_at::text, time_zone,
              to_char(starts_at at time zone 'America/Manaus', 'HH24:MI') as hora_manaus,
              to_char(starts_at at time zone 'America/Sao_Paulo', 'HH24:MI') as hora_sp
         from public.calendar_appointments where id=$1`, [m.compromisso.id]);
    expect(gravado.rows[0]?.time_zone).toBe("America/Manaus");
    expect(new Date(gravado.rows[0]!.starts_at).toISOString()).toBe(quarta.toISOString());
    expect(gravado.rows[0]?.hora_manaus).toBe("13:00");
    expect(gravado.rows[0]?.hora_sp).toBe("14:00");
    const invalido = await marcar(ctx, { kind: "human", user_id: ADMIN_A }, { event_type_id: TIPO_A, starts_at: quarta.toISOString(), timezone: "Marte/Olympus" }, { pool, agora: AGORA_FIXO });
    expect(invalido.ok === false && invalido.reason).toBe("invalid_timezone");
    medidas.tz_ok = 1;
    console.info("f14-t03-fuso: same_instant=1/1 tz_stored=1/1 display_differs=1/1 invalid_tz_denied=1/1 tz_ok=1/1");
  });

  it("conexão Google desconectada/membro revogado: a publicação é recusada pelo banco (revoked_blocked) — pelo executor herdado", async () => {
    await pool.query(
      `insert into public.calendar_connections (id, organization_id, user_id, provider, account_email, status) values ($1,$2,$3,'google_calendar','atendente-a@ficticio.test','healthy')`,
      [CONEXAO_A, ORG_A, ATENDENTE_A],
    );
    await pool.query(
      `insert into public.calendar_connection_calendars (id, organization_id, connection_id, external_calendar_id, name, is_destination, access_role) values ($1,$2,$3,'destino','Agenda',true,'owner')`,
      [CAL_A, ORG_A, CONEXAO_A],
    );
    const ctx: TenantCtx = { organization_id: ORG_A, source: "session", user_id: ADMIN_A };
    const quinta = new Date(TERCA_14H_SP.getTime() + 2 * 24 * 3_600_000);
    const m = await marcar(ctx, { kind: "human", user_id: ADMIN_A }, { event_type_id: TIPO_A, starts_at: quinta.toISOString() }, { pool, agora: AGORA_FIXO });
    if (!m.ok) throw new Error(`${m.reason}: ${m.detalhe}`);
    medidas.appointments += 1;
    // Com a conexão saudável o executor herdado reserva (claim) a publicação…
    const claim = await pool.query<{ result: { claim?: unknown } }>(`select public.fn_google_appointment($1,$2,'claim','{}'::jsonb) as result`, [ORG_A, m.compromisso.id]);
    expect(claim.rows[0]?.result).toBeTruthy();
    // …e com o membro REVOGADO (o dono saiu da organização) a renovação e o commit são recusados pelo banco.
    await pool.query(`update public.user_organizations set revoked_at = now() where organization_id=$1 and user_id=$2`, [ORG_A, ATENDENTE_A]);
    let recusas = 0;
    try {
      for (const acao of ["renew", "commit"] as const) {
        try {
          await pool.query(`select public.fn_google_appointment($1,$2,$3,$4::jsonb)`, [ORG_A, m.compromisso.id, acao, JSON.stringify({ ...(claim.rows[0]?.result as object), result: { ack: true } })]);
        } catch (erro) {
          if (/google_owner_unavailable|google_connection_unavailable/.test(erro instanceof Error ? erro.message : String(erro))) recusas += 1;
          else throw erro;
        }
      }
    } finally {
      await pool.query(`update public.user_organizations set revoked_at = null where organization_id=$1 and user_id=$2`, [ORG_A, ATENDENTE_A]);
    }
    expect(recusas).toBe(2);
    medidas.revoked_blocked = 1;
    console.info("f14-t03-revogacao: claim_with_healthy=1/1 denied_after_revoke=2/2 revoked_blocked=1/1");
  });
});

describe("F14-T04 — a IA marca horário pela ação do catálogo, sob a política da F15", () => {
  const IA = { kind: "ai" } as const;
  const ctxIa: TenantCtx = { organization_id: ORG_A, source: "job" };
  const ctxAdmin: TenantCtx = { organization_id: ORG_A, source: "session", user_id: ADMIN_A };
  const sexta = new Date(TERCA_14H_SP.getTime() + 3 * 24 * 3_600_000);

  it("schedule_appointment está no catálogo para a IA (14 ações, 10 para o modelo) e, sem entrada na política, PENDURA (proposed)", async () => {
    expect(toolsFor(ctxIa, "ai").map((t) => t.name)).toContain("schedule_appointment");
    expect(toolsFor(ctxIa, "automation").map((t) => t.name)).not.toContain("schedule_appointment");
    const visitante = await visitanteQueFalou("198.51.100.40", "João Visitante", "joao@ficticio.test", "quero marcar uma consulta na sexta às 14h");
    const antes = await conta(`select count(*)::text as n from public.calendar_appointments where organization_id=$1`, [ORG_A]);
    const proposta = await execute(ctxIa, IA, "schedule_appointment", { conversation_id: visitante.ident.conversation_id, event_type_id: TIPO_A, starts_at: sexta.toISOString(), timezone: "America/Sao_Paulo" }, { pool });
    medidas.proposed_total += 1;
    expect(proposta.status, `${proposta.reason ?? ""} ${proposta.detalhe ?? ""}`).toBe("pending");
    expect(proposta.pending_action_id).toBeTruthy();
    medidas.proposed += 1;
    expect(await conta(`select count(*)::text as n from public.calendar_appointments where organization_id=$1`, [ORG_A])).toBe(antes);

    // Aprovada pela pessoa: a tool roda e o compromisso nasce ligado ao contato e à conversa (approved).
    const aprovada = await confirm(ctxAdmin, proposta.pending_action_id!, "approved", { kind: "human", user_id: ADMIN_A }, { pool });
    expect(aprovada.status, `${aprovada.reason ?? ""} ${aprovada.detalhe ?? ""}`).toBe("executed");
    const criado = await pool.query<{ contact_id: string; conversation_id: string; created_by_kind: string; status: string }>(
      `select contact_id, conversation_id, created_by_kind, status from public.calendar_appointments where organization_id=$1 and conversation_id=$2`,
      [ORG_A, visitante.ident.conversation_id]);
    expect(criado.rows).toHaveLength(1);
    expect(criado.rows[0]).toMatchObject({ contact_id: visitante.ident.contact_id, created_by_kind: "user", status: "confirmed" });
    medidas.appointments += 1;
    medidas.approved = 1;

    // Segunda proposta, no MESMO horário: a política pendura antes de a agenda ver o conflito — a pessoa é quem decide.
    const outro = await visitanteQueFalou("198.51.100.41", "Karen Visitante", "karen@ficticio.test", "tem horário sexta às 14h?");
    const proposta2 = await execute(ctxIa, IA, "schedule_appointment", { conversation_id: outro.ident.conversation_id, event_type_id: TIPO_A, starts_at: sexta.toISOString() }, { pool });
    medidas.proposed_total += 1;
    expect(proposta2.status).toBe("pending");
    medidas.proposed += 1;
    // …e ao aprovar, o conflito NOMEADO recusa: a aprovação humana não passa por cima da agenda.
    const aprovada2 = await confirm(ctxAdmin, proposta2.pending_action_id!, "approved", { kind: "human", user_id: ADMIN_A }, { pool });
    expect(aprovada2.status).toBe("denied");
    expect(aprovada2.reason).toBe("domain_rejected");
    expect(aprovada2.detalhe).toMatch(/^conflict:/);
    console.info(`f14-t04-proposta: catalog=14 ai_tools=10 proposed=${medidas.proposed}/${medidas.proposed_total} approved=1/1 conflict_on_approval=1/1`);
  });

  it("política `block` nega a proposta e audita; `allow` marca direto; `transfer` entrega a conversa a uma pessoa", async () => {
    const visitante = await visitanteQueFalou("198.51.100.42", "Lia Visitante", "lia@ficticio.test", "quero marcar para segunda às 14h");
    const sabado = new Date(TERCA_14H_SP.getTime() + 6 * 24 * 3_600_000); // segunda seguinte (13/10), 14h SP
    const entrada = { conversation_id: visitante.ident.conversation_id, event_type_id: TIPO_A, starts_at: sabado.toISOString() };

    await setSetting(ctxAdminA, "actions.policy", { schedule_appointment: "block" }, "tenant_admin", { pool });
    const bloqueada = await execute(ctxIa, IA, "schedule_appointment", entrada, { pool });
    expect(bloqueada.status).toBe("denied");
    expect(bloqueada.reason).toBe("policy_blocked");
    expect(bloqueada.audit_id).toBeTruthy();
    medidas.denied_by_policy = 1;

    await setSetting(ctxAdminA, "actions.policy", { schedule_appointment: "allow" }, "tenant_admin", { pool });
    const direta = await execute(ctxIa, IA, "schedule_appointment", entrada, { pool });
    expect(direta.status, `${direta.reason ?? ""} ${direta.detalhe ?? ""}`).toBe("executed");
    const criado = await pool.query<{ created_by_kind: string; source: string }>(`select created_by_kind, source from public.calendar_appointments where organization_id=$1 and conversation_id=$2`, [ORG_A, visitante.ident.conversation_id]);
    expect(criado.rows[0]).toEqual({ created_by_kind: "ai", source: "mcp" });
    medidas.appointments += 1;

    await setSetting(ctxAdminA, "actions.policy", {}, "tenant_admin", { pool });
    console.info("f14-t04-politica: denied_by_policy=1/1 allow_executed=1/1 audited=1/1");
  });
});

describe("F14 — a linha `channels:` do VERIFY SUMMARY (ADR-039 §2)", () => {
  it("grava a linha com todos os campos medidos e denominadores", () => {
    // Tudo medido pelos casos acima (a ordem do arquivo é a ordem de execução).
    expect(medidas.webchat_sessions).toBeGreaterThanOrEqual(3);
    expect(medidas.identified).toBe(medidas.identified_total);
    expect(medidas.contacts_created).toBe(medidas.contacts_total);
    expect(medidas.messages_in).toBeGreaterThanOrEqual(3);
    expect(medidas.ai_replies).toBe(medidas.ai_replies_total);
    expect(medidas.roles_denied).toBe(medidas.roles_denied_total);
    expect(medidas.proposed).toBe(medidas.proposed_total);
    expect(medidas.appointments).toBeGreaterThanOrEqual(2);
    expect([medidas.ai_outside_window, medidas.handoff_queued, medidas.ip_limited, medidas.org_limited, medidas.flood_calls_capped, medidas.cross_org_denied, medidas.conflicts_blocked, medidas.revoked_blocked, medidas.tz_ok, medidas.approved, medidas.denied_by_policy]).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const linha =
      `channels: webchat_sessions=${medidas.webchat_sessions} identified=${medidas.identified}/${medidas.identified_total} ` +
      `contacts_created=${medidas.contacts_created}/${medidas.contacts_total} messages_in=${medidas.messages_in} ` +
      `ai_replies=${medidas.ai_replies}/${medidas.ai_replies_total} ai_outside_window=${medidas.ai_outside_window}/1 ` +
      `handoff_queued=${medidas.handoff_queued}/1 ip_limited=${medidas.ip_limited}/1 org_limited=${medidas.org_limited}/1 ` +
      `flood_calls_capped=${medidas.flood_calls_capped}/1 cross_org_denied=${medidas.cross_org_denied}/1 ` +
      `appointments=${medidas.appointments} conflicts_blocked=${medidas.conflicts_blocked}/1 revoked_blocked=${medidas.revoked_blocked}/1 ` +
      `tz_ok=${medidas.tz_ok}/1 proposed=${medidas.proposed}/${medidas.proposed_total} approved=${medidas.approved}/1 ` +
      `denied_by_policy=${medidas.denied_by_policy}/1 roles_denied=${medidas.roles_denied}/${medidas.roles_denied_total}`;
    console.info(linha);
    gravarLinhaDoVerify("channels", linha);
  });
});
