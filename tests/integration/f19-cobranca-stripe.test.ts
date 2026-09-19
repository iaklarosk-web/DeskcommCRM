/**
 * F19 — cobrança REAL por Stripe contra o banco descartável e o Stripe FALSO
 * em processo (`tests/lib/stripe-falso.mjs`), ADR-042/043. Grava a linha
 * `stripe:` do bloco (`gravarLinhaDoVerify`) no ÚLTIMO caso, com todos os
 * campos do contrato de ADR-043 §2 — nunca pela metade (RETOMADA regra 7).
 *
 * O que se mede aqui e o mock nunca mediu: o webhook recusa assinatura
 * inválida (401), evento de outro modo (422) e preço fora da lista (422), sem
 * gravar linha; o estado vem do PROVEDOR (o payload diz `active`, o provedor
 * diz `past_due`, o CRM grava `past_due`); `trialing` chega como `active` com
 * `trial_ends_at` (D57 c); duplicata e fora de ordem continuam contados, não
 * aplicados (F12). A organização vem de `client_reference_id` (checkout) ou de
 * `subscriptions.gateway_ref` (os demais) — nunca só do payload (D20).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cancelar, iniciarCheckout, lerAssinatura, mudarPlano, TransicaoIlegal, UsePortal, varrerCarencia } from "@/src/billing";
import { DiasForaDaFaixa, estenderTrial, linkNoStripe, provisionarNaMao, reativar, suspender } from "@/src/billing/admin";
import { PLANOS_PLACEHOLDER, provisionar } from "@/src/billing/provisionar";
import { montarCockpit } from "@/src/billing/summary";
import { assinarComoOStripe, criarSessaoDeCheckout, criarSessaoDoPortal } from "@/src/billing/gateway/stripe";
import { receberEventoStripe, type DepsDoReceptor } from "@/src/billing/webhook-stripe";
import type { TenantCtx } from "@/src/tenant-context";
import { subirStripeFalso } from "@/tests/lib/stripe-falso.mjs";
import { gravarLinhaDoVerify } from "@/tests/lib/verify-metrics";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`, max: 4 });

const ORG_A = "f1900002-0000-4000-8000-000000000001"; // a organização das fixtures
const ORG_B = "f1900002-0000-4000-8000-000000000002";
const ORG_C = "f1900002-0000-4000-8000-000000000003";
const ADMIN_A = "f1900002-1001-4000-8000-000000000001";
const ADMIN_B = "f1900002-1001-4000-8000-000000000002";
const ADMIN_C = "f1900002-1001-4000-8000-000000000003";
const ctxA: TenantCtx = { organization_id: ORG_A, source: "session", user_id: ADMIN_A };
const ctxB: TenantCtx = { organization_id: ORG_B, source: "session", user_id: ADMIN_B };
const ctxC: TenantCtx = { organization_id: ORG_C, source: "session", user_id: ADMIN_C };

const SECRET = "whsec_bancada_f19_nao_e_segredo";
const CHAVE = "rk_test_bancada_f19";
const PRECOS = "price_1F19FixturePlanA:PLAN_A,price_1F19FixturePlanB:PLAN_B,price_1F19FixturePlanC:PLAN_C";
const SUB_FIXTURE = "sub_1F19Fixture00000001";

type Falso = Awaited<ReturnType<typeof subirStripeFalso>>;
let falso: Falso;
let deps: DepsDoReceptor;

function fixture(nome: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(__dirname, "../fixtures/stripe", `${nome}.json`), "utf8")) as Record<string, unknown>;
}

/** Entrega um evento ao receptor como o Stripe entregaria: corpo + `Stripe-Signature` no `created`. */
async function entregar(evento: Record<string, unknown>, opts: { secret?: string; agora?: number } = {}) {
  const corpo = JSON.stringify(evento);
  const t = typeof evento.created === "number" ? evento.created : Math.floor(Date.now() / 1000);
  const header = assinarComoOStripe(corpo, opts.secret ?? SECRET, t);
  return receberEventoStripe(corpo, header, { ...deps, agoraUnix: () => opts.agora ?? t });
}

