/**
 * F18 — um motor de IA só, no navegador (ADR-040 §2 T05; ADR-041 §1): três
 * jornadas × dois tenants (A e B, ou o tenant do seed via `E2E_TENANT`) + uma
 * do painel do dono = SETE testes.
 *
 *  1. quem responde — a tela de autonomia mostra QUEM atende o despacho desta
 *     organização; o padrão é o atendimento novo; o admin volta ao antigo
 *     (PATCH 200, `ai.engine=legacy`) e retorna ao novo; o attendant é 403;
 *  2. as ações que saíram do MCP herdado — `cancel_appointment` nasce
 *     "Permitir" (a decisão do proprietário, D56 e) e `create_lead` nasce
 *     "Pedir aprovação"; o admin troca o cancelamento para "Pedir aprovação"
 *     e volta ao padrão; a tabela tem as 24 ações da IA;
 *  3. o inbox honesto (§B18) — a conversa do chat do site aparece na lista com
 *     a PRÉVIA da última mensagem, não "Sem mensagens";
 *  +  dono — o painel lista as duas organizações e a auditoria registra a
 *     troca de motor da organização A (`ai_engine.updated`).
 */
import { test as base, expect, type Page } from "@playwright/test";

import { f02E2eSandbox } from "./utils/f02-crm-cadastros";
import { cleanupF13, seedF13, type F13Fixture } from "./utils/f13-fixture";
import type { LadoDoTeste } from "./utils/f11-f12-fixture";

const HTTP_TIMEOUT = 30_000;

