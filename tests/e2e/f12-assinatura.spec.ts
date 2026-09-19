/**
 * F12-T08 — a ASSINATURA pela tela, nas DUAS organizações (ADR-030 §2; D38,
 * D44). DUAS jornadas × dois tenants = QUATRO testes — o inventário que
 * `scripts/verify/f02-e2e.mjs` cobra (`EXPECTED_F12_E2E_TESTS`, ADR-031).
 *
 * ═══ O que cada jornada CONFERE ═════════════════════════════════════════════
 *
 * 1. Tela contra BANCO: `/app/billing` mostra o plano, o estado e as SEIS
 *    linhas de uso com limite e restante; `GET /api/v1/billing/subscription`
 *    e `/usage` (as MESMAS funções da página) devolvem os mesmos números, e o
 *    outro tenant não aparece.
 *
 * 2. O ciclo completo pela UI: cancelar (dados preservados, `cancelled`) →
 *    o produto fecha (`/app/inbox` cai em `/app/billing`; `POST` de negócio
 *    responde 402) → "Contratar" → página do gateway MOCK → "Simular pagamento
 *    confirmado" → o webhook (assinado pelo servidor, nunca pelo navegador)
 *    ativa → `active`, fatura `paid`, uso liberado. A confirmação confiável de
 *    D38 é o evento, e a prova lê `billing_events`/`invoices` no banco.
 */
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

interface LinhaDeUso {
  capability: string;
  used: number;
  limit: number | null;
  remaining: number | null;
}

async function usoNaTela(page: Page): Promise<LinhaDeUso[]> {
  return page.getByTestId("billing-uso-linha").evaluateAll((linhas) =>
    linhas.map((l) => ({
      capability: l.getAttribute("data-capability") ?? "",
      used: Number(l.getAttribute("data-used")),
      limit: l.getAttribute("data-limit") === "" ? null : Number(l.getAttribute("data-limit")),
      remaining: l.getAttribute("data-remaining") === "" ? null : Number(l.getAttribute("data-remaining")),
    })),
  );
}

async function assinaturaNoBanco(orgId: string) {
  const r = await f02E2eSandbox().from("subscriptions" as never).select("status, plan_code, origin").eq("organization_id", orgId).single();
  if (r.error) throw r.error;
  return r.data as unknown as { status: string; plan_code: string; origin: string };
}

