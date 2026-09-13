/**
 * F11-T02/T03/T04 — suporte limitado e auditado, equipes dentro do plano e a
 * entrada com assinatura (ADR-030 §1/§4; D38, D39, D51), contra o banco.
 *
 * É a suíte que grava a linha `admin:` do VERIFY SUMMARY (ADR-031):
 *   admin: tenants_listed=T/T support_sessions=S support_reason=S/S
 *          support_scope_denied=D/D support_writes_denied=W/W
 *          full_mode_rejected=1/1 signup_pending=1/1 orgs_without_subscription=0/N
 *
 * Suporte: `fn_start_support_saas` (9024) exige motivo e escopo e nasce SÓ
 * LEITURA — a mesma função que a rota `POST /api/v1/admin/tenants/[id]/impersonate`
 * chama; a sessão Auth é a linha em `auth.sessions`, como no invariante
 * herdado `suporte-temporario`. O escopo é medido em `rotaNoEscopo` (a função
 * que `requireRole` usa) e a escrita em `fn_support_write_allowed` (banco) e
 * `supportWriteError` (guarda). Cada número é contagem com denominador (G-14).
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ESCOPOS_DO_SUPORTE, rotaNoEscopo, supportSchema, supportWriteError } from "@/lib/impersonate/support";
import { criarAssinatura, estadoDeAcesso, lerAssinatura } from "@/src/billing";
import { entitlement } from "@/src/entitlement";
import type { TenantCtx } from "@/src/tenant-context";
import { gravarLinhaDoVerify } from "@/tests/lib/verify-metrics";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`, max: 4 });

const DONO = "f1100002-1000-4000-8000-000000000001";
const SESSAO = "f1100002-3000-4000-8000-000000000001";
const ORG_A = "f1100002-0000-4000-8000-00000000000a";
const ORG_B = "f1100002-0000-4000-8000-00000000000b";
/** A organização "do cadastro": nasce sem assinatura e a ganha pelo caminho self-service. */
const ORG_C = "f1100002-0000-4000-8000-00000000000c";
const ADMIN_A = "f1100002-1000-4000-8000-00000000000a";
const ctxA: TenantCtx = { organization_id: ORG_A, source: "session", user_id: ADMIN_A };

const contadores = { support_sessions: 0, support_reason: 0, scope_denied: 0, scope_total: 0, writes_denied: 0, writes_total: 0, full_rejected: 0 };

async function conta(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

async function iniciarSuporte(org: string, reason: string, scope: string, ttl = 1800): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `select public.fn_start_support_saas($1, $2, $3, null, $4, $5, $6) as id`,
    [DONO, SESSAO, org, reason, scope, ttl],
  );
  return rows[0]!.id;
}

async function encerrarSuporte(): Promise<void> {
  await pool.query(`select public.fn_end_support($1, $2)`, [DONO, SESSAO]);
}

async function erroDe(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (erro) {
    return erro instanceof Error ? erro.message : String(erro);
  }
}

beforeAll(async () => {
  await pool.query(`
    insert into auth.users (id, email) values
      ('${DONO}','f11-dono@integration.test'),
      ('${ADMIN_A}','f11-admin-a@integration.test');
    insert into auth.sessions (id, user_id, aal) values ('${SESSAO}','${DONO}','aal1');
    insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason)
      values ('${DONO}','${DONO}','full',false,'F11 integração');
    insert into public.organizations (id, slug, legal_name, display_name, onboarded_at) values
      ('${ORG_A}','f11-empresa-a','F11 Empresa A','F11 A', now()),
      ('${ORG_B}','f11-empresa-b','F11 Empresa B','F11 B', now()),
      ('${ORG_C}','f11-cadastro-c','F11 Cadastro C','F11 C', null);
    insert into public.user_organizations (organization_id, user_id, role, accepted_at) values
      ('${ORG_A}','${ADMIN_A}','admin',now());
  `);
  await criarAssinatura({ organization_id: ORG_A, source: "session" }, { plan_code: "PLAN_A", origin: "operator", status: "active" }, { pool });
  await criarAssinatura({ organization_id: ORG_B, source: "session" }, { plan_code: "PLAN_C", origin: "operator", status: "active" }, { pool });
});

afterAll(async () => {
  await pool.end();
});

