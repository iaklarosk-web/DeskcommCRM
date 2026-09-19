/**
 * F19 — cobrança real por Stripe, no navegador (ADR-042 §8 T05; ADR-043 §1):
 * duas jornadas × dois tenants (A e B) + duas do webhook e do cockpit + uma
 * do painel do dono = SETE testes. O gateway sob teste é o `stripe` apontado
 * ao Stripe FALSO da bancada (segundo webServer do Playwright): o Checkout é
 * outro site, "Pagar" entrega os webhooks assinados, e quem ativa é o webhook
 * (D38) — a tela só mostra o que o banco diz.
 *
 *  1. contratar pelo Stripe — cancela a assinatura da fixture, contrata
 *     PLAN_A, paga no falso; a assinatura ativa com gateway `stripe`, a tela
 *     mostra o trial de 7 dias (D57 c) e "Gerenciar assinatura"; as ações da
 *     F12 saem (cancelar/trocar respondem 409 `use_portal`, D57 b); o Portal
 *     abre pela referência do cliente;
 *  2. o retorno sem pagar — "Falhar o pagamento" volta com `?checkout=
 *     cancelado`; a assinatura continua `pending_payment` e a escrita 402;
 *  3. o webhook recusa — sem assinatura 401, evento live em modo test 422,
 *     nenhuma linha gravada;
 *  4. o cockpit — `GET /api/admin/summary` sem token 401, com token 200 e os
 *     oito itens {nome, ok, valor, detalhe};
 *  +  dono — em /admin/billing, Suspender → blocked, Reativar → active,
 *     Estender trial → a data aparece; a auditoria tem as três ações.
 */
import { createHmac } from "node:crypto";

import { test as base, expect, type Page } from "@playwright/test";

import { pagarNoCheckout } from "./utils/checkout";
import { f02E2eSandbox } from "./utils/f02-crm-cadastros";
import { cleanupF11F12, seedF11F12, type F11F12Fixture, type LadoDoTeste } from "./utils/f11-f12-fixture";

const HTTP_TIMEOUT = 30_000;
const TELA = "/app/billing";

const test = base.extend<{ fixture: F11F12Fixture }>({
  fixture: async ({}, runTest, info) => {
    const fixture = await seedF11F12();
    try {
      await runTest(fixture);
    } finally {
      const limpeza = await cleanupF11F12(fixture);
      await info.attach("sandbox-cleanup", { body: JSON.stringify(limpeza), contentType: "application/json" });
      expect(limpeza.domain_rows_remaining).toBe(0);
    }
  },
});
test.describe.configure({ timeout: 300_000 });

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/app/**", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });
}

async function orgAtiva(page: Page): Promise<string> {
  const r = await page.request.get("/api/v1/auth/interface", { timeout: HTTP_TIMEOUT });
  expect(r.status()).toBe(200);
  return (await r.json()).data.organization_id as string;
}

async function trocarPara(page: Page, orgId: string): Promise<void> {
  if ((await orgAtiva(page)) === orgId) return;
  await page.getByTestId("tenant-switcher").click();
  await Promise.all([
    page.waitForEvent("framenavigated", {
      predicate: (frame) => frame === page.mainFrame() && new URL(frame.url()).pathname.startsWith("/app"),
      timeout: HTTP_TIMEOUT,
    }),
    page.getByTestId(`tenant-switcher-item-${orgId}`).click(),
  ]);
  await page.waitForLoadState("domcontentloaded");
  await expect.poll(() => orgAtiva(page), { timeout: HTTP_TIMEOUT }).toBe(orgId);
}

async function assinaturaNoBanco(orgId: string) {
  const r = await f02E2eSandbox()
    .from("subscriptions" as never)
    .select("status, plan_code, origin, gateway, gateway_ref, customer_ref, trial_ends_at")
    .eq("organization_id", orgId)
    .single();
  if (r.error) throw r.error;
  return r.data as unknown as { status: string; plan_code: string; origin: string; gateway: string | null; gateway_ref: string | null; customer_ref: string | null; trial_ends_at: string | null };
}

/** Cancela pela UI da F12 (a fixture não tem gateway) e deixa a organização pronta para contratar. */
async function cancelarPelaTela(page: Page, orgId: string): Promise<void> {
  await page.goto(TELA, { waitUntil: "domcontentloaded" });
  await page.getByTestId("billing-cancelar").click();
  await page.getByTestId("billing-cancelar-motivo").fill("prova F19: contratar de novo pelo Stripe");
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/billing/subscription/cancel", { timeout: HTTP_TIMEOUT }),
    page.getByTestId("billing-cancelar-confirmar").click(),
  ]);
  await expect.poll(async () => (await assinaturaNoBanco(orgId)).status, { timeout: HTTP_TIMEOUT }).toBe("cancelled");
  await page.goto(TELA, { waitUntil: "domcontentloaded" });
}

