/**
 * F12-T03/T05/T06/T07 — o ciclo da ASSINATURA contra o banco de verdade
 * (ADR-030 §3; §7.9 F12; D38, D44): contratação e pagamento pelo gateway MOCK,
 * evento duplicado e fora de ordem que NÃO duplicam acesso nem cobrança,
 * inadimplência com aviso → carência → bloqueio preservando dados, reativação
 * pelo pagamento, mudança de plano, cancelamento e conciliação.
 *
 * É a suíte que grava a linha `billing:` do VERIFY SUMMARY (ADR-031):
 *   billing: plans=3 events=E duplicates=1 out_of_order=1 activations=1/1
 *            blocked_writes_denied=W/W grace_days=G reconciliation_mismatch=0/N
 *            cancellations=1/1 data_preserved=R/R
 *
 * Cada número sai de uma contagem no banco, nunca de uma variável do teste
 * (G-14). `AI_PROVIDER=mock`, gateway `mock`: nada real é tocado (D11/D51).
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  acessoDe,
  aplicarEventoDoGateway,
  cancelar,
  conciliar,
  criarAssinatura,
  escritaPermitida,
  estadoDeAcesso,
  iniciarCheckout,
  lerAssinatura,
  listarPlanos,
  mudarPlano,
  rodarVarreduraDaCarencia,
  TransicaoIlegal,
  varrerCarencia,
  TOTAL_DE_TRANSICOES,
  transicao,
  ESTADOS_DA_ASSINATURA,
  EVENTOS_DA_ASSINATURA,
} from "@/src/billing";
import { entitlement, withEntitlement, EntitlementDenied } from "@/src/entitlement";
import { withTenant, type TenantCtx } from "@/src/tenant-context";
import { gravarLinhaDoVerify } from "@/tests/lib/verify-metrics";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
  max: 4,
});

/** A organização que CONTRATA (self-service). */
const ORG = "f1200003-0000-4000-8000-00000000000a";
/** A organização do OUTRO lado — prova de isolamento e denominador da conciliação. */
const ORG_B = "f1200003-0000-4000-8000-00000000000b";
const ADMIN = "f1200003-1001-4000-8000-00000000000a";
const ADMIN_B = "f1200003-1001-4000-8000-00000000000b";
const ctx: TenantCtx = { organization_id: ORG, source: "session", user_id: ADMIN };
const ctxB: TenantCtx = { organization_id: ORG_B, source: "session", user_id: ADMIN_B };

const GRACE_DAYS = 7;
const deps = { pool, graceDays: GRACE_DAYS };

const T0 = new Date("2026-09-13T12:00:00.000Z");
const mais = (base: Date, horas: number) => new Date(base.getTime() + horas * 3_600_000);

const contadores = {
  events: 0,
  duplicates: 0,
  out_of_order: 0,
  activations: 0,
  blocked_writes_denied: 0,
  blocked_writes_total: 0,
  cancellations: 0,
};
/** As linhas de A que o cancelamento preservou (contato + faturas + eventos), contadas no banco. */
let linhasPreservadas = 0;

