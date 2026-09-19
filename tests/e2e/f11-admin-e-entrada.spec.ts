/**
 * F11-T06 — a ADMINISTRAÇÃO da plataforma e a ENTRADA guiada pela tela
 * (ADR-030 §1; D38, D39, D51). Duas jornadas × dois tenants + duas jornadas
 * únicas = SEIS testes — o inventário que `scripts/verify/f02-e2e.mjs` cobra
 * (`EXPECTED_F11_E2E_TESTS`, ADR-031).
 *
 * ═══ O que cada jornada CONFERE ═════════════════════════════════════════════
 *
 * 1. Por tenant — o DONO vê a empresa em `/admin/tenants` com o estado da
 *    assinatura que o banco tem (tela contra banco) e `/admin/billing` lista a
 *    assinatura dela.
 *
 * 2. Por tenant — o dono abre um ACOMPANHAMENTO com motivo, escopo `inbox` e
 *    30 minutos: o banner mostra os três; escrita responde 403 (só leitura);
 *    rota fora do escopo responde 403 `support_scope`; ao sair, a linha em
 *    `platform_support_sessions` tem `reason`, `scope` e `ended_at`.
 *
 * 3. Única — o CADASTRO: quem entra sem organização a cria em `/get-started`
 *    (o caminho real de provisionamento, `ensureTenantForUser`) e nasce
 *    `pending_payment`; `/onboarding` e `/app/inbox` caem em `/app/billing`;
 *    `POST` de negócio responde 402 (D38: nenhum acesso operacional antes do
 *    pagamento).
 *
 * 4. Única — o WIZARD depois do pagamento mock: `welcome` → telefone pelo
 *    canal de TESTE (`WHATSAPP_MODE=mock`) → treinar (pular) → quadro (pular)
 *    → ver ele atender (pular) → equipe (pular) → `onboarded_at` gravado e o
 *    produto abre. Só pela UI, sem SQL.
 */
import { test as base, expect, type Page } from "@playwright/test";

import { pagarNoCheckout } from "./utils/checkout";
import { f02E2eSandbox } from "./utils/f02-crm-cadastros";
import { cleanupF11F12, seedF11F12, type F11F12Fixture, type LadoDoTeste } from "./utils/f11-f12-fixture";

const HTTP_TIMEOUT = 30_000;