const test = base.extend<{ fixture: F13Fixture }>({
  fixture: async ({}, runTest, info) => {
    const fixture = await seedF13();
    try {
      await runTest(fixture);
    } finally {
      const limpeza = await cleanupF13(fixture);
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

async function entrarComo(page: Page, email: string, fixture: F13Fixture, lado: LadoDoTeste): Promise<void> {
  await login(page, email, fixture.password);
  await trocarPara(page, fixture.orgs[lado]);
}

async function slugDa(orgId: string): Promise<string> {
  const db = f02E2eSandbox();
  const r = await db.from("organizations" as never).select("slug").eq("id", orgId).single();
  if (r.error) throw r.error;
  return String((r.data as { slug: string }).slug);
}

const patchDaAutonomia = (page: Page) =>
  page.waitForResponse(
    (r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === "/api/v1/settings/ai-autonomy",
    { timeout: HTTP_TIMEOUT },
  );

for (const lado of ["A", "B"] as LadoDoTeste[]) {
  test(`quem responde em ${lado}: o padrão é o atendimento novo; o admin volta ao antigo e retorna; attendant é 403`, async ({ page, fixture }) => {
    await entrarComo(page, fixture.admin.email, fixture, lado);
    await page.goto("/app/settings/tenant/ia/autonomia", { waitUntil: "domcontentloaded" });

    const motor = page.getByTestId("ai-engine");
    await expect(motor).toBeVisible({ timeout: HTTP_TIMEOUT });
    // O default declarado (ADR-040 §1): quem responde é o turno que o gate mede.
    await expect(motor).toHaveAttribute("data-engine", "saas");

    const voltou = patchDaAutonomia(page);
    await page.getByTestId("ai-engine-alternar").click();
    expect((await voltou).status()).toBe(200);
    await expect(motor).toHaveAttribute("data-engine", "legacy", { timeout: HTTP_TIMEOUT });
    const lido = await page.request.get("/api/v1/settings/ai-autonomy", { timeout: HTTP_TIMEOUT });
    expect(((await lido.json()).data as { engine: string }).engine).toBe("legacy");

    // E a volta atrás volta: é chave da organização, não deploy.
    const voltouDeNovo = patchDaAutonomia(page);
    await page.getByTestId("ai-engine-alternar").click();
    expect((await voltouDeNovo).status()).toBe(200);
    await expect(motor).toHaveAttribute("data-engine", "saas", { timeout: HTTP_TIMEOUT });

    await entrarComo(page, fixture.attendants[0]!.email, fixture, lado);
    const negado = await page.request.patch("/api/v1/settings/ai-autonomy", {
      data: { engine: "legacy" },
      timeout: HTTP_TIMEOUT,
    });
    expect(negado.status()).toBe(403);
  });

  test(`ações do MCP herdado em ${lado}: cancelar nasce "Permitir" e criar oportunidade nasce "Pedir aprovação"`, async ({ page, fixture }) => {
    await entrarComo(page, fixture.admin.email, fixture, lado);
    await page.goto("/app/settings/tenant/ia/autonomia", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("ai-autonomy")).toBeVisible({ timeout: HTTP_TIMEOUT });

    // D56 e: a IA desmarca sozinha. É a única ação de efeito externo assim, e
    // ela aparece na tela com esse nome para quem for reler a decisão.
    const cancelar = page.getByTestId("ai-autonomy-cancel_appointment");
    await expect(cancelar).toHaveAttribute("data-mode", "allow");
    await expect(cancelar).toHaveAttribute("data-source", "padrão");

    // Escrita de funil `medium` + `by_risk`: D33 pendura para a pessoa.
    const criar = page.getByTestId("ai-autonomy-create_lead");
    await expect(criar).toHaveAttribute("data-mode", "approve");

    const gravou = patchDaAutonomia(page);
    await page.getByTestId("ai-autonomy-cancel_appointment-modo").selectOption("approve");
    expect((await gravou).status()).toBe(200);
    await expect(cancelar).toHaveAttribute("data-mode", "approve", { timeout: HTTP_TIMEOUT });
    await expect(cancelar).toHaveAttribute("data-source", "organização");

    const limpou = patchDaAutonomia(page);
    await page.getByTestId("ai-autonomy-cancel_appointment-padrao").click();
    expect((await limpou).status()).toBe(200);
    await expect(cancelar).toHaveAttribute("data-source", "padrão", { timeout: HTTP_TIMEOUT });

    // A tabela é do CATÁLOGO: 24 ações visíveis à IA depois da F18.
    const rota = await page.request.get("/api/v1/settings/ai-autonomy", { timeout: HTTP_TIMEOUT });
    const tabela = ((await rota.json()).data as { table: Array<{ action: string; configurable: boolean }> }).table;
    expect(tabela.filter((l) => l.configurable).length).toBe(24);
  });

  test(`inbox honesto em ${lado}: a conversa do chat do site aparece com a PRÉVIA da última mensagem`, async ({ page, browser, fixture }) => {
    await entrarComo(page, fixture.admin.email, fixture, lado);
    const slug = await slugDa(fixture.orgs[lado]);
    const ligou = page.waitForResponse(
      (r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === "/api/v1/settings/webchat",
      { timeout: HTTP_TIMEOUT },
    );
    await page.goto("/app/settings/tenant/webchat", { waitUntil: "domcontentloaded" });
    await page.getByTestId("webchat-alternar").click();
    expect((await ligou).status()).toBe(200);

    const texto = `Prévia do inbox ${fixture.suffix}`;
    const contexto = await browser.newContext();
    const visitante = await contexto.newPage();
    try {
      await visitante.goto(`/chat/${slug}`, { waitUntil: "domcontentloaded" });
      await expect(visitante.locator("[data-form-ident]")).toBeVisible({ timeout: HTTP_TIMEOUT });
      await visitante.locator("[data-nome]").fill("Visitante Da Prévia");
      await visitante.locator("[data-contato]").fill(`previa-${lado}-${fixture.suffix}@example.test`);
      await visitante.locator("[data-continuar]").click();
      await expect(visitante.locator("[data-form-msg]")).toBeVisible({ timeout: HTTP_TIMEOUT });
      const enviou = visitante.waitForResponse(
        (r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/messages"),
        { timeout: HTTP_TIMEOUT },
      );
      await visitante.locator("[data-corpo]").fill(texto);
      await visitante.locator("[data-enviar]").click();
      expect((await enviou).status()).toBe(202);
    } finally {
      await contexto.close();
    }

    // §B18: a prévia é gravada por `concluirEntrada`, para todo canal. Antes da
    // F18 a lista mostrava "Sem mensagens" — a conversa existia e parecia vazia.
    const db = f02E2eSandbox();
    await expect
      .poll(
        async () => {
          const r = await db
            .from("conversations" as never)
            .select("last_message_preview")
            .eq("organization_id", fixture.orgs[lado])
            .eq("channel", "webchat");
          if (r.error) throw r.error;
          return (r.data as Array<{ last_message_preview: string | null }>)[0]?.last_message_preview ?? null;
        },
        { timeout: HTTP_TIMEOUT },
      )
      .toContain(texto);
  });
}

test("dono: as duas organizações no painel e a troca de motor de A fica na auditoria", async ({ page, fixture }) => {
  await login(page, fixture.admin.email, fixture.password);
  await trocarPara(page, fixture.orgs.A);
  const trocou = await page.request.patch("/api/v1/settings/ai-autonomy", {
    data: { engine: "legacy" },
    timeout: HTTP_TIMEOUT,
  });
  expect(trocou.status(), await trocou.text()).toBe(200);

  await login(page, fixture.dono.email, fixture.password);
  const r = await page.request.get("/api/v1/admin/tenants", { timeout: HTTP_TIMEOUT });
  expect(r.status(), await r.text()).toBe(200);
  const ids = ((await r.json()).data as Array<{ id: string }>).map((t) => t.id);
  expect(ids).toContain(fixture.orgs.A);
  expect(ids).toContain(fixture.orgs.B);

  // Quem trocou o motor de uma organização fica registrado: é a ação que muda
  // QUEM responde o cliente, e ela não pode acontecer sem deixar rastro.
  const db = f02E2eSandbox();
  const auditoria = await db
    .from("api_audit_log" as never)
    .select("action")
    .eq("organization_id", fixture.orgs.A)
    .eq("action", "ai_engine.updated");
  if (auditoria.error) throw auditoria.error;
  expect((auditoria.data as unknown[]).length).toBeGreaterThanOrEqual(1);
});