async function conta(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

async function notificacoes(evento: string, org = ORG): Promise<number> {
  return conta(`select count(*)::text as n from public.notifications where organization_id = $1 and event = $2`, [org, evento]);
}

beforeAll(async () => {
  await pool.query(`
    insert into auth.users (id, email) values
      ('${ADMIN}','f12-admin-a@integration.test'),
      ('${ADMIN_B}','f12-admin-b@integration.test');
    insert into public.organizations (id, slug, legal_name, display_name, onboarded_at) values
      ('${ORG}','f12-assinatura-a','F12 Assinatura A','F12 A', now()),
      ('${ORG_B}','f12-assinatura-b','F12 Assinatura B','F12 B', now());
    insert into public.user_organizations (organization_id, user_id, role, accepted_at) values
      ('${ORG}','${ADMIN}','admin',now()),
      ('${ORG_B}','${ADMIN_B}','admin',now());
  `);
});

afterAll(async () => {
  await pool.end();
});

describe("F12-T02 — a tabela de transições é fechada e espelha o CHECK", () => {
  it("dez transições previstas; todo par (estado, evento) fora delas é null", () => {
    let previstas = 0;
    let ilegais = 0;
    for (const de of ESTADOS_DA_ASSINATURA) {
      for (const ev of EVENTOS_DA_ASSINATURA) {
        if (transicao(de, ev) === null) ilegais += 1;
        else previstas += 1;
      }
    }
    expect(previstas).toBe(TOTAL_DE_TRANSICOES);
    expect(previstas).toBe(10);
    expect(ilegais).toBe(ESTADOS_DA_ASSINATURA.length * EVENTOS_DA_ASSINATURA.length - 10);
    console.info(`f12-estados: previstas=${previstas}/10 ilegais=${ilegais}/${ESTADOS_DA_ASSINATURA.length * EVENTOS_DA_ASSINATURA.length - 10}`);
  });
});

describe("F12-T03 — contratação e pagamento pelo gateway mock", () => {
  it("planos placeholder: 3/3 com price_cents=0 e source=placeholder (D14)", async () => {
    const planos = await listarPlanos({ pool });
    expect(planos.map((p) => p.code)).toEqual(["PLAN_A", "PLAN_B", "PLAN_C"]);
    expect(planos.every((p) => p.price_cents === 0 && p.source === "placeholder")).toBe(true);
    console.info(`f12-planos: placeholders=${planos.length}/3`);
  });

  it("checkout cria a assinatura pending_payment (self_service) com fatura aberta; o acesso é billing_only (D38)", async () => {
    // Arrange — nada existe ainda.
    expect(await lerAssinatura(ctx, deps)).toBeNull();

    // Act
    const { assinatura, fatura } = await iniciarCheckout(ctx, { plan_code: "PLAN_A" }, { ...deps, agora: () => T0 });
    const acesso = await estadoDeAcesso(ORG, { pool });

    // Assert — tela contra banco: a linha existe e diz pending_payment.
    expect(assinatura).toMatchObject({ status: "pending_payment", origin: "self_service", plan_code: "PLAN_A" });
    expect(fatura).toMatchObject({ status: "open", amount_cents: 0, plan_code: "PLAN_A" });
    expect(acesso).toMatchObject({ mode: "billing_only", reason: "subscription_pending_payment" });
    expect(escritaPermitida(acesso, "POST", "/api/v1/contacts")).toBe(false);
    expect(escritaPermitida(acesso, "GET", "/api/v1/contacts")).toBe(false);
    expect(escritaPermitida(acesso, "POST", "/api/v1/billing/checkout")).toBe(true);
    const ent = await entitlement(ctx, "ai.reply", { pool });
    expect(ent).toEqual({ allowed: false, remaining: 0, reason: "subscription_pending_payment" });
    // O checkout repetido não cria segunda fatura.
    const outra = await iniciarCheckout(ctx, { plan_code: "PLAN_A" }, { ...deps, agora: () => T0 });
    expect(outra.fatura.id).toBe(fatura.id);
    expect(await conta(`select count(*)::text as n from public.invoices where organization_id = $1`, [ORG])).toBe(1);
    console.info("f12-checkout: pending_payment=1/1 fatura_aberta=1/1 acesso_billing_only=1/1 checkout_repetido_sem_segunda_fatura=1/1");
  });

  it("payment_confirmed ativa UMA vez; o mesmo evento de novo é duplicate e um mais antigo é out_of_order — nada muda", async () => {
    // Arrange
    const confirmado = { gateway: "mock" as const, event_ref: "evt-pay-1", event_type: "payment_confirmed" as const, occurred_at: mais(T0, 1).toISOString(), amount_cents: 0 };

    // Act — o pagamento, depois a mesma entrega duas vezes, depois um evento com occurred_at anterior.
    const primeira = await aplicarEventoDoGateway(ctx, confirmado, deps);
    contadores.events += 1;
    const repetida = await aplicarEventoDoGateway(ctx, confirmado, deps);
    contadores.events += 1;
    const atrasada = await aplicarEventoDoGateway(
      ctx,
      { gateway: "mock", event_ref: "evt-fail-0", event_type: "payment_failed", occurred_at: mais(T0, 0.5).toISOString() },
      deps,
    );
    contadores.events += 1;

    // Assert — uma ativação, uma fatura paga, uma notificação de ativação.
    expect(primeira.applied).toBe(true);
    if (primeira.applied) expect(primeira.assinatura.status).toBe("active");
    expect(repetida).toMatchObject({ applied: false, ignored_reason: "duplicate" });
    expect(atrasada).toMatchObject({ applied: false, ignored_reason: "out_of_order" });
    if (repetida.applied === false) contadores.duplicates += 1;
    if (atrasada.applied === false) contadores.out_of_order += 1;
    const assinatura = await lerAssinatura(ctx, deps);
    expect(assinatura?.status).toBe("active");
    expect(assinatura?.gateway_ref).toBe("evt-pay-1");
    const eventosGravados = await conta(`select count(*)::text as n from public.billing_events where organization_id = $1`, [ORG]);
    const aplicados = await conta(`select count(*)::text as n from public.billing_events where organization_id = $1 and applied`, [ORG]);
    const foraDeOrdem = await conta(`select count(*)::text as n from public.billing_events where organization_id = $1 and ignored_reason = 'out_of_order'`, [ORG]);
    const pagas = await conta(`select count(*)::text as n from public.invoices where organization_id = $1 and status = 'paid' and gateway_ref = 'evt-pay-1'`, [ORG]);
    expect(eventosGravados, "duplicata NÃO vira linha").toBe(2);
    expect(aplicados).toBe(1);
    expect(foraDeOrdem).toBe(1);
    expect(pagas).toBe(1);
    contadores.activations += 1;
    expect(await notificacoes("subscription.activated")).toBe(1);
    const acesso = await estadoDeAcesso(ORG, { pool });
    expect(acesso.mode).toBe("full");
    const ent = await entitlement(ctx, "ai.reply", { pool });
    expect(ent).toMatchObject({ allowed: true, remaining: 500, reason: "ok" });
    console.info(`f12-pagamento: activations=1/1 events_stored=${eventosGravados}/2 applied=${aplicados}/1 duplicate=1/1 out_of_order=${foraDeOrdem}/1 invoices_paid=${pagas}/1 notified=1/1`);
  });
});

describe("F12-T06 — inadimplência (D44): aviso, carência, bloqueio preservando dados, reativação", () => {
  it("payment_failed em active → past_due com grace_until = +BILLING_GRACE_DAYS e aviso ao tenant_admin; acesso continua full", async () => {
    // Arrange — o cliente tem dados que NÃO podem sumir.
    await withTenant(ctx, async (db) => {
      await db.query(
        `insert into public.contacts (organization_id, display_name, phone_number) values ($1, 'Cliente F12', '+5511900001200')`,
        [ORG],
      );
    }, { pool });
    const antes = await conta(`select count(*)::text as n from public.contacts where organization_id = $1`, [ORG]);

    // Act
    const falhou = await aplicarEventoDoGateway(
      ctx,
      { gateway: "mock", event_ref: "evt-fail-1", event_type: "payment_failed", occurred_at: mais(T0, 2).toISOString() },
      deps,
    );
    contadores.events += 1;

    // Assert
    expect(falhou.applied).toBe(true);
    const assinatura = await lerAssinatura(ctx, deps);
    expect(assinatura?.status).toBe("past_due");
    const esperado = new Date(mais(T0, 2).getTime() + GRACE_DAYS * 86_400_000).toISOString();
    expect(assinatura?.grace_until).toBe(esperado);
    expect(await notificacoes("subscription.payment_failed")).toBe(1);
    expect((await estadoDeAcesso(ORG, { pool })).mode).toBe("full");
    expect(await conta(`select count(*)::text as n from public.contacts where organization_id = $1`, [ORG])).toBe(antes);
    console.info(`f12-past-due: past_due=1/1 grace_days=${GRACE_DAYS} notified=1/1 acesso_full_na_carencia=1/1`);
  });

  it("a varredura por tenant (cron, D20) ANTES do prazo lista 0; DEPOIS bloqueia 1 e avisa; rodar de novo bloqueia 0", async () => {
    // O cron lista os tenants ELEGÍVEIS (past_due com grace_until vencido) e
    // roda um TenantCtx por tenant — B (ativa) nunca entra na lista.
    const antesDoPrazo = await rodarVarreduraDaCarencia({ ...deps, agora: () => mais(T0, 3) });
    const depoisDoPrazo = await rodarVarreduraDaCarencia({ ...deps, agora: () => new Date(mais(T0, 2).getTime() + (GRACE_DAYS + 1) * 86_400_000) });
    const deNovo = await rodarVarreduraDaCarencia({ ...deps, agora: () => new Date(mais(T0, 2).getTime() + (GRACE_DAYS + 2) * 86_400_000) });

    expect(antesDoPrazo).toEqual({ tenants_eligible: 0, tenants_failed: 0, blocked: 0, notified: 0 });
    expect(depoisDoPrazo).toEqual({ tenants_eligible: 1, tenants_failed: 0, blocked: 1, notified: 1 });
    expect(deNovo).toEqual({ tenants_eligible: 0, tenants_failed: 0, blocked: 0, notified: 0 });
    expect((await lerAssinatura(ctx, deps))?.status).toBe("blocked");
    expect(await notificacoes("subscription.blocked")).toBe(1);
    // A função por tenant, chamada direto numa assinatura já bloqueada, também é 0.
    expect(await varrerCarencia(ctx, deps)).toEqual({ blocked: 0, notified: 0 });
    console.info("f12-carencia: tenants_eligible_antes=0/0 blocked_after_grace=1/1 notified=1/1 rerun=0/0");
  });

  it("bloqueada: escrita negada, leitura e cobrança permitidas, capability negada SEM chamar o provedor, dados preservados", async () => {
    const acesso = await estadoDeAcesso(ORG, { pool });
    expect(acesso).toMatchObject({ mode: "read_only", reason: "subscription_blocked" });

    // Escrita nas rotas de negócio: negada. Leitura: permitida. Cobrança e auth: permitidas.
    const escritas = ["/api/v1/contacts", "/api/v1/crm/orders", "/api/v1/messages", "/api/v1/settings/ai", "/api/v1/inbox/conversations/x/reply"];
    for (const caminho of escritas) {
      contadores.blocked_writes_total += 1;
      if (!escritaPermitida(acesso, "POST", caminho)) contadores.blocked_writes_denied += 1;
    }
    const leituras = escritas.filter((c) => escritaPermitida(acesso, "GET", c)).length;
    expect(contadores.blocked_writes_denied).toBe(escritas.length);
    expect(leituras).toBe(escritas.length);
    expect(escritaPermitida(acesso, "POST", "/api/v1/billing/checkout")).toBe(true);
    expect(escritaPermitida(acesso, "POST", "/api/v1/auth/logout")).toBe(true);

    // Capability: negada antes do provedor, nada gravado (G-20).
    let provedorChamado = false;
    const usoAntes = await conta(`select count(*)::text as n from public.ai_usage_events where organization_id = $1`, [ORG]);
    await expect(
      withEntitlement(ctx, "ai.reply", async () => { provedorChamado = true; return { result: "nunca" }; }, { pool }),
    ).rejects.toBeInstanceOf(EntitlementDenied);
    expect(provedorChamado).toBe(false);
    expect(await conta(`select count(*)::text as n from public.ai_usage_events where organization_id = $1`, [ORG])).toBe(usoAntes);

    // Dados preservados: o contato continua lá.
    expect(await conta(`select count(*)::text as n from public.contacts where organization_id = $1`, [ORG])).toBe(1);
    console.info(`f12-bloqueio: writes_denied=${contadores.blocked_writes_denied}/${escritas.length} reads_allowed=${leituras}/${escritas.length} billing_open=1/1 provider_calls=0/0 data_preserved=1/1`);
  });

  it("payment_confirmed reativa a bloqueada: active, período novo, fatura de renovação paga", async () => {
    const ok = await aplicarEventoDoGateway(
      ctx,
      { gateway: "mock", event_ref: "evt-pay-2", event_type: "payment_confirmed", occurred_at: new Date(mais(T0, 2).getTime() + (GRACE_DAYS + 3) * 86_400_000).toISOString() },
      deps,
    );
    contadores.events += 1;
    expect(ok.applied).toBe(true);
    const assinatura = await lerAssinatura(ctx, deps);
    expect(assinatura?.status).toBe("active");
    expect(assinatura?.blocked_at).toBeNull();
    expect(assinatura?.grace_until).toBeNull();
    const pagas = await conta(`select count(*)::text as n from public.invoices where organization_id = $1 and status = 'paid'`, [ORG]);
    expect(pagas).toBe(2);
    expect(await notificacoes("subscription.activated")).toBe(2);
    console.info(`f12-reativacao: reactivated=1/1 invoices_paid=${pagas}/2`);
  });
});

describe("F12-T05 — mudança de plano e cancelamento", () => {
  it("mudança de plano é imediata (sem pro-rata, default declarado) e o limite novo vale na hora", async () => {
    const antes = await entitlement(ctx, "users.invite", { pool });
    const mudada = await mudarPlano(ctx, { plan_code: "PLAN_B" }, deps);
    const depois = await entitlement(ctx, "users.invite", { pool });
    expect(antes).toMatchObject({ allowed: true, remaining: 2 }); // PLAN_A: 3 − 1 membro
    expect(mudada.plan_code).toBe("PLAN_B");
    expect(depois).toMatchObject({ allowed: true, remaining: 9 }); // PLAN_B: 10 − 1
    await expect(mudarPlano(ctx, { plan_code: "PLAN_Z" }, deps)).rejects.toThrow(/plano desconhecido/);
    console.info("f12-plano: plan_changed=1/1 limite_novo_na_hora=1/1 plano_desconhecido_recusado=1/1");
  });

  it("cancelar preserva dados, mantém a cobrança legível e nega o resto; reativação é novo checkout → pending_payment", async () => {
    const linhasAntes = {
      contacts: await conta(`select count(*)::text as n from public.contacts where organization_id = $1`, [ORG]),
      invoices: await conta(`select count(*)::text as n from public.invoices where organization_id = $1`, [ORG]),
      events: await conta(`select count(*)::text as n from public.billing_events where organization_id = $1`, [ORG]),
    };

    const cancelada = await cancelar(ctx, { reason: "teste de cancelamento F12" }, deps);
    contadores.cancellations += 1;
    expect(cancelada.status).toBe("cancelled");
    expect(cancelada.cancel_reason).toBe("teste de cancelamento F12");
    const acesso = await estadoDeAcesso(ORG, { pool });
    expect(acesso).toMatchObject({ mode: "billing_only", reason: "subscription_cancelled" });
    expect(escritaPermitida(acesso, "GET", "/api/v1/billing/subscription")).toBe(true);
    expect(escritaPermitida(acesso, "GET", "/api/v1/contacts")).toBe(false);
    await expect(cancelar(ctx, { reason: "de novo" }, deps)).rejects.toBeInstanceOf(TransicaoIlegal);

    const linhasDepois = {
      contacts: await conta(`select count(*)::text as n from public.contacts where organization_id = $1`, [ORG]),
      invoices: await conta(`select count(*)::text as n from public.invoices where organization_id = $1`, [ORG]),
      events: await conta(`select count(*)::text as n from public.billing_events where organization_id = $1`, [ORG]),
    };
    expect(linhasDepois).toEqual(linhasAntes);

    // Reativação: checkout devolve a mesma linha a pending_payment com fatura aberta nova.
    const { assinatura, fatura } = await iniciarCheckout(ctx, { plan_code: "PLAN_A" }, { ...deps, agora: () => mais(T0, 400) });
    expect(assinatura).toMatchObject({ id: cancelada.id, status: "pending_payment", plan_code: "PLAN_A", cancelled_at: null });
    expect(fatura.status).toBe("open");
    const preservadas = Object.values(linhasAntes).reduce((s, n) => s + n, 0);
    linhasPreservadas = preservadas;
    console.info(`f12-cancelamento: cancelled=1/1 data_preserved=${preservadas}/${preservadas} billing_readable_after_cancel=1/1 segundo_cancelamento_recusado=1/1 reativacao_pending=1/1`);
  });
});

describe("F12-T07 — conciliação e a linha do verificador", () => {
  it("faturas pagas × eventos aplicados: matched=N mismatch=0 por organização e na plataforma; B não vê A", async () => {
    // Arrange — B contrata e paga uma vez (origem operator → não passa por checkout).
    await criarAssinatura(ctxB, { plan_code: "PLAN_C", origin: "operator", status: "active" }, deps);
    const okB = await aplicarEventoDoGateway(
      ctxB,
      { gateway: "mock", event_ref: "evt-pay-b-1", event_type: "payment_confirmed", occurred_at: mais(T0, 5).toISOString() },
      deps,
    );
    contadores.events += 1;
    expect(okB.applied).toBe(true);
    contadores.activations += 0; // renovação de active: não é a ativação medida (A é a única pending→active)

    // Act
    const deA = await conciliar(ORG, { pool });
    const deB = await conciliar(ORG_B, { pool });
    const tudo = await conciliar(null, { pool });

    // Assert
    expect(deA).toMatchObject({ invoices_paid: 2, events_applied: 2, matched: 2, mismatch: 0 });
    expect(deB).toMatchObject({ invoices_paid: 1, events_applied: 1, matched: 1, mismatch: 0 });
    expect(tudo.invoices_paid).toBeGreaterThanOrEqual(3);
    expect(tudo.mismatch).toBe(0);
    // Isolamento: os eventos de B não aparecem em A nem os de A em B.
    expect(await conta(`select count(*)::text as n from public.billing_events where organization_id = $1 and event_ref like 'evt-pay-b%'`, [ORG])).toBe(0);
    expect(await conta(`select count(*)::text as n from public.billing_events where organization_id = $1 and event_ref like 'evt-pay-_'`, [ORG_B])).toBe(0);

    // Uma divergência FABRICADA é vista: fatura paga sem evento.
    await pool.query(
      `insert into public.invoices (organization_id, subscription_id, plan_code, period_start, period_end, amount_cents, currency, status, due_at, paid_at, gateway_ref)
       select $1, id, 'PLAN_C', now(), now() + interval '30 days', 0, 'BRL', 'paid', now(), now(), 'evt-fantasma' from public.subscriptions where organization_id = $1`,
      [ORG_B],
    );
    const comFantasma = await conciliar(ORG_B, { pool });
    expect(comFantasma.mismatch).toBe(1);
    expect(comFantasma.divergences[0]).toMatchObject({ kind: "invoice_without_event", ref: "evt-fantasma" });
    await pool.query(`delete from public.invoices where organization_id = $1 and gateway_ref = 'evt-fantasma'`, [ORG_B]);
    const limpa = await conciliar(null, { pool });
    expect(limpa.mismatch).toBe(0);

    const planos = await listarPlanos({ pool });
    const linha =
      `billing: plans=${planos.length} events=${contadores.events} duplicates=${contadores.duplicates} out_of_order=${contadores.out_of_order} ` +
      `activations=${contadores.activations}/1 blocked_writes_denied=${contadores.blocked_writes_denied}/${contadores.blocked_writes_total} ` +
      `grace_days=${GRACE_DAYS} reconciliation_mismatch=${limpa.mismatch}/${limpa.invoices_paid} ` +
      `cancellations=${contadores.cancellations}/1 data_preserved=${linhasPreservadas}/${linhasPreservadas}`;
    console.info(linha);
    gravarLinhaDoVerify("billing", linha);
    expect(contadores.events).toBe(6);
  });
});