async function conta(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

const medidas = {
  signature_rejected: 0,
  livemode_mismatch: 0,
  price_outside_list: 0,
  checkout_created: 0,
  activated: 0,
  trialing_mapped: 0,
  duplicates: 0,
  out_of_order: 0,
  state_from_provider: 0,
  past_due: 0,
  blocked_after_grace: 0,
  cancelled_preserved: 0,
  cancelled_preserved_total: 0,
  portal_link: 0,
  admin_actions: 0,
  summary_ok: 0,
};

beforeAll(async () => {
  falso = await subirStripeFalso({ chave: CHAVE, webhookSecret: SECRET });
  deps = { pool, graceDays: 7, secret: SECRET, modo: "test", chave: CHAVE, base: falso.base, precos: PRECOS };
  await pool.query(`insert into auth.users (id, email) values ('${ADMIN_A}','f19-a@integration.test'), ('${ADMIN_B}','f19-b@integration.test'), ('${ADMIN_C}','f19-c@integration.test')`);
  await pool.query(`
    insert into public.organizations (id, slug, legal_name, display_name, onboarded_at) values
      ('${ORG_A}','f19-stripe-a','F19 Stripe A','F19 A', now()),
      ('${ORG_B}','f19-stripe-b','F19 Stripe B','F19 B', now()),
      ('${ORG_C}','f19-stripe-c','F19 Stripe C','F19 C', now())`);
  await pool.query(`
    insert into public.user_organizations (organization_id, user_id, role, accepted_at) values
      ('${ORG_A}','${ADMIN_A}','admin',now()), ('${ORG_B}','${ADMIN_B}','admin',now()), ('${ORG_C}','${ADMIN_C}','admin',now())`);
  // A subscription das fixtures existe no provedor falso, em trial, no PLAN_A.
  falso.definirAssinatura(SUB_FIXTURE, { status: "trialing", customer: "cus_F19Fixture000001", trial_end: 1758895100, items: { object: "list", data: [{ price: { id: "price_1F19FixturePlanA" } }] } });
});

afterAll(async () => {
  await falso.parar();
  await pool.end();
});

describe("F19-T02 — o checkout e a ativação pelo webhook", () => {
  it("o checkout do Stripe nasce com client_reference_id = organização, o price do plano, trial de 7 dias e cartão sempre (checkout_created=1/1)", async () => {
    // Arrange — contratação pendente (F12) → sessão no provedor (F19)
    const { assinatura } = await iniciarCheckout(ctxA, { plan_code: "PLAN_A" }, { pool });
    expect(assinatura.status).toBe("pending_payment");

    // Act
    const sessao = await criarSessaoDeCheckout(
      { base: falso.base, chave: CHAVE },
      { organization_id: ORG_A, price_id: "price_1F19FixturePlanA", trial_days: 7, success_url: "http://app/ok", cancel_url: "http://app/nao", customer_email: "f19-a@integration.test" },
    );

    // Assert — o que o provedor recebeu
    const chamada = falso.chamadas.find((c) => c.caminho === "/v1/checkout/sessions");
    expect(sessao.url).toContain(`/checkout/${sessao.id}`);
    expect(chamada?.form).toMatchObject({ client_reference_id: ORG_A, "line_items[0][price]": "price_1F19FixturePlanA", payment_method_collection: "always", "subscription_data[trial_period_days]": "7" });
    expect(chamada?.auth).toBe(`Bearer ${CHAVE}`);
    medidas.checkout_created += 1;
    console.info("f19-checkout: checkout_created=1/1 client_reference_id=1/1 cartao_sempre=1/1 trial=7");
  });

  it("checkout.session.completed ativa pelo ESTADO do provedor: trialing → active com trial_ends_at, gateway_ref = sub e customer_ref (activated=1/1 trialing_mapped=1/1)", async () => {
    // Act
    const r = await entregar(fixture("checkout.session.completed"));

    // Assert
    expect(r).toMatchObject({ status: 200, code: "ok", organization_id: ORG_A });
    if (r.code !== "ok") throw new Error("não aplicou");
    expect(r.desfecho.applied).toBe(true);
    const a = await lerAssinatura(ctxA, { pool });
    expect(a?.status).toBe("active");
    expect(a?.gateway).toBe("stripe");
    expect(a?.gateway_ref).toBe(SUB_FIXTURE);
    expect(a?.customer_ref).toBe("cus_F19Fixture000001");
    expect(a?.trial_ends_at).toBe(new Date(1758895100 * 1000).toISOString());
    expect(falso.chamadas.some((c) => c.metodo === "GET" && c.caminho === `/v1/subscriptions/${SUB_FIXTURE}`), "o estado não foi buscado no provedor").toBe(true);
    expect(await conta(`select count(*)::text as n from public.billing_events where organization_id = $1 and gateway = 'stripe' and applied and livemode = false`, [ORG_A])).toBe(1);
    expect(await conta(`select count(*)::text as n from public.invoices where organization_id = $1 and status = 'paid'`, [ORG_A])).toBe(1);
    medidas.activated += 1;
    medidas.trialing_mapped += 1;
    console.info("f19-ativacao: activated=1/1 trialing_mapped=1/1 estado_do_provedor=1/1 events=1/1 invoices_paid=1/1");
  });

  it("a mesma entrega duas vezes é duplicate; invoice.paid mais antigo que o último aplicado é out_of_order — nenhum dos dois ativa de novo", async () => {
    // Act
    const dup = await entregar(fixture("checkout.session.completed"));
    const antigo = fixture("invoice.paid");
    antigo.created = 1758290000; // antes do checkout (1758290400)
    const fora = await entregar(antigo);

    // Assert
    expect(dup).toMatchObject({ status: 200, code: "ok" });
    expect(fora).toMatchObject({ status: 200, code: "ok" });
    if (dup.code !== "ok" || fora.code !== "ok") throw new Error("não chegou ao desfecho");
    expect(dup.desfecho).toMatchObject({ applied: false, ignored_reason: "duplicate" });
    expect(fora.desfecho).toMatchObject({ applied: false, ignored_reason: "out_of_order" });
    expect(await conta(`select count(*)::text as n from public.billing_events where organization_id = $1 and applied`, [ORG_A])).toBe(1);
    expect(await conta(`select count(*)::text as n from public.notifications where organization_id = $1 and event = 'subscription.activated'`, [ORG_A])).toBe(1);
    medidas.duplicates += 1;
    medidas.out_of_order += 1;
    console.info("f19-repeticao: duplicates=1 out_of_order=1 activations=1/1");
  });

  it("estado do provedor: o payload diz active, o provedor diz past_due, o CRM grava past_due", async () => {
    // Arrange — AUTOCONTIDO (alvo do mutante 85): a organização B já tem a
    // assinatura ativa no Stripe, e o provedor passa a responder past_due.
    const SUB_B = "sub_f19_estado_b";
    await pool.query(
      `insert into public.subscriptions (organization_id, plan_code, status, origin, gateway, gateway_ref, customer_ref, current_period_start, current_period_end, last_event_at)
       values ($1, 'PLAN_A', 'active', 'fixture', 'stripe', $2, 'cus_f19_b', now() - interval '1 day', now() + interval '29 days', now() - interval '1 day')`,
      [ORG_B, SUB_B],
    );
    falso.definirAssinatura(SUB_B, { status: "past_due", customer: "cus_f19_b", trial_end: null, items: { object: "list", data: [{ price: { id: "price_1F19FixturePlanA" } }] } });
    const evento = fixture("customer.subscription.updated");
    evento.id = "evt_1F19Fixture000000000013";
    evento.created = Math.floor(Date.now() / 1000);
    const objeto = (evento.data as { object: Record<string, unknown> }).object;
    objeto.id = SUB_B;
    objeto.status = "active"; // o payload MENTE
    objeto.items = { object: "list", data: [{ price: { id: "price_1F19FixturePlanA" } }] };

    // Act
    const r = await entregar(evento);

    // Assert
    expect(r).toMatchObject({ status: 200, code: "ok", organization_id: ORG_B, plano_sincronizado: false });
    const a = await lerAssinatura(ctxB, { pool });
    expect(a?.status, "o estado veio do payload, não do provedor").toBe("past_due");
    expect(a?.grace_until).not.toBeNull();
    expect(falso.chamadas.some((c) => c.metodo === "GET" && c.caminho === `/v1/subscriptions/${SUB_B}`)).toBe(true);
    medidas.state_from_provider += 1;
    medidas.past_due += 1;
    console.info("f19-estado: state_from_provider=1/1 past_due=1/1");
  });

  it("customer.subscription.updated com preço do PLAN_B no provedor (troca no Portal) sincroniza plan_code", async () => {
    // Arrange — volta a active, agora no price do PLAN_B
    falso.definirAssinatura(SUB_FIXTURE, { status: "active", customer: "cus_F19Fixture000001", trial_end: null, items: { object: "list", data: [{ price: { id: "price_1F19FixturePlanB" } }] } });
    const evento = fixture("customer.subscription.updated");
    evento.id = "evt_1F19Fixture000000000014";
    evento.created = 1758895400;

    // Act
    const r = await entregar(evento);

    // Assert
    expect(r).toMatchObject({ status: 200, code: "ok", plano_sincronizado: true });
    const a = await lerAssinatura(ctxA, { pool });
    expect(a?.status).toBe("active");
    expect(a?.plan_code).toBe("PLAN_B");
    console.info("f19-plano: plan_synced=1/1 PLAN_A→PLAN_B");
  });
});

describe("F19-T02 — as três recusas que o mock nunca teve (nenhuma grava linha)", () => {
  it("assinatura inválida → 401 (signature_rejected=1/1)", async () => {
    const antes = await conta(`select count(*)::text as n from public.billing_events where gateway = 'stripe'`, []);
    const evento = fixture("invoice.paid");
    evento.id = "evt_1F19Fixture000000000021";
    const r1 = await entregar(evento, { secret: "whsec_outro" });
    const r2 = await receberEventoStripe(JSON.stringify(evento), null, deps);
    const r3 = await entregar(evento, { agora: (evento.created as number) + 3600 }); // t vencido
    expect(r1).toEqual({ status: 401, code: "invalid_signature" });
    expect(r2).toEqual({ status: 401, code: "invalid_signature" });
    expect(r3).toEqual({ status: 401, code: "invalid_signature" });
    expect(await conta(`select count(*)::text as n from public.billing_events where gateway = 'stripe'`, [])).toBe(antes);
    medidas.signature_rejected += 1;
    console.info("f19-recusa: signature_rejected=1/1 (3 formas) linhas_gravadas=0/0");
  });

  it("livemode: evento live numa instalação test é 422 e não grava", async () => {
    const antes = await conta(`select count(*)::text as n from public.billing_events where gateway = 'stripe'`, []);
    const evento = fixture("invoice.paid");
    evento.id = "evt_1F19Fixture000000000022";
    evento.livemode = true;
    const r = await entregar(evento);
    expect(r, "evento live entrou numa instalação test").toEqual({ status: 422, code: "livemode_mismatch" });
    expect(await conta(`select count(*)::text as n from public.billing_events where gateway = 'stripe'`, [])).toBe(antes);
    medidas.livemode_mismatch += 1;
    console.info("f19-recusa: livemode_mismatch=1/1 linhas_gravadas=0/0");
  });

  it("preço fora de STRIPE_PRICE_IDS no provedor → 422 price_outside_list (price_outside_list=1/1)", async () => {
    const antes = await conta(`select count(*)::text as n from public.billing_events where gateway = 'stripe'`, []);
    falso.definirAssinatura("sub_fora_da_lista", { status: "active", customer: "cus_x", items: { object: "list", data: [{ price: { id: "price_QueNinguemProvisionou" } }] }, metadata: { organization_id: ORG_B } });
    const evento = fixture("customer.subscription.updated");
    evento.id = "evt_1F19Fixture000000000023";
    (evento.data as { object: Record<string, unknown> }).object.id = "sub_fora_da_lista";
    (evento.data as { object: Record<string, unknown> }).object.metadata = { organization_id: ORG_B };
    const r = await entregar(evento);
    expect(r).toEqual({ status: 422, code: "price_outside_list" });
    expect(await conta(`select count(*)::text as n from public.billing_events where gateway = 'stripe'`, [])).toBe(antes);
    medidas.price_outside_list += 1;
    console.info("f19-recusa: price_outside_list=1/1 linhas_gravadas=0/0");
  });

  it("tipo não tratado e subscription desconhecida são 200 ignored, sem linha; segredo vazio é 503", async () => {
    const antes = await conta(`select count(*)::text as n from public.billing_events where gateway = 'stripe'`, []);
    const outro = { ...fixture("invoice.paid"), id: "evt_1F19Fixture000000000024", type: "charge.succeeded" };
    const desconhecida = fixture("invoice.paid");
    desconhecida.id = "evt_1F19Fixture000000000025";
    (desconhecida.data as { object: Record<string, unknown> }).object.subscription = "sub_ninguem";
    expect(await entregar(outro)).toMatchObject({ status: 200, code: "ignored", motivo: "unhandled_type" });
    expect(await entregar(desconhecida)).toMatchObject({ status: 200, code: "ignored", motivo: "unknown_subscription" });
    expect(await receberEventoStripe("{}", null, { ...deps, secret: "" })).toEqual({ status: 503, code: "upstream_unavailable" });
    expect(await conta(`select count(*)::text as n from public.billing_events where gateway = 'stripe'`, [])).toBe(antes);
  });
});

describe("F19-T03 — D44 sobre eventos reais, o Portal e o cancelamento que preserva dados", () => {
  const SUB_C = "sub_f19_carencia_c";
  const T_FALHA = 1758895200; // o `created` da fixture invoice.payment_failed

  it("invoice.payment_failed abre a carência (past_due com grace_until = +7 dias) e avisa o tenant_admin", async () => {
    // Arrange — organização C ativa no Stripe
    await pool.query(
      `insert into public.subscriptions (organization_id, plan_code, status, origin, gateway, gateway_ref, customer_ref, current_period_start, current_period_end, last_event_at)
       values ($1, 'PLAN_A', 'active', 'fixture', 'stripe', $2, 'cus_f19_c', to_timestamp($3) - interval '30 days', to_timestamp($3) + interval '1 day', to_timestamp($3) - interval '30 days')`,
      [ORG_C, SUB_C, T_FALHA],
    );
    const evento = fixture("invoice.payment_failed");
    (evento.data as { object: Record<string, unknown> }).object.subscription = SUB_C;

    // Act
    const r = await entregar(evento);

    // Assert
    expect(r).toMatchObject({ status: 200, code: "ok", organization_id: ORG_C });
    const a = await lerAssinatura(ctxC, { pool });
    expect(a?.status).toBe("past_due");
    expect(a?.grace_until).toBe(new Date((T_FALHA + 7 * 86_400) * 1000).toISOString());
    expect(await conta(`select count(*)::text as n from public.notifications where organization_id = $1 and event = 'subscription.payment_failed'`, [ORG_C])).toBe(1);
    console.info("f19-carencia: past_due=1/1 grace_days=7 aviso=1/1");
  });

  it("a varredura da carência bloqueia depois de 7 dias — antes disso não (blocked_after_grace=1/1)", async () => {
    // Act — um dia antes do prazo, nada; no prazo, bloqueia; de novo, 0
    const antes = await varrerCarencia(ctxC, { pool, agora: () => new Date((T_FALHA + 6 * 86_400) * 1000) });
    const noPrazo = await varrerCarencia(ctxC, { pool, agora: () => new Date((T_FALHA + 7 * 86_400 + 1) * 1000) });
    const deNovo = await varrerCarencia(ctxC, { pool, agora: () => new Date((T_FALHA + 8 * 86_400) * 1000) });

    // Assert
    expect(antes).toEqual({ blocked: 0, notified: 0 });
    expect(noPrazo.blocked).toBe(1);
    expect(deNovo).toEqual({ blocked: 0, notified: 0 });
    const a = await lerAssinatura(ctxC, { pool });
    expect(a?.status).toBe("blocked");
    medidas.blocked_after_grace += 1;
    console.info("f19-carencia: blocked_after_grace=1/1 antes_do_prazo=0/0 idempotente=0/0");
  });

  it("o pagamento que chega depois do bloqueio reativa (invoice.paid → active), e o Portal abre pela referência do cliente (portal_link=1/1)", async () => {
    // Arrange
    const pago = fixture("invoice.paid");
    pago.id = "evt_1F19Fixture000000000031";
    pago.created = T_FALHA + 9 * 86_400;
    (pago.data as { object: Record<string, unknown> }).object.subscription = SUB_C;

    // Act
    const r = await entregar(pago);
    const portal = await criarSessaoDoPortal({ base: falso.base, chave: CHAVE }, { customer_ref: "cus_f19_c", return_url: "http://app/billing" });

    // Assert
    expect(r).toMatchObject({ status: 200, code: "ok" });
    expect((await lerAssinatura(ctxC, { pool }))?.status).toBe("active");
    expect(portal.url).toContain("/portal/cus_f19_c");
    const chamada = falso.chamadas.find((c) => c.caminho === "/v1/billing_portal/sessions");
    expect(chamada?.form).toMatchObject({ customer: "cus_f19_c", return_url: "http://app/billing" });
    medidas.portal_link += 1;
    console.info("f19-portal: reativada=1/1 portal_link=1/1");
  });

  it("com gateway stripe, trocar de plano e cancelar pelas rotas da F12 respondem UsePortal (409), sem mudar nada", async () => {
    await expect(mudarPlano(ctxC, { plan_code: "PLAN_B" }, { pool })).rejects.toBeInstanceOf(UsePortal);
    await expect(cancelar(ctxC, { reason: "teste" }, { pool })).rejects.toBeInstanceOf(UsePortal);
    const a = await lerAssinatura(ctxC, { pool });
    expect(a).toMatchObject({ status: "active", plan_code: "PLAN_A" });
    console.info("f19-portal: use_portal=2/2 (plan_change, cancel)");
  });

  it("customer.subscription.deleted cancela e PRESERVA os dados: as linhas da organização continuam nas N tabelas (cancelled_preserved=N/N)", async () => {
    // Arrange — dado da organização C em tabelas de negócio, para contar antes e depois
    await pool.query(`insert into public.contacts (organization_id, name, phone_number) values ($1, 'Cliente F19', '+5511999990001')`, [ORG_C]);
    const TABELAS = ["organizations", "user_organizations", "subscriptions", "billing_events", "invoices", "notifications", "contacts"];
    const contar = async () => {
      const r: Record<string, number> = {};
      for (const t of TABELAS) r[t] = await conta(`select count(*)::text as n from public.${t} where ${t === "organizations" ? "id" : "organization_id"} = $1`, [ORG_C]);
      return r;
    };
    const antes = await contar();
    expect(Object.values(antes).every((n) => n >= 1), JSON.stringify(antes)).toBe(true);
    const evento = fixture("customer.subscription.deleted");
    evento.created = T_FALHA + 10 * 86_400;
    (evento.data as { object: Record<string, unknown> }).object.id = SUB_C;

    // Act
    const r = await entregar(evento);

    // Assert
    expect(r).toMatchObject({ status: 200, code: "ok", organization_id: ORG_C });
    const a = await lerAssinatura(ctxC, { pool });
    expect(a?.status).toBe("cancelled");
    expect(a?.cancelled_at).not.toBeNull();
    expect(a?.cancel_reason).toBe("cancelado no gateway stripe");
    const depois = await contar();
    let preservadas = 0;
    for (const t of TABELAS) if (depois[t]! >= antes[t]!) preservadas++;
    expect(preservadas).toBe(TABELAS.length);
    medidas.cancelled_preserved += preservadas;
    medidas.cancelled_preserved_total += TABELAS.length;
    console.info(`f19-cancelamento: cancelled_preserved=${preservadas}/${TABELAS.length} tabelas=${TABELAS.join(",")}`);
  });
});

describe("F19-T04 — o padrão KN do /admin e o cockpit", () => {
  const ORG_D = "f1900002-0000-4000-8000-000000000004";
  const SUB_D = "sub_f19_admin_d";
  const T0 = new Date("2026-09-19T15:00:00.000Z");

  it("as cinco ações: suspender pausa a cobrança no Stripe e bloqueia; reativar limpa e volta; estender trial escreve no Stripe e em trial_ends_at; provisionar na mão cria operator ativa; abrir no Stripe é o link do modo (admin_actions=5/5)", async () => {
    // Arrange — organização D com assinatura no Stripe (ativa)
    await pool.query(`insert into public.organizations (id, slug, legal_name, display_name, onboarded_at) values ($1,'f19-stripe-d','F19 Stripe D','F19 D', now())`, [ORG_D]);
    await pool.query(
      `insert into public.subscriptions (organization_id, plan_code, status, origin, gateway, gateway_ref, customer_ref, current_period_start, current_period_end, last_event_at)
       values ($1, 'PLAN_A', 'active', 'fixture', 'stripe', $2, 'cus_f19_d', $3, $3::timestamptz + interval '30 days', $3)`,
      [ORG_D, SUB_D, T0],
    );
    falso.definirAssinatura(SUB_D, { status: "active", customer: "cus_f19_d", trial_end: null, items: { object: "list", data: [{ price: { id: "price_1F19FixturePlanA" } }] } });
    const stripe = { base: falso.base, chave: CHAVE };
    let acoes = 0;

    // Act + Assert — 1 · suspender
    const suspensa = await suspender(ORG_D, { pool, stripe, agora: () => T0 });
    expect(suspensa.status).toBe("blocked");
    expect(falso.assinaturas.get(SUB_D)?.pause_collection).toEqual({ behavior: "void" });
    acoes++;
    // 2 · reativar
    const reativada = await reativar(ORG_D, { pool, stripe, agora: () => T0 });
    expect(reativada.status).toBe("active");
    expect(reativada.blocked_at).toBeNull();
    expect(falso.assinaturas.get(SUB_D)?.pause_collection).toBeNull();
    acoes++;
    // 3 · estender trial (14 dias); fora da faixa recusa sem chamar
    const comTrial = await estenderTrial(ORG_D, 14, { pool, stripe, agora: () => T0 });
    expect(comTrial.trial_ends_at).toBe(new Date(T0.getTime() + 14 * 86_400_000).toISOString());
    expect(falso.assinaturas.get(SUB_D)?.trial_end).toBe(Math.floor((T0.getTime() + 14 * 86_400_000) / 1000));
    await expect(estenderTrial(ORG_D, 91, { pool, stripe })).rejects.toBeInstanceOf(DiasForaDaFaixa);
    await expect(estenderTrial(ORG_D, 0, { pool, stripe })).rejects.toBeInstanceOf(DiasForaDaFaixa);
    acoes++;
    // 4 · provisionar na mão: organização SEM assinatura → operator ativa; a do Stripe recusa
    const ORG_E = "f1900002-0000-4000-8000-000000000005";
    await pool.query(`insert into public.organizations (id, slug, legal_name, display_name, onboarded_at) values ($1,'f19-stripe-e','F19 Stripe E','F19 E', now())`, [ORG_E]);
    const provisionada = await provisionarNaMao(ORG_E, "PLAN_B", { pool, stripe: null, agora: () => T0 });
    expect(provisionada).toMatchObject({ status: "active", origin: "operator", plan_code: "PLAN_B", gateway: null });
    await expect(provisionarNaMao(ORG_D, "PLAN_B", { pool, stripe })).rejects.toBeInstanceOf(TransicaoIlegal);
    acoes++;
    // 5 · abrir no Stripe
    expect(linkNoStripe(reativada, "test")).toBe(`https://dashboard.stripe.com/test/subscriptions/${SUB_D}`);
    expect(linkNoStripe(provisionada, "test")).toBeNull();
    acoes++;

    expect(acoes).toBe(5);
    medidas.admin_actions += acoes;
    console.info("f19-admin: admin_actions=5/5 pause=1/1 resume=1/1 trial=1/1 provision=1/1 link=1/1 fora_da_faixa=2/2");
  });

  it("se o Stripe recusar, nada muda no banco (primeiro o provedor, depois o banco)", async () => {
    const semChave = { base: falso.base, chave: "rk_test_errada" };
    await expect(suspender(ORG_D, { pool, stripe: semChave })).rejects.toMatchObject({ name: "StripeIndisponivel", status: 401 });
    expect((await lerAssinatura({ organization_id: ORG_D, source: "job" }, { pool }))?.status).toBe("active");
    console.info("f19-admin: provedor_recusou=1/1 banco_intacto=1/1");
  });

  it("o cockpit monta os itens {nome, ok, valor, detalhe} do banco (summary_ok=1/1)", async () => {
    const itens = await montarCockpit(pool, { gateway: "stripe", modo: "test", agora: new Date() });
    const porNome = Object.fromEntries(itens.map((i) => [i.nome, i]));
    expect(itens.map((i) => i.nome)).toEqual(["gateway", "assinaturas", "past_due", "blocked", "trials", "ultimo_webhook", "webhooks_recusados_24h", "orgs_sem_assinatura"]);
    expect(porNome.gateway).toMatchObject({ ok: true, valor: "stripe/test" });
    expect(Number(porNome.assinaturas!.valor)).toBeGreaterThanOrEqual(5);
    expect(porNome.trials).toMatchObject({ ok: true });
    expect(Number(porNome.trials!.valor)).toBeGreaterThanOrEqual(1);
    expect(porNome.ultimo_webhook!.ok).toBe(true);
    expect(itens.every((i) => typeof i.ok === "boolean" && typeof i.detalhe === "string")).toBe(true);
    const mock = await montarCockpit(pool, { gateway: "mock", modo: "test" });
    expect(mock.find((i) => i.nome === "gateway")).toMatchObject({ ok: false, valor: "mock/test" });
    medidas.summary_ok += 1;
    console.info(`f19-cockpit: summary_ok=1/1 itens=${itens.length}/8 gateway_mock_ok=false`);
  });

  it("o provisionamento cria 3 Products + 3 Prices + 1 Portal e, rodado de novo, reaproveita tudo (provision=1/1)", async () => {
    const stripe = { base: falso.base, chave: CHAVE };
    const primeira = await provisionar(stripe, { os: "crm-os", headline: "CRM OS", planos: PLANOS_PLACEHOLDER });
    const segunda = await provisionar(stripe, { os: "crm-os", headline: "CRM OS", planos: PLANOS_PLACEHOLDER, portal_configuration: primeira.portal_configuration });
    expect(primeira.criados).toBe(7);
    expect(primeira.produtos.map((p) => p.plan_code)).toEqual(["PLAN_A", "PLAN_B", "PLAN_C"]);
    expect(primeira.env.STRIPE_PRICE_IDS).toMatch(/^price_falso\d+:PLAN_A,price_falso\d+:PLAN_B,price_falso\d+:PLAN_C$/);
    expect(segunda.criados).toBe(0);
    expect(segunda.reaproveitados).toBe(7);
    expect(segunda.env).toEqual(primeira.env);
    expect([...falso.produtos.values()].filter((p) => (p.metadata as { os: string }).os === "crm-os")).toHaveLength(3);
    console.info("f19-provision: provision=1/1 criados=7/7 segunda_rodada_criados=0/0 reaproveitados=7/7");
  });

  it("grava a linha stripe: do bloco com todos os campos do contrato (ADR-043 §2)", () => {
    const linha =
      `stripe: signature_rejected=${medidas.signature_rejected}/1 livemode_mismatch=${medidas.livemode_mismatch}/1 ` +
      `price_outside_list=${medidas.price_outside_list}/1 checkout_created=${medidas.checkout_created}/1 ` +
      `activated=${medidas.activated}/1 trialing_mapped=${medidas.trialing_mapped}/1 ` +
      `duplicates=${medidas.duplicates} out_of_order=${medidas.out_of_order} ` +
      `state_from_provider=${medidas.state_from_provider}/1 past_due=${medidas.past_due}/1 ` +
      `blocked_after_grace=${medidas.blocked_after_grace}/1 ` +
      `cancelled_preserved=${medidas.cancelled_preserved}/${medidas.cancelled_preserved_total} ` +
      `portal_link=${medidas.portal_link}/1 admin_actions=${medidas.admin_actions}/5 summary_ok=${medidas.summary_ok}/1`;
    expect(linha).not.toMatch(/=0\//);
    console.info(linha);
    gravarLinhaDoVerify("stripe", linha);
  });
});
