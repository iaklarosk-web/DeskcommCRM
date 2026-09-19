/**
 * A PROVA REAL da F19 (ADR-042 §7; D57 e) — o Stripe DE VERDADE, em modo
 * TEST, contra o STAGING desta VPS, FORA do bloco do verify (que força o
 * falso). Produz a linha `stripe_real:` do BUILD-STATE. Gasto: US$ 0 (modo
 * test não cobra ninguém).
 *
 * Pré-condições (todas do proprietário/operador, nunca deste script):
 *   - `STRIPE_SECRET_KEY` (chave restrita rk_test_… do CRM-OS) no ambiente;
 *   - `pnpm stripe:provision` já rodado → `STRIPE_PRICE_IDS` no ambiente;
 *   - `stripe listen --api-key … --forward-to http://127.0.0.1:3200/api/v1/webhooks/stripe`
 *     de pé, e o `whsec_…` que ele imprimiu gravado em `/srv/secrets/crm-staging.env`
 *     junto com `BILLING_GATEWAY=stripe`, `STRIPE_SECRET_KEY` e `STRIPE_PRICE_IDS`,
 *     com o app do staging reiniciado (é o app em 3200 que RECEBE o webhook);
 *   - `SUPABASE_DB_URL` do staging (56422) no ambiente deste processo.
 *
 * O que ela faz, e desfaz:
 *   1. cria uma organização DESCARTÁVEL no staging com assinatura pending_payment;
 *   2. cria a sessão de Checkout no Stripe (client_reference_id = a organização);
 *   3. um navegador (Playwright) paga no Checkout com o cartão de teste 4242;
 *   4. espera o WEBHOOK (via `stripe listen`) ativar a assinatura no banco:
 *      active, gateway stripe, trial_ends_at, customer_ref;
 *   5. abre uma sessão do Customer Portal (real);
 *   6. cancela a subscription no Stripe e espera o webhook cancelar no banco;
 *   7. apaga a organização (cascata) e o cliente no Stripe; conta o que sobrou.
 *
 *   SUPABASE_DB_URL=… STRIPE_SECRET_KEY=… STRIPE_PRICE_IDS=… tsx scripts/staging/jornada-stripe.ts
 *
 * Nunca imprime chave: só nome e tamanho.
 */
import { randomUUID } from "node:crypto";

import { chromium } from "@playwright/test";
import pg from "pg";

import { buscarAssinatura, criarSessaoDeCheckout, criarSessaoDoPortal, lerListaDePrecos, precoDoPlano } from "@/src/billing/gateway/stripe";

const CHAVE = process.env.STRIPE_SECRET_KEY ?? "";
const BASE = process.env.STRIPE_API_BASE ?? "https://api.stripe.com";
const PRECOS = lerListaDePrecos(process.env.STRIPE_PRICE_IDS ?? "");
const DB_URL = process.env.SUPABASE_DB_URL ?? "";
const APP_URL = (process.env.JORNADA_APP_URL ?? "http://127.0.0.1:3200").replace(/\/$/, "");
const ESPERA_MS = Number(process.env.JORNADA_ESPERA_MS ?? 90_000);

function falhar(msg: string): never {
  console.error(`jornada-stripe: ${msg}`);
  process.exit(1);
}

async function esperar<T>(rotulo: string, fn: () => Promise<T | null>, ms: number): Promise<T> {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const v = await fn();
    if (v !== null) return v;
    await new Promise((r) => setTimeout(r, 2000));
  }
  falhar(`esperei ${ms} ms por ${rotulo} e não veio`);
}

async function stripe(metodo: "GET" | "POST" | "DELETE", caminho: string, form?: Record<string, string>): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${CHAVE}`, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const j = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(`Stripe ${metodo} ${caminho}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