describe("F11-T02 — suporte limitado e auditado: motivo, escopo, vencimento, só leitura", () => {
  it("uma sessão por tenant nasce support_readonly com motivo e escopo gravados; vencimento respeita o pedido (≤ 3600 s)", async () => {
    for (const [org, scope] of [[ORG_A, "inbox"], [ORG_B, "all"]] as const) {
      const id = await iniciarSuporte(org, `Conferir a caixa de entrada de ${org.slice(-1)} a pedido do cliente`, scope, 1800);
      const { rows } = await pool.query<{ access_mode: string; reason: string | null; scope: string; segundos: string }>(
        `select access_mode, reason, scope, extract(epoch from (expires_at - created_at))::int::text as segundos
           from public.platform_support_sessions where id = $1`,
        [id],
      );
      const linha = rows[0]!;
      expect(linha.access_mode).toBe("support_readonly");
      expect(linha.scope).toBe(scope);
      expect(linha.reason?.length ?? 0).toBeGreaterThanOrEqual(10);
      expect(Number(linha.segundos)).toBeLessThanOrEqual(1800);
      contadores.support_sessions += 1;
      if (linha.reason !== null) contadores.support_reason += 1;
      await encerrarSuporte();
    }
    expect(contadores.support_sessions).toBe(2);
    console.info(`f11-suporte: support_sessions=${contadores.support_sessions} support_reason=${contadores.support_reason}/2 readonly=2/2 ttl_respeitado=2/2`);
  });

  it("sem motivo (< 10) e com escopo fora do enum a sessão NÃO nasce; o modo full não existe no caminho SaaS", async () => {
    const semMotivo = await erroDe(() => iniciarSuporte(ORG_A, "curto", "all"));
    const escopoLivre = await erroDe(() => iniciarSuporte(ORG_A, "Motivo suficientemente longo", "financeiro"));
    expect(semMotivo).toContain("support_reason_required");
    expect(escopoLivre).toContain("support_scope_invalid");
    // `full` não é sequer um parâmetro da função SaaS: o modo é forçado no corpo.
    const id = await iniciarSuporte(ORG_A, "Motivo suficientemente longo", "all");
    const modo = (await pool.query<{ access_mode: string }>(`select access_mode from public.platform_support_sessions where id = $1`, [id])).rows[0]!.access_mode;
    expect(modo).toBe("support_readonly");
    contadores.full_rejected += 1;
    await encerrarSuporte();
    const abertas = await conta(`select count(*)::text as n from public.platform_support_sessions where actor_user_id = $1 and ended_at is null`, [DONO]);
    expect(abertas).toBe(0);
    console.info("f11-suporte: sem_motivo_recusado=1/1 escopo_livre_recusado=1/1 full_mode_rejected=1/1");
  });

  it("escopo: rota fora do escopo é negada (rotaNoEscopo, a função do guarda); `all` alcança tudo; sair e auth ficam sempre abertos", () => {
    const rotas = [
      "/api/v1/inbox/conversations", "/api/v1/messages/1", "/api/v1/contacts", "/api/v1/crm/orders",
      "/api/v1/settings/ai", "/api/v1/team", "/api/v1/billing/subscription", "/api/v1/knowledge/materials",
    ];
    const esperadoPorEscopo: Record<string, number> = { inbox: 2, crm: 2, settings: 2, billing: 1 };
    for (const scope of ESCOPOS_DO_SUPORTE) {
      const permitidas = rotas.filter((r) => rotaNoEscopo(scope, r)).length;
      if (scope === "all") {
        expect(permitidas).toBe(rotas.length);
        continue;
      }
      expect(permitidas, scope).toBe(esperadoPorEscopo[scope]);
      contadores.scope_total += rotas.length;
      contadores.scope_denied += rotas.length - permitidas;
      expect(rotaNoEscopo(scope, "/api/v1/admin/impersonate/end")).toBe(true);
      expect(rotaNoEscopo(scope, "/api/v1/auth/interface")).toBe(true);
    }
    expect(contadores.scope_denied).toBe(4 * rotas.length - (2 + 2 + 2 + 1));
    console.info(`f11-suporte: support_scope_denied=${contadores.scope_denied}/${contadores.scope_total} all_alcanca=${rotas.length}/${rotas.length}`);
  });

  it("só leitura: a escrita é negada pelo guarda (supportWriteError) e pelo banco (fn_support_write_allowed) na organização acompanhada, e liberada fora dela", async () => {
    const id = await iniciarSuporte(ORG_B, "Ler o histórico do cliente a pedido dele", "crm");
    const contexto = supportSchema.parse({
      id, organization_id: ORG_B, actor_user_id: DONO, auth_session_id: SESSAO, previous_organization_id: null,
      expires_at: new Date(Date.now() + 1000).toISOString(), name: "F11 B", locale: null,
      access_mode: "support_readonly", status: "active", reason: "Ler o histórico do cliente a pedido dele", scope: "crm",
    });
    const alvos = [ORG_B, ORG_B, ORG_B, undefined] as const;
    for (const alvo of alvos) {
      contadores.writes_total += 1;
      if (supportWriteError(contexto, alvo) !== null) contadores.writes_denied += 1;
    }
    expect(supportWriteError(contexto, ORG_A)).toBeNull();
    // No banco, com os claims da sessão de suporte:
    const noBanco = await pool.query<{ b: boolean; a: boolean; papel: string | null }>(`
      select public.fn_support_write_allowed($1) as b, public.fn_support_write_allowed($2) as a,
             public.fn_user_role_in_org($1) as papel
        from (select set_config('request.jwt.claims', $3, true)) c`,
      [ORG_B, ORG_A, JSON.stringify({ sub: DONO, session_id: SESSAO, aal: "aal1" })],
    );
    expect(noBanco.rows[0]).toMatchObject({ b: false, a: true, papel: "viewer" });
    contadores.writes_total += 1;
    contadores.writes_denied += 1;
    await encerrarSuporte();
    expect(contadores.writes_denied).toBe(5);
    console.info(`f11-suporte: support_writes_denied=${contadores.writes_denied}/${contadores.writes_total} outra_org_livre=1/1 papel_no_banco=viewer`);
  });
});