for (const lado of ["A", "B"] as LadoDoTeste[]) {
  test(`contratar pelo Stripe em ${lado}: paga no falso, ativa pelo webhook com trial de 7 dias, o Portal substitui as ações da F12`, async ({ page, fixture }) => {
    // Arrange
    await login(page, fixture.admin.email, fixture.password);
    await trocarPara(page, fixture.orgs[lado]);
    await cancelarPelaTela(page, fixture.orgs[lado]);

    // Act — Contratar PLAN_A → Checkout do falso → Pagar
    const gateway = await pagarNoCheckout(page, "PLAN_A");

    // Assert — quem ativou foi o webhook; o banco diz stripe/active/trial
    expect(gateway).toBe("stripe");
    await expect.poll(async () => (await assinaturaNoBanco(fixture.orgs[lado])).status, { timeout: HTTP_TIMEOUT }).toBe("active");
    const noBanco = await assinaturaNoBanco(fixture.orgs[lado]);
    expect(noBanco.gateway).toBe("stripe");
    expect(noBanco.gateway_ref).toMatch(/^sub_/);
    expect(noBanco.customer_ref).toMatch(/^cus_/);
    expect(noBanco.trial_ends_at).not.toBeNull();
    const diasDeTrial = (new Date(noBanco.trial_ends_at!).getTime() - Date.now()) / 86_400_000;
    expect(diasDeTrial).toBeGreaterThan(6.5);
    expect(diasDeTrial).toBeLessThanOrEqual(7.01);

    await page.goto(TELA, { waitUntil: "domcontentloaded" });
    expect(await page.getByTestId("billing-status").getAttribute("data-status")).toBe("active");
    expect(await page.getByTestId("billing-gateway").getAttribute("data-gateway")).toBe("stripe");
    await expect(page.getByTestId("billing-trial-ate")).toBeVisible();
    await expect(page.getByTestId("billing-portal")).toBeVisible();
    await expect(page.getByTestId("billing-cancelar")).toHaveCount(0);
    await expect(page.getByTestId("billing-mudar-plano-PLAN_B")).toHaveCount(0);

    // As rotas da F12 respondem 409 use_portal; o Portal abre pela customer_ref.
    const cancelar = await page.request.post("/api/v1/billing/subscription/cancel", { data: { reason: "tentativa fora do portal" }, timeout: HTTP_TIMEOUT });
    const trocar = await page.request.post("/api/v1/billing/subscription/plan", { data: { plan_code: "PLAN_B" }, timeout: HTTP_TIMEOUT });
    const portal = await page.request.post("/api/v1/billing/portal", { data: {}, timeout: HTTP_TIMEOUT });
    expect(cancelar.status()).toBe(409);
    expect((await cancelar.json()).error.code).toBe("use_portal");
    expect(trocar.status()).toBe(409);
    expect((await trocar.json()).error.code).toBe("use_portal");
    expect(portal.status()).toBe(200);
    expect((await portal.json()).data.url).toContain(`/portal/${noBanco.customer_ref}`);
    expect((await assinaturaNoBanco(fixture.orgs[lado])).status).toBe("active");
    // Uma ativação só, apesar dos dois eventos do provedor.
    const ativacoes = await f02E2eSandbox().from("notifications" as never).select("id").eq("organization_id", fixture.orgs[lado]).eq("event", "subscription.activated");
    if (ativacoes.error) throw ativacoes.error;
    expect((ativacoes.data as unknown[]).length).toBe(1);
  });

  test(`o retorno sem pagar em ${lado}: "Falhar o pagamento" volta com checkout=cancelado, a assinatura segue pending_payment e a escrita 402`, async ({ page, fixture }) => {
    // Arrange
    await login(page, fixture.admin.email, fixture.password);
    await trocarPara(page, fixture.orgs[lado]);
    await cancelarPelaTela(page, fixture.orgs[lado]);

    // Act
    const gateway = await pagarNoCheckout(page, "PLAN_A", "failed");

    // Assert
    expect(gateway).toBe("stripe");
    expect(new URL(page.url()).searchParams.get("checkout")).toBe("cancelado");
    await expect(page.getByTestId("billing-checkout-cancelado")).toBeVisible();
    await expect(page.getByTestId("billing-aguardando-confirmacao")).toHaveCount(0);
    expect(await page.getByTestId("billing-status").getAttribute("data-status")).toBe("pending_payment");
    expect((await assinaturaNoBanco(fixture.orgs[lado])).status).toBe("pending_payment");
    const escrita = await page.request.post("/api/v1/contacts", { data: { name: "ninguém" }, timeout: HTTP_TIMEOUT });
    expect(escrita.status()).toBe(402);
    expect((await escrita.json()).error.code).toBe("subscription_required");
  });
}