for (const lado of ["A", "B"] as LadoDoTeste[]) {
  test(`a tela de cobrança mostra o que o banco diz — plano, estado, 6 linhas de uso com limite e restante — só desta organização, em ${lado}`, async ({ page, fixture }) => {
    // Arrange
    await login(page, fixture.admin.email, fixture.password);
    await trocarPara(page, fixture.orgs[lado]);
    const noBanco = await assinaturaNoBanco(fixture.orgs[lado]);
    expect(noBanco.status).toBe("active");

    // Act
    await page.goto(TELA, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("billing")).toBeVisible();
    const naTela = await usoNaTela(page);
    const pelaApi = await page.request.get("/api/v1/billing/usage", { timeout: HTTP_TIMEOUT });
    const assinaturaPelaApi = await page.request.get("/api/v1/billing/subscription", { timeout: HTTP_TIMEOUT });

    // Assert — tela = API = banco.
    expect(await page.getByTestId("billing-status").getAttribute("data-status")).toBe(noBanco.status);
    expect(await page.getByTestId("billing-plano").textContent()).toBe(noBanco.plan_code);
    expect(await page.getByTestId("billing-acesso").getAttribute("data-mode")).toBe("full");
    expect(naTela).toHaveLength(6);
    expect(pelaApi.status()).toBe(200);
    const usoApi = ((await pelaApi.json()).data.usage as LinhaDeUso[]).map((u) => ({
      capability: u.capability, used: u.used, limit: u.limit, remaining: u.remaining,
    }));
    expect(naTela).toEqual(usoApi);
    // PLAN_A placeholder: users.invite=3 (1 membro → sobram 2), ai.reply=500.
    const convites = naTela.find((u) => u.capability === "users.invite");
    expect(convites).toEqual({ capability: "users.invite", used: 1, limit: 3, remaining: 2 });
    expect(naTela.find((u) => u.capability === "ai.reply")?.limit).toBe(500);
    expect(assinaturaPelaApi.status()).toBe(200);
    const s = (await assinaturaPelaApi.json()).data as { subscription: { organization_id: string; status: string }; plan: { source: string; price_cents: number } };
    expect(s.subscription.organization_id).toBe(fixture.orgs[lado]);
    expect(s.plan).toMatchObject({ source: "placeholder", price_cents: 0 });
    await expect(page.getByTestId("billing-plano-placeholder-PLAN_A")).toBeVisible();
    await expect(page.getByTestId("billing-plano-atual")).toHaveCount(1);
    // Recarregar traz o mesmo do servidor.
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await usoNaTela(page)).toEqual(naTela);
  });

  test(`cancelar fecha o produto e preserva dados; contratar → pagamento mock → webhook ativa UMA vez, em ${lado}`, async ({ page, fixture }) => {
    // Arrange
    const db = f02E2eSandbox();
    await login(page, fixture.admin.email, fixture.password);
    await trocarPara(page, fixture.orgs[lado]);
    const contatoAntes = await db.from("contacts").insert({ organization_id: fixture.orgs[lado], display_name: `Cliente ${lado}`, phone_number: `+55119${lado === "A" ? "0" : "1"}${fixture.suffix.replace(/\D/g, "").padEnd(7, "0").slice(0, 7)}` }).select("id").single();
    if (contatoAntes.error) throw contatoAntes.error;

    // Act 1 — cancelar pela tela.
    await page.goto(TELA, { waitUntil: "domcontentloaded" });
    await page.getByTestId("billing-cancelar-motivo").fill("Teste E2E de cancelamento");
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/billing/subscription/cancel", { timeout: HTTP_TIMEOUT }),
      page.getByTestId("billing-cancelar-confirmar").click(),
    ]);
    await expect.poll(async () => (await assinaturaNoBanco(fixture.orgs[lado])).status, { timeout: HTTP_TIMEOUT }).toBe("cancelled");

    // Assert 1 — o produto fecha, a cobrança fica, os dados ficam.
    await page.goto("/app/inbox", { waitUntil: "domcontentloaded" });
    await page.waitForURL("**/app/billing", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });
    expect(await page.getByTestId("billing-status").getAttribute("data-status")).toBe("cancelled");
    const escrita = await page.request.post("/api/v1/contacts", { data: { display_name: "Não deve nascer" }, timeout: HTTP_TIMEOUT });
    expect(escrita.status()).toBe(402);
    expect((await escrita.json()).error.code).toBe("subscription_required");
    const contatos = await db.from("contacts").select("id", { count: "exact", head: true }).eq("organization_id", fixture.orgs[lado]);
    expect(contatos.count).toBeGreaterThanOrEqual(1);

    // Act 2 — contratar de novo → página do GATEWAY CONFIGURADO (mock ou o
    // Stripe falso da bancada — F19, ADR-042 §4) → pagamento confirmado.
    await page.goto(TELA, { waitUntil: "domcontentloaded" });
    const gateway = await pagarNoCheckout(page, "PLAN_A");

    // Assert 2 — ativou UMA vez: estado, fatura paga, evento aplicado, uso liberado.
    // No Stripe chegam DOIS eventos (checkout.session.completed e invoice.paid,
    // como o provedor manda); a afirmação é "ativou uma vez", não "um evento".
    await expect.poll(async () => (await assinaturaNoBanco(fixture.orgs[lado])).status, { timeout: HTTP_TIMEOUT }).toBe("active");
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await page.getByTestId("billing-status").getAttribute("data-status")).toBe("active");
    const faturas = await db.from("invoices" as never).select("id, status, gateway_ref").eq("organization_id", fixture.orgs[lado]);
    if (faturas.error) throw faturas.error;
    const pagas = (faturas.data as unknown as Array<{ id: string; status: string; gateway_ref: string | null }>).filter((f) => f.status === "paid");
    expect(pagas).toHaveLength(1);
    const eventos = await db.from("billing_events" as never).select("event_type, applied, gateway").eq("organization_id", fixture.orgs[lado]);
    if (eventos.error) throw eventos.error;
    const aplicados = (eventos.data as unknown as Array<{ event_type: string; applied: boolean; gateway: string }>).filter((e) => e.applied);
    expect(aplicados.length, `eventos aplicados pelo gateway ${gateway}`).toBe(gateway === "stripe" ? 2 : 1);
    expect(aplicados.every((e) => e.event_type === "payment_confirmed" && e.gateway === gateway)).toBe(true);
    const ativacoes = await db.from("notifications" as never).select("id").eq("organization_id", fixture.orgs[lado]).eq("event", "subscription.activated");
    if (ativacoes.error) throw ativacoes.error;
    expect((ativacoes.data as unknown[]).length, "ativou mais de uma vez").toBe(1);
    const escritaDepois = await page.request.get("/api/v1/contacts", { timeout: HTTP_TIMEOUT });
    expect(escritaDepois.status()).toBe(200);
    await expect(page.getByTestId("billing-fatura")).toHaveCount(1);
  });
}