const test = base.extend<{ fixture: F11F12Fixture }>({
  fixture: async ({}, runTest, info) => {
    const fixture = await seedF11F12();
    try {
      await runTest(fixture);
    } finally {
      const limpeza = await cleanupF11F12(fixture);
      await info.attach("sandbox-cleanup", { body: JSON.stringify(limpeza), contentType: "application/json" });
      expect(limpeza).toEqual({ deleted_organizations: 3, deleted_users: 2, domain_tables_checked: 6, domain_rows_remaining: 0 });
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

async function assinaturaNoBanco(orgId: string) {
  const r = await f02E2eSandbox().from("subscriptions" as never).select("status, plan_code, origin").eq("organization_id", orgId).single();
  if (r.error) throw r.error;
  return r.data as unknown as { status: string; plan_code: string; origin: string };
}

for (const lado of ["A", "B"] as LadoDoTeste[]) {
  test(`o dono vê a empresa ${lado} em /admin/tenants com o estado da assinatura do banco, e em /admin/billing`, async ({ page, fixture }) => {
    // Arrange
    await login(page, fixture.dono.email, fixture.password);
    const noBanco = await assinaturaNoBanco(fixture.orgs[lado]);

    // Act
    await page.goto(`/admin/tenants?q=${encodeURIComponent(fixture.suffix)}`, { waitUntil: "domcontentloaded" });
    const celula = page.locator(`[data-testid="admin-tenant-assinatura"][data-org="${fixture.orgs[lado]}"]`);
    await expect(celula).toBeVisible({ timeout: HTTP_TIMEOUT });

    // Assert — tela contra banco.
    expect(await celula.getAttribute("data-status")).toBe(noBanco.status);
    await expect(celula).toContainText(noBanco.plan_code);
    await page.goto("/admin/billing", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("admin-billing")).toBeVisible();
    const linha = page.locator(`[data-testid="admin-billing-assinatura"][data-org="${fixture.orgs[lado]}"]`);
    await expect(linha).toBeVisible();
    expect(await linha.getAttribute("data-status")).toBe(noBanco.status);
    expect(Number(await page.getByTestId("admin-billing-mismatch").textContent())).toBe(0);
  });

  test(`acompanhamento só leitura com motivo, escopo e vencimento em ${lado}: banner, escrita 403, fora do escopo 403, linha auditada`, async ({ page, fixture }) => {
    // Arrange
    await login(page, fixture.dono.email, fixture.password);
    await page.goto(`/admin/tenants/${fixture.orgs[lado]}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Acompanhar/ }).click();
    const motivo = `Conferir a caixa de entrada de ${lado} a pedido do cliente`;
    await page.getByTestId("suporte-motivo").fill(motivo);
    await page.getByTestId("suporte-escopo").selectOption("inbox");
    await page.getByTestId("suporte-minutos").fill("30");

    // Act — iniciar. O app navega assim que recebe a resposta; o corpo é
    // capturado pela rota interceptada ANTES de o navegador descartá-lo
    // (mesma mecânica de f02-support-readonly-api).
    const endpoint = `/api/v1/admin/tenants/${fixture.orgs[lado]}/impersonate`;
    let corpo: { support_session_id: string; access_mode: string; reason: string; scope: string; expires_at: string } | undefined;
    let statusDaResposta = 0;
    await page.route(`**${endpoint}`, async (route) => {
      const r = await route.fetch();
      statusDaResposta = r.status();
      if (r.status() === 200) corpo = (await r.json()).data;
      await route.fulfill({ response: r });
    }, { times: 1 });
    const pendente = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === endpoint, { timeout: HTTP_TIMEOUT });
    await page.getByRole("button", { name: "Confirmar e entrar" }).click();
    await pendente;
    expect(statusDaResposta).toBe(200);
    if (!corpo) throw new Error("resposta do impersonate não capturada");
    expect(corpo).toMatchObject({ access_mode: "support_readonly", reason: motivo, scope: "inbox" });
    expect(new Date(corpo.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000 + 5_000);
    await page.waitForURL("**/app/inbox", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });

    // Assert — banner com os três campos; escrita e escopo negados.
    const banner = page.getByTestId("suporte-banner");
    await expect(banner).toBeVisible();
    await expect(page.getByTestId("suporte-banner-motivo")).toHaveText(motivo);
    await expect(page.getByTestId("suporte-banner-escopo")).toHaveText("inbox");
    expect(await banner.getAttribute("data-expires-at")).toBe(corpo.expires_at);
    const escrita = await page.request.post("/api/v1/inbox/conversations", { data: {}, timeout: HTTP_TIMEOUT });
    expect([403, 404, 405]).toContain(escrita.status());
    const foraDoEscopo = await page.request.get("/api/v1/team", { timeout: HTTP_TIMEOUT });
    expect(foraDoEscopo.status()).toBe(403);
    expect((await foraDoEscopo.json()).error.code).toBe("support_scope");
    const contatos = await page.request.post("/api/v1/contacts", { data: { display_name: "x" }, timeout: HTTP_TIMEOUT });
    expect(contatos.status()).toBe(403);

    // Act 2 — sair.
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/admin/impersonate/end", { timeout: HTTP_TIMEOUT }),
      page.getByRole("button", { name: "Sair do acompanhamento" }).click(),
    ]);
    await page.waitForURL("**/app/**", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });

    // Assert 2 — a linha tem motivo, escopo, modo e fim.
    const sessao = await f02E2eSandbox()
      .from("platform_support_sessions")
      .select("organization_id, access_mode, reason, scope, ended_at")
      .eq("id", corpo.support_session_id)
      .single();
    if (sessao.error) throw sessao.error;
    expect(sessao.data).toMatchObject({ organization_id: fixture.orgs[lado], access_mode: "support_readonly", reason: motivo, scope: "inbox" });
    expect(sessao.data.ended_at).toBeTruthy();
  });
}

test("o cadastro nasce pending_payment: /onboarding e /app caem em /app/billing e a escrita responde 402 (D38)", async ({ page, fixture }) => {
  // Arrange — um usuário confirmado SEM organização (o que o /signup produz
  // antes do provisionamento); a criação da organização é o caminho real.
  const db = f02E2eSandbox();
  const email = `f11-novo-${fixture.suffix}@example.test`;
  const novo = await db.auth.admin.createUser({ email, password: fixture.password, email_confirm: true, user_metadata: { full_name: "Novo", org_name: `Nova Empresa ${fixture.suffix}` } });
  if (novo.error || !novo.data.user) throw novo.error ?? new Error("usuário novo não criado");
  const orgsCriadas: string[] = [];
  try {
    // Quem entra sem organização cai no estado vazio do produto; a tela que
    // CRIA a organização é `/get-started` (ver `app/get-started/page.tsx`).
    await login(page, email, fixture.password);
    await page.goto("/get-started", { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel(/Nome da empresa/i)).toBeVisible();

    // Act — provisionar pela tela.
    await page.getByRole("button", { name: /Continuar para o onboarding/i }).click();
    await page.waitForURL("**/app/billing", { timeout: 40_000, waitUntil: "domcontentloaded" });
    const vinculo = await db.from("user_organizations").select("organization_id").eq("user_id", novo.data.user.id).maybeSingle();
    if (vinculo.error || !vinculo.data) throw vinculo.error ?? new Error("organização do cadastro não provisionada");
    const orgId = vinculo.data.organization_id as string;
    orgsCriadas.push(orgId);

    // Assert — pendente de pagamento, origem self_service, tudo fechado exceto a cobrança.
    expect(await assinaturaNoBanco(orgId)).toMatchObject({ status: "pending_payment", origin: "self_service", plan_code: "PLAN_A" });
    expect(await page.getByTestId("billing-status").getAttribute("data-status")).toBe("pending_payment");
    expect(await page.getByTestId("billing-acesso").getAttribute("data-mode")).toBe("billing_only");
    await page.goto("/onboarding", { waitUntil: "domcontentloaded" });
    await page.waitForURL("**/app/billing", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });
    await page.goto("/app/inbox", { waitUntil: "domcontentloaded" });
    await page.waitForURL("**/app/billing", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });
    const escrita = await page.request.post("/api/v1/contacts", { data: { display_name: "x" }, timeout: HTTP_TIMEOUT });
    expect(escrita.status()).toBe(402);
    expect((await escrita.json()).error.code).toBe("subscription_required");
  } finally {
    for (const id of orgsCriadas) await db.from("organizations").delete().eq("id", id);
    await db.auth.admin.deleteUser(novo.data.user.id);
  }
});

test("depois do pagamento mock o wizard conclui só pela UI: telefone de teste, demais passos pulados, onboarded_at gravado", async ({ page, fixture }) => {
  const db = f02E2eSandbox();
  const email = `f11-wizard-${fixture.suffix}@example.test`;
  const novo = await db.auth.admin.createUser({ email, password: fixture.password, email_confirm: true, user_metadata: { full_name: "Wizard", org_name: `Wizard ${fixture.suffix}` } });
  if (novo.error || !novo.data.user) throw novo.error ?? new Error("usuário do wizard não criado");
  const orgsCriadas: string[] = [];
  try {
    // Arrange — cadastro → cobrança → pagamento mock.
    await login(page, email, fixture.password);
    await page.goto("/get-started", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Continuar para o onboarding/i }).click();
    await page.waitForURL("**/app/billing", { timeout: 40_000, waitUntil: "domcontentloaded" });
    const vinculo = await db.from("user_organizations").select("organization_id").eq("user_id", novo.data.user.id).maybeSingle();
    if (vinculo.error || !vinculo.data) throw vinculo.error ?? new Error("organização do wizard não provisionada");
    const orgId = vinculo.data.organization_id as string;
    orgsCriadas.push(orgId);
    // Paga no checkout do GATEWAY CONFIGURADO (mock ou o Stripe falso — F19,
    // ADR-042 §4). "Sem cartão no Checkout = sem acesso": quem ativa é o webhook.
    await pagarNoCheckout(page, "PLAN_A");
    await expect.poll(async () => (await assinaturaNoBanco(orgId)).status, { timeout: HTTP_TIMEOUT }).toBe("active");

    // Act — o wizard, passo a passo, pela UI.
    let passos = 0;
    await page.goto("/app/inbox", { waitUntil: "domcontentloaded" });
    await page.waitForURL("**/onboarding/welcome", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });
    // 1. welcome: nome do negócio, o que faz, aceite dos termos, seguir.
    await page.locator("#display_name").fill(`Wizard ${fixture.suffix}`);
    await page.locator("#o_que_faz").fill("Padaria de bairro que vende pelo WhatsApp");
    await page.locator('input[type="checkbox"]').first().check();
    await page.locator("form button[type=submit]").first().click();
    await page.waitForURL("**/onboarding/connect-whatsapp", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });
    passos += 1;
    // 2. telefone: canal de TESTE (modo mock).
    await expect(page.getByTestId("whatsapp-modo-mock")).toBeVisible();
    await page.getByTestId("whatsapp-conectar-mock").click();
    await page.waitForURL("**/onboarding/setup-ai", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });
    passos += 1;
    // 3. treinar: pular (IA em mock).
    await page.getByRole("button", { name: /^Pular$/ }).click();
    await page.waitForURL("**/onboarding/funil", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });
    passos += 1;
    // 4. quadro: pular.
    await page.getByRole("button", { name: /Pular por enquanto/ }).click();
    await page.waitForURL("**/onboarding/testar", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });
    passos += 1;
    // 5. ver ele atender: pular.
    await page.getByRole("button", { name: /^Pular$/ }).click();
    await page.waitForURL("**/onboarding/invite-team", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });
    passos += 1;
    // 6. equipe: pular → done.
    await page.getByRole("button", { name: /Pular por enquanto/ }).click();
    await page.waitForURL("**/onboarding/done", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });
    passos += 1;
    await page.getByRole("button", { name: /Começar a usar/ }).click();
    await page.waitForURL("**/app/**", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });

    // Assert — onboarded_at gravado, canal mock existe, o produto abre.
    const org = await db.from("organizations").select("onboarded_at").eq("id", orgId).single();
    if (org.error) throw org.error;
    expect(org.data.onboarded_at).toBeTruthy();
    const contas = await db.from("channel_accounts").select("provider").eq("organization_id", orgId);
    if (contas.error) throw contas.error;
    expect(contas.data.map((c) => c.provider)).toContain("mock");
    expect(passos).toBe(6);
    await page.goto("/app/inbox", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/app\/inbox/);
  } finally {
    for (const id of orgsCriadas) await db.from("organizations").delete().eq("id", id);
    await db.auth.admin.deleteUser(novo.data.user.id);
  }
});