test("o webhook do Stripe recusa: sem assinatura 401, evento live em modo test 422 — nenhuma linha gravada", async ({ page }) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  expect(secret.length, "STRIPE_WEBHOOK_SECRET do .env.e2e").toBeGreaterThan(0);
  const antes = await f02E2eSandbox().from("billing_events" as never).select("id").eq("gateway", "stripe");
  if (antes.error) throw antes.error;

  const semAssinatura = await page.request.post("/api/v1/webhooks/stripe", { data: { id: "evt_x" }, timeout: HTTP_TIMEOUT });
  expect(semAssinatura.status()).toBe(401);

  const evento = JSON.stringify({ id: "evt_f19e2elive000000000001", object: "event", type: "invoice.paid", created: Math.floor(Date.now() / 1000), livemode: true, data: { object: { id: "in_x", object: "invoice", subscription: "sub_ninguem" } } });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${evento}`, "utf8").digest("hex");
  const live = await page.request.post("/api/v1/webhooks/stripe", { headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${v1}` }, data: evento, timeout: HTTP_TIMEOUT });
  expect(live.status()).toBe(422);
  expect((await live.json()).error.message).toContain("outro modo");

  const depois = await f02E2eSandbox().from("billing_events" as never).select("id").eq("gateway", "stripe");
  if (depois.error) throw depois.error;
  expect((depois.data as unknown[]).length).toBe((antes.data as unknown[]).length);
});

test("o cockpit: GET /api/admin/summary sem token é 401; com ADMIN_SUMMARY_TOKEN responde os oito itens", async ({ page }) => {
  const token = process.env.ADMIN_SUMMARY_TOKEN ?? "";
  expect(token.length, "ADMIN_SUMMARY_TOKEN do .env.e2e").toBeGreaterThan(0);
  const semToken = await page.request.get("/api/admin/summary", { timeout: HTTP_TIMEOUT });
  const errado = await page.request.get("/api/admin/summary", { headers: { authorization: "Bearer nao-e-o-token" }, timeout: HTTP_TIMEOUT });
  const certo = await page.request.get("/api/admin/summary", { headers: { authorization: `Bearer ${token}` }, timeout: HTTP_TIMEOUT });
  expect(semToken.status()).toBe(401);
  expect(errado.status()).toBe(401);
  expect(certo.status()).toBe(200);
  const itens = (await certo.json()).data.items as Array<{ nome: string; ok: boolean; valor: unknown; detalhe: string }>;
  expect(itens.map((i) => i.nome)).toEqual(["gateway", "assinaturas", "past_due", "blocked", "trials", "ultimo_webhook", "webhooks_recusados_24h", "orgs_sem_assinatura"]);
  expect(itens.find((i) => i.nome === "gateway")).toMatchObject({ ok: true, valor: "stripe/test" });
  expect(itens.every((i) => typeof i.ok === "boolean" && typeof i.detalhe === "string")).toBe(true);
});

test("o dono em /admin/billing: Suspender → blocked, Reativar → active, Estender trial → a data aparece; a auditoria registra as três", async ({ page, fixture }) => {
  // Arrange
  await login(page, fixture.dono.email, fixture.password);
  await page.goto("/admin/billing", { waitUntil: "domcontentloaded" });
  const org = fixture.orgs.A;
  const linha = page.locator(`[data-testid="admin-billing-assinatura"][data-org="${org}"]`);
  await expect(linha).toBeVisible({ timeout: HTTP_TIMEOUT });
  expect(await linha.getAttribute("data-status")).toBe("active");
  const acoes = page.locator(`[data-testid="admin-billing-acoes"][data-org="${org}"]`);

  // Act + Assert — 1 · suspender
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/v1/admin/billing/${org}`, { timeout: HTTP_TIMEOUT }),
    acoes.getByTestId("admin-billing-suspender").click(),
  ]);
  await expect.poll(async () => (await assinaturaNoBanco(org)).status, { timeout: HTTP_TIMEOUT }).toBe("blocked");
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await linha.getAttribute("data-status")).toBe("blocked");
  // 2 · reativar
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/v1/admin/billing/${org}`, { timeout: HTTP_TIMEOUT }),
    acoes.getByTestId("admin-billing-reativar").click(),
  ]);
  await expect.poll(async () => (await assinaturaNoBanco(org)).status, { timeout: HTTP_TIMEOUT }).toBe("active");
  // 3 · estender trial (14 dias)
  await page.reload({ waitUntil: "domcontentloaded" });
  await acoes.getByTestId("admin-billing-trial-dias").fill("14");
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/v1/admin/billing/${org}`, { timeout: HTTP_TIMEOUT }),
    acoes.getByTestId("admin-billing-estender-trial").click(),
  ]);
  await expect.poll(async () => (await assinaturaNoBanco(org)).trial_ends_at, { timeout: HTTP_TIMEOUT }).not.toBeNull();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(`[data-testid="admin-billing-gateway"]`).filter({ hasText: "trial" }).first()).toBeVisible();
  // Fora da faixa: 422, nada muda
  const foraDaFaixa = await page.request.post(`/api/v1/admin/billing/${org}`, { data: { action: "extend_trial", days: 91 }, timeout: HTTP_TIMEOUT });
  expect(foraDaFaixa.status()).toBe(422);

  // A auditoria: as três ações desta organização
  const audit = await f02E2eSandbox().from("api_audit_log" as never).select("action").eq("organization_id", org).like("action", "billing.admin.%");
  if (audit.error) throw audit.error;
  const acoesAuditadas = (audit.data as unknown as Array<{ action: string }>).map((a) => a.action).sort();
  expect(acoesAuditadas).toEqual(["billing.admin.resumed", "billing.admin.suspended", "billing.admin.trial_extended"]);
});
