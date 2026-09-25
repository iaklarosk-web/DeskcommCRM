/**
 * F24-T06 (Suporte KN, 25/09/2026) — o chat público e a ASSINATURA da
 * organização, medidos no Postgres descartável:
 *
 *  - `/chat/<slug>` e as rotas públicas só olham `organizations.status` e
 *    `webchat.enabled`. Assinatura `past_due` e `blocked` NÃO fecham o chat:
 *    o visitante abre sessão, se identifica e escreve.
 *  - O que a assinatura muda é quem RESPONDE: `past_due` continua `full` (D44
 *    avisa antes de bloquear) e a IA atende; `blocked` é `read_only`, o
 *    entitlement `ai.reply` nega, a conversa cai em `waiting_human` — e a
 *    escrita humana é negada pelo guarda de rota. Ou seja: a janela aceita a
 *    pergunta e ninguém responde. É isso que o item 6 do pedido queria saber.
 *  - A isenção para organização INTERNA da KN já existe e não expira:
 *    `subscriptions.origin = 'operator'` (o "provisionar na mão" do /admin),
 *    sem gateway, sem evento de cobrança, sem `trial_ends_at`. Uma marcação
 *    "interna" separada seria um segundo estado para a mesma coisa (ADR-050).
 *  - Só `organizations.status <> 'active'` (suspender pelo /admin de tenants)
 *    fecha o chat de verdade.
 */
import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolverPorPlano } from "@/src/entitlement/plano";
import type { TenantCtx } from "@/src/tenant-context";
import { criarSessao, identificar, receberMensagemDoVisitante, sessaoPorToken } from "@/src/webchat";