async function main(): Promise<void> {
  if (CHAVE.length === 0) falhar("STRIPE_SECRET_KEY vazia (lib/env.ts:283)");
  if (!CHAVE.startsWith("rk_test_") && !CHAVE.startsWith("sk_test_")) falhar("a chave não é de TESTE — esta prova só roda em modo test (D57 e)");
  if (DB_URL.length === 0) falhar("SUPABASE_DB_URL vazia");
  const price = precoDoPlano(PRECOS, "PLAN_A");
  if (price === null) falhar("STRIPE_PRICE_IDS sem PLAN_A — rode pnpm stripe:provision");
  console.info(`jornada-stripe: modo=test chave=STRIPE_SECRET_KEY(${CHAVE.length} chars) price=${price} app=${APP_URL}`);

  const pool = new pg.Pool({ connectionString: DB_URL, max: 2 });
  const medidas: Record<string, string | number> = {};
  const inicio = new Date();
  const ORG = randomUUID();
  const sufixo = ORG.slice(0, 8);
  let customer: string | null = null;
  let subscription: string | null = null;
  try {
    // 1 · organização descartável, pendente de pagamento
    await pool.query(`insert into public.organizations (id, slug, legal_name, display_name, onboarded_at) values ($1, $2, $3, $3, now())`, [ORG, `f19-real-${sufixo}`, `F19 prova real ${sufixo}`]);
    await pool.query(`insert into public.subscriptions (organization_id, plan_code, status, origin) values ($1, 'PLAN_A', 'pending_payment', 'fixture')`, [ORG]);
    medidas.org_created = "1/1";

    // 2 · Checkout real
    const sessao = await criarSessaoDeCheckout(
      { base: BASE, chave: CHAVE },
      { organization_id: ORG, price_id: price, trial_days: Number(process.env.BILLING_TRIAL_DAYS ?? 7), success_url: `${APP_URL}/api/v1/billing/retorno?checkout=ok`, cancel_url: `${APP_URL}/api/v1/billing/retorno?checkout=cancelado`, customer_email: `f19-real-${sufixo}@example.test` },
    );
    medidas.checkout_created = "1/1";
    console.info(`jornada-stripe: checkout ${sessao.id} criado`);

    // 3 · paga no Checkout com o cartão de teste (o navegador, como a pessoa faria)
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(sessao.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForSelector("#cardNumber, [name=cardNumber]", { timeout: 60_000 });
      const preencher = async (seletor: string, valor: string) => {
        const el = page.locator(seletor).first();
        if ((await el.count()) > 0) await el.fill(valor);
      };
      await preencher("#email", `f19-real-${sufixo}@example.test`);
      await preencher("#cardNumber", "4242 4242 4242 4242");
      await preencher("#cardExpiry", "12 / 34");
      await preencher("#cardCvc", "123");
      await preencher("#billingName", "Prova F19");
      await preencher("#billingPostalCode", "13000000");
      const pais = page.locator("#billingCountry");
      if ((await pais.count()) > 0) await pais.selectOption("BR").catch(() => undefined);
      const enviar = page.locator("button[type=submit], .SubmitButton").first();
      await enviar.click();
      await page.waitForURL((u) => /billing\/retorno|\/app\/billing/.test(u.pathname) && /checkout=ok/.test(u.href), { timeout: 90_000 }).catch(async () => {
        await page.screenshot({ path: ".verify-logs/jornada-stripe-checkout.png" }).catch(() => undefined);
        throw new Error("o Checkout não redirecionou ao success_url (screenshot em .verify-logs/jornada-stripe-checkout.png)");
      });
      medidas.paid_by_browser = "1/1";
    } finally {
      await browser.close();
    }

    // 4 · o webhook (via stripe listen → app 3200) ativa no banco
    const ativa = await esperar(
      "a ativação pelo webhook",
      async () => {
        const { rows } = await pool.query<{ status: string; gateway: string | null; gateway_ref: string | null; customer_ref: string | null; trial_ends_at: Date | null }>(
          `select status, gateway, gateway_ref, customer_ref, trial_ends_at from public.subscriptions where organization_id = $1`,
          [ORG],
        );
        const s = rows[0];
        return s && s.status === "active" && s.gateway === "stripe" ? s : null;
      },
      ESPERA_MS,
    );
    subscription = ativa.gateway_ref;
    customer = ativa.customer_ref;
    medidas.activated = "1/1";
    medidas.trialing = ativa.trial_ends_at ? "1/1" : "0/1";
    const noProvedor = await buscarAssinatura({ base: BASE, chave: CHAVE }, subscription!);
    medidas.provider_status = noProvedor.status;
    const eventos = await pool.query<{ n: string }>(`select count(*)::text as n from public.billing_events where organization_id = $1 and gateway = 'stripe'`, [ORG]);
    medidas.events_received = Number(eventos.rows[0]?.n ?? 0);

    // 5 · Portal real
    const portal = await criarSessaoDoPortal({ base: BASE, chave: CHAVE }, { customer_ref: customer!, return_url: `${APP_URL}/app/billing`, configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID || undefined });
    medidas.portal = portal.url.startsWith("https://billing.stripe.com/") ? "1/1" : "0/1";

    // 6 · cancela no provedor; o webhook cancela no banco
    await stripe("DELETE", `/v1/subscriptions/${encodeURIComponent(subscription!)}`);
    await esperar(
      "o cancelamento pelo webhook",
      async () => {
        const { rows } = await pool.query<{ status: string }>(`select status from public.subscriptions where organization_id = $1`, [ORG]);
        return rows[0]?.status === "cancelled" ? rows[0] : null;
      },
      ESPERA_MS,
    );
    medidas.cancelled_by_provider = "1/1";
  } finally {
    // 7 · devolver tudo: a organização (cascata) e o cliente no Stripe
    const apagada = await pool.query(`delete from public.organizations where id = $1`, [ORG]);
    medidas.org_removed = `${apagada.rowCount ?? 0}/1`;
    const sobras = await pool.query<{ n: string }>(`select count(*)::text as n from public.subscriptions where organization_id = $1`, [ORG]);
    medidas.rows_left = Number(sobras.rows[0]?.n ?? 0);
    if (customer) {
      try {
        await stripe("DELETE", `/v1/customers/${encodeURIComponent(customer)}`);
        medidas.stripe_customer_deleted = "1/1";
      } catch {
        medidas.stripe_customer_deleted = "0/1";
      }
    }
    await pool.end();
  }
  const linha = `stripe_real: org_created=${medidas.org_created} checkout_created=${medidas.checkout_created} paid_by_browser=${medidas.paid_by_browser} activated=${medidas.activated} trialing=${medidas.trialing} provider_status=${medidas.provider_status} events_received=${medidas.events_received} portal=${medidas.portal} cancelled_by_provider=${medidas.cancelled_by_provider} org_removed=${medidas.org_removed} rows_left=${medidas.rows_left} stripe_customer_deleted=${medidas.stripe_customer_deleted} mode=test cost_cents=0 duration_s=${Math.round((Date.now() - inicio.getTime()) / 1000)} at=${new Date().toISOString()}`;
  console.info(linha);
}

main().catch((erro: unknown) => {
  console.error("jornada-stripe falhou:", erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro));
  process.exit(1);
});
