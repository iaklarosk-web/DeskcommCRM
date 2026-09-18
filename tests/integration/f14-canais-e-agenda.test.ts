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
import {
  criarSessao,
  hashDoIp,
  identificar,
  listarMensagensDoVisitante,
  receberMensagemDoVisitante,
  sessaoPorToken,
  LIMITES_DO_WEBCHAT,
} from "@/src/webchat";

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
};

function registroQueResponde() {
  const estado = { chamadas: 0 };
  const registry = createFakeRegistry(async () => {
    estado.chamadas += 1;
    return {
      content: [{ type: "text" as const, text: comoTextoDoProvedor({ reply: "Olá! Posso ajudar com o seu pedido.", intent: "saudacao", confidence: 0.95, tool_calls: [], handoff: { wanted: false, reason: null } }) }],
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
    const ciclo = await rodarCicloDeSaida({ pool, backoffMs: [0, 0] });
    expect(ciclo.entregues).toBeGreaterThanOrEqual(1);
    const saida = await pool.query<{ status: string; provider: string; external_id: string | null; sent_via: string }>(
      `select status, provider, external_id, sent_via from public.messages where conversation_id=$1 and direction='outbound' order by created_at desc limit 1`,
      [s.ident.conversation_id]);
    expect(saida.rows[0]).toMatchObject({ status: "sent", provider: "webchat", sent_via: "ai" });
    expect(saida.rows[0]?.external_id).toMatch(/^webchat:[0-9a-f]{32}$/);
    medidas.ai_replies += saida.rows[0]?.status === "sent" ? 1 : 0;
    const visto = await listarMensagensDoVisitante(s.sessao, null, deps);
    expect(visto.map((m) => [m.direction, m.author])).toEqual([["inbound", "visitor"], ["outbound", "ai"]]);
    const depois = await listarMensagensDoVisitante(s.sessao, visto[1]!.created_at, deps);
    expect(depois).toHaveLength(0);
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

describe("F14 — o que a T01 mediu (a linha `channels:` é gravada na T05, com todos os campos)", () => {
  it("todos os campos da T01 têm numerador = denominador", () => {
    expect(medidas.webchat_sessions).toBeGreaterThanOrEqual(3);
    expect(medidas.identified).toBe(medidas.identified_total);
    expect(medidas.contacts_created).toBe(medidas.contacts_total);
    expect(medidas.messages_in).toBeGreaterThanOrEqual(3);
    expect(medidas.ai_replies).toBe(medidas.ai_replies_total);
    expect([medidas.ai_outside_window, medidas.ip_limited, medidas.org_limited, medidas.flood_calls_capped, medidas.cross_org_denied]).toEqual([1, 1, 1, 1, 1]);
    console.info(
      `f14-t01-parcial: webchat_sessions=${medidas.webchat_sessions} identified=${medidas.identified}/${medidas.identified_total} contacts_created=${medidas.contacts_created}/${medidas.contacts_total} messages_in=${medidas.messages_in} ai_replies=${medidas.ai_replies}/${medidas.ai_replies_total} ai_outside_window=1/1 ip_limited=1/1 org_limited=1/1 flood_calls_capped=1/1 cross_org_denied=1/1`,
    );
  });
});