import { semearTenant, type ConfigDeTenant } from "./f04-turno-fixtures";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(rawPort)}/postgres`, max: 4 });

const ORG = "f2400001-0000-4000-8000-000000000001";
const SLUG = "f24-suporte-crm-os";
const TENANT: ConfigDeTenant = {
  org: ORG,
  slug: SLUG,
  usuario: "f2400001-1000-4000-8000-000000000001",
  sessao: "f2400001-3000-4000-8000-000000000001",
  conta: `${SLUG}-conta`,
  contatos: [],
  conversas: [],
  produtos: [],
  materiais: [],
  settings: { "ai.enabled": true, "webchat.enabled": true, "ai.unknown_answer": "Ainda não sei.", "ai.confidence_threshold": 0.6 },
};
const ctxJob: TenantCtx = { organization_id: ORG, source: "job" };
const deps = { pool, salDoIp: "sal-ficticio-da-f24" };

let visitantes = 0;

/** Abre sessão, identifica e manda UMA mensagem como o visitante faria. */
async function visitanteEscreve(): Promise<{ conversation_id: string }> {
  visitantes += 1;
  const sessao = await criarSessao({ slug: SLUG, ip: `203.0.113.${visitantes}` }, deps);
  if (!sessao.ok) throw new Error(`sessão recusada: ${sessao.reason}`);
  const ident = await identificar(sessao.sessao, { name: `Visitante ${visitantes}`, contact: `v${visitantes}@f24.test` }, deps);
  if (!ident.ok) throw new Error(`identificação recusada: ${ident.reason}`);
  const viva = await sessaoPorToken(SLUG, sessao.token, deps);
  if (viva === null) throw new Error("sessão sumiu depois de identificar");
  const r = await receberMensagemDoVisitante(viva, { client_message_id: randomUUID(), body: "Qual o preço do plano?" }, deps);
  if (!r.ok) throw new Error(`mensagem recusada: ${r.reason}`);
  expect(["ingerido", "fora_da_fronteira"]).toContain(r.entrada.status);
  return { conversation_id: ident.conversation_id };
}

async function estadoDaConversa(id: string): Promise<string | null> {
  const { rows } = await pool.query<{ saas_state: string | null }>(`select saas_state from public.conversations where id = $1 and organization_id = $2`, [id, ORG]);
  return rows[0]?.saas_state ?? null;
}

async function semAssinatura(): Promise<void> {
  await pool.query(`delete from public.subscriptions where organization_id = $1`, [ORG]);
}

beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await semearTenant(client, TENANT);
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

describe("F24-T06 — assinatura em carência (past_due): o chat segue e a IA atende", () => {
  it("sessão, identificação e mensagem passam; ai.reply permitido; conversa em ai_handling", async () => {
    await semAssinatura();
    await pool.query(
      `insert into public.subscriptions (organization_id, plan_code, status, origin, gateway, failed_at, grace_until)
       values ($1, 'PLAN_A', 'past_due', 'self_service', 'mock', now(), now() + interval '7 days')`,
      [ORG],
    );
    const { conversation_id } = await visitanteEscreve();
    const resposta = await resolverPorPlano(ctxJob, "ai.reply", { pool });
    expect(resposta.allowed).toBe(true);
    expect(resposta.reason).toBe("ok");
    expect(await estadoDaConversa(conversation_id)).toBe("ai_handling");
    console.info("f24-t06-past-due: session=1/1 identified=1/1 message_in=1/1 ai_reply_allowed=1/1 state=ai_handling");
  });
});

describe("F24-T06 — assinatura bloqueada (blocked): o chat aceita a pergunta e NINGUÉM responde", () => {
  it("sessão, identificação e mensagem passam; ai.reply negado; conversa cai em waiting_human", async () => {
    await pool.query(`update public.subscriptions set status = 'blocked', blocked_at = now() where organization_id = $1`, [ORG]);
    const { conversation_id } = await visitanteEscreve();
    const resposta = await resolverPorPlano(ctxJob, "ai.reply", { pool });
    expect(resposta.allowed).toBe(false);
    expect(resposta.reason).toBe("subscription_blocked");
    expect(await estadoDaConversa(conversation_id)).toBe("waiting_human");
    console.info("f24-t06-blocked: session=1/1 identified=1/1 message_in=1/1 ai_reply_denied=1/1 state=waiting_human");
  });
});

describe("F24-T06 — organização interna da KN: origin=operator (provisionar na mão) é a isenção, e não expira", () => {
  it("assinatura operator ativa sem gateway: ai.reply permitido; sem trial, sem carência, sem evento que a derrube", async () => {
    await semAssinatura();
    await pool.query(
      `insert into public.subscriptions (organization_id, plan_code, status, origin, gateway, current_period_start, current_period_end)
       values ($1, 'PLAN_C', 'active', 'operator', null, now(), now() + interval '30 days')`,
      [ORG],
    );
    const { conversation_id } = await visitanteEscreve();
    const resposta = await resolverPorPlano(ctxJob, "ai.reply", { pool });
    expect(resposta.allowed).toBe(true);
    expect(await estadoDaConversa(conversation_id)).toBe("ai_handling");
    const { rows } = await pool.query<{ gateway: string | null; grace_until: Date | null; failed_at: Date | null }>(
      `select gateway, grace_until, failed_at from public.subscriptions where organization_id = $1`,
      [ORG],
    );
    expect(rows[0]).toEqual({ gateway: null, grace_until: null, failed_at: null });
    console.info("f24-t06-operator: ai_reply_allowed=1/1 gateway=none");
  });
});

describe("F24-T06 — o que FECHA o chat é o status da organização, não a assinatura", () => {
  it("organização suspensa pelo /admin: a sessão é recusada como organização desconhecida", async () => {
    await pool.query(`update public.organizations set status = 'suspended' where id = $1`, [ORG]);
    const recusada = await criarSessao({ slug: SLUG, ip: "203.0.113.200" }, deps);
    expect(recusada.ok).toBe(false);
    if (recusada.ok) throw new Error("inalcançável");
    expect(recusada.reason).toBe("unknown_organization");
    await pool.query(`update public.organizations set status = 'active' where id = $1`, [ORG]);
    console.info("f24-t06-suspensa: session_denied=1/1");
  });
});