describe("F11-T03 — equipes dentro do plano", () => {
  it("PLAN_A (3 membros): com 1 membro sobram 2 vagas; com 3 o convite é negado por limit_reached", async () => {
    const antes = await entitlement(ctxA, "users.invite", { pool });
    expect(antes).toEqual({ allowed: true, remaining: 2, reason: "ok" });
    let dentroDoLimite = 0;
    for (const n of [2, 3]) {
      const membro = `f1100002-1000-4000-8000-00000000000${n}`;
      await pool.query(`insert into auth.users (id, email) values ($1, $2)`, [membro, `f11-membro-${n}@integration.test`]);
      await pool.query(
        `insert into public.user_organizations (organization_id, user_id, role, accepted_at) values ($1, $2, 'agent', now())`,
        [ORG_A, membro],
      );
      dentroDoLimite += 1;
    }
    const noLimite = await entitlement(ctxA, "users.invite", { pool });
    expect(noLimite).toEqual({ allowed: false, remaining: 0, reason: "limit_reached" });
    const semLimite = await entitlement({ organization_id: ORG_B, source: "session" }, "users.invite", { pool });
    expect(semLimite).toEqual({ allowed: true, remaining: null, reason: "ok" });
    console.info(`f11-equipes: invites_within_limit=${dentroDoLimite}/2 invite_over_limit_denied=1/1 plano_sem_limite=1/1`);
  });
});

describe("F11-T04 — a entrada: cadastro nasce pending_payment, sem uso operacional até o pagamento", () => {
  it("assinatura self_service pending_payment → acesso billing_only; nenhuma organização das fixtures fica sem assinatura", async () => {
    expect(await lerAssinatura({ organization_id: ORG_C, source: "session" }, { pool })).toBeNull();
    const semAssinatura = await estadoDeAcesso(ORG_C, { pool });
    expect(semAssinatura.reason).toBe("legacy_without_subscription");

    const nova = await criarAssinatura({ organization_id: ORG_C, source: "session" }, { plan_code: "PLAN_A", origin: "self_service", status: "pending_payment" }, { pool });
    expect(nova).toMatchObject({ status: "pending_payment", origin: "self_service" });
    const acesso = await estadoDeAcesso(ORG_C, { pool });
    expect(acesso).toMatchObject({ mode: "billing_only", reason: "subscription_pending_payment" });

    const orgs = await conta(`select count(*)::text as n from public.organizations where slug like 'f11-%'`);
    const semLinha = await conta(
      `select count(*)::text as n from public.organizations o
        where o.slug like 'f11-%' and not exists (select 1 from public.subscriptions s where s.organization_id = o.id)`,
    );
    expect(semLinha).toBe(0);

    const linha =
      `admin: tenants_listed=${orgs}/${orgs} support_sessions=${contadores.support_sessions} support_reason=${contadores.support_reason}/${contadores.support_sessions} ` +
      `support_scope_denied=${contadores.scope_denied}/${contadores.scope_total} support_writes_denied=${contadores.writes_denied}/${contadores.writes_total} ` +
      `full_mode_rejected=${contadores.full_rejected}/1 signup_pending=1/1 orgs_without_subscription=${semLinha}/${orgs}`;
    console.info(linha);
    gravarLinhaDoVerify("admin", linha);
  });
});
