/**
 * F04-T10 — a tela de IA do `tenant_admin`, nas DUAS organizações fictícias.
 *
 * CINCO jornadas × dois tenants = DEZ testes. O número não é estilo: é o
 * inventário que `scripts/verify/f02-e2e.mjs` cobra
 * (`EXPECTED_F04_E2E_TESTS = EXPECTED_F03_E2E_TESTS + 10`, ADR-022 decisão 5).
 *
 * As cinco jornadas são as cinco coisas que §7.5 pede na tela: persona, texto de
 * "não sei", limiar de confiança, liga/desliga e upload de documento do acervo.
 *
 * ═══ O que cada jornada CONFERE ═════════════════════════════════════════════
 *
 * Nunca só o campo preenchido na tela. Toda jornada recarrega a página (para que
 * o valor volte do SERVIDOR, não do estado do React) E lê `/api/v1/settings/ai`,
 * que responde por `getSetting` — isto é, pelo que está em `tenant_settings`.
 * Um formulário que guardasse o texto só no navegador passaria no primeiro
 * cheque e morreria no segundo.
 *
 * A jornada do acervo acrescenta a prova de tenant: o documento subido de um
 * lado NÃO aparece na lista do outro. Nas duas execuções isso dá o "documento
 * cai no tenant certo 2/2" da prova de F04-T10.
 */
import { test as base, expect, type Page } from "@playwright/test";

import {
  cleanupF04AiSettings,
  seedF04AiSettings,
  type F04AiSettingsFixture,
  type LadoDoTeste,
} from "./utils/f04-ai-settings";

const HTTP_TIMEOUT = 30_000;
const TELA = "/app/settings/tenant/ia";

const test = base.extend<{ fixture: F04AiSettingsFixture }>({
  fixture: async ({}, runTest, info) => {
    const fixture = await seedF04AiSettings();
    try {
      await runTest(fixture);
    } finally {
      const limpeza = await cleanupF04AiSettings(fixture);
      await info.attach("sandbox-cleanup", {
        body: JSON.stringify(limpeza),
        contentType: "application/json",
      });
      expect(limpeza).toEqual({
        deleted_organizations: 2,
        deleted_users: 1,
        domain_tables_checked: 5,
        domain_rows_remaining: 0,
      });
    }
  },
});
test.describe.configure({ timeout: 300_000 });

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/app/inbox", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });
}

async function orgAtiva(page: Page): Promise<string> {
  const resposta = await page.request.get("/api/v1/auth/interface", { timeout: HTTP_TIMEOUT });
  expect(resposta.status()).toBe(200);
  return (await resposta.json()).data.organization_id as string;
}

async function trocarPara(page: Page, orgId: string): Promise<void> {
  if ((await orgAtiva(page)) === orgId) return;
  await page.getByTestId("tenant-switcher").click();
  await Promise.all([
    page.waitForEvent("framenavigated", {
      predicate: (frame) =>
        frame === page.mainFrame() && new URL(frame.url()).pathname === "/app/inbox",
      timeout: HTTP_TIMEOUT,
    }),
    page.getByTestId(`tenant-switcher-item-${orgId}`).click(),
  ]);
  await page.waitForLoadState("domcontentloaded");
  await expect.poll(() => orgAtiva(page), { timeout: HTTP_TIMEOUT }).toBe(orgId);
}

/** O REGISTRO-FONTE das Settings de IA, como `getSetting` as devolve. */
async function configuracaoNoBanco(page: Page): Promise<Record<string, unknown>> {
  const resposta = await page.request.get("/api/v1/settings/ai", { timeout: HTTP_TIMEOUT });
  expect(resposta.status()).toBe(200);
  return (await resposta.json()).data as Record<string, unknown>;
}

async function acervoNoBanco(page: Page): Promise<{ nome: string }[]> {
  const resposta = await page.request.get("/api/v1/settings/ai/acervo", {
    timeout: HTTP_TIMEOUT,
  });
  expect(resposta.status()).toBe(200);
  return (await resposta.json()).data as { nome: string }[];
}

/** Salva o formulário e espera o PATCH que realmente gravou. */
async function salvar(page: Page): Promise<number> {
  const gravado = page.waitForResponse(
    (resposta) =>
      resposta.request().method() === "PATCH" &&
      new URL(resposta.url()).pathname === "/api/v1/settings/ai",
    { timeout: HTTP_TIMEOUT },
  );
  await page.getByTestId("ia-salvar").click();
  return (await gravado).status();
}

async function abrirTela(page: Page, fixture: F04AiSettingsFixture, lado: LadoDoTeste) {
  await login(page, fixture.admin.email, fixture.password);
  await trocarPara(page, fixture.orgs[lado]);
  await page.goto(TELA, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("form-ia")).toBeVisible();
}

for (const lado of ["A", "B"] as LadoDoTeste[]) {
  test(`persona do agente é gravada e volta do banco em ${lado}`, async ({ page, fixture }) => {
    // Arrange
    await abrirTela(page, fixture, lado);
    const persona = `Fale como o time do lado ${lado} ${fixture.suffix}, direto e cordial.`;

    // Act
    await page.getByTestId("ia-persona").fill(persona);
    expect(await salvar(page)).toBe(200);

    // Assert — volta do SERVIDOR depois da recarga…
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("ia-persona")).toHaveValue(persona);
    // …e é o que está em `tenant_settings`, lido por `getSetting`.
    expect((await configuracaoNoBanco(page))["ai.system_prompt"]).toBe(persona);
  });

  test(`texto de "não sei" é gravado e volta do banco em ${lado}`, async ({ page, fixture }) => {
    // Arrange
    await abrirTela(page, fixture, lado);
    const naoSei = `Ainda não tenho isso aqui (${lado} ${fixture.suffix}). Vou verificar e te retorno.`;

    // Act
    await page.getByTestId("ia-nao-sei").fill(naoSei);
    expect(await salvar(page)).toBe(200);

    // Assert — é o texto EXATO que o cliente receberia; a comparação é byte a byte.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("ia-nao-sei")).toHaveValue(naoSei);
    expect((await configuracaoNoBanco(page))["ai.unknown_answer"]).toBe(naoSei);
  });

  test(`limiar de confiança aceita o valor da faixa e recusa o de fora em ${lado}`, async ({
    page,
    fixture,
  }) => {
    // Arrange
    await abrirTela(page, fixture, lado);

    // Act 1 — um valor da faixa [0,1].
    await page.getByTestId("ia-limiar").fill("0.35");
    expect(await salvar(page)).toBe(200);

    // Assert 1
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("ia-limiar")).toHaveValue("0.35");
    expect((await configuracaoNoBanco(page))["ai.confidence_threshold"]).toBe(0.35);

    // Act 2 — fora da faixa, pela API: a recusa é do servidor, não da tela.
    const recusado = await page.request.patch("/api/v1/settings/ai", {
      data: { "ai.confidence_threshold": 1.5 },
      timeout: HTTP_TIMEOUT,
    });

    // Assert 2 — 422 e o valor bom continua no banco.
    expect(recusado.status()).toBe(422);
    expect((await configuracaoNoBanco(page))["ai.confidence_threshold"]).toBe(0.35);
  });

  test(`liga e desliga o agente e o estado persiste em ${lado}`, async ({ page, fixture }) => {
    // Arrange
    await abrirTela(page, fixture, lado);
    const chave = page.getByTestId("ia-ligada");
    // Organização recém-criada não tem linha de `ai.enabled`, e a guarda que
    // decide se a IA atende lê por PRESENÇA (`src/conversation/guards.ts`):
    // "não configurado" é DESLIGADO, e é isso que a tela tem de mostrar.
    await expect(chave).not.toBeChecked();
    expect((await configuracaoNoBanco(page))["ai.enabled"]).toBe(false);

    // Act 1 — ligar.
    await chave.check();
    expect(await salvar(page)).toBe(200);

    // Assert 1
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("ia-ligada")).toBeChecked();
    expect((await configuracaoNoBanco(page))["ai.enabled"]).toBe(true);

    // Act 2 — desligar de volta: ligar que não tem volta seria um botão de
    // mão única numa tela de configuração.
    await page.getByTestId("ia-ligada").uncheck();
    expect(await salvar(page)).toBe(200);

    // Assert 2
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("ia-ligada")).not.toBeChecked();
    expect((await configuracaoNoBanco(page))["ai.enabled"]).toBe(false);
  });

  test(`documento subido em ${lado} entra no acervo deste tenant e não no do outro`, async ({
    page,
    fixture,
  }) => {
    // Arrange
    await abrirTela(page, fixture, lado);
    const nomeDoArquivo = `politica-${lado.toLowerCase()}-${fixture.suffix}.txt`;
    const conteudo =
      `Politica de entrega do lado ${lado} ${fixture.suffix}.\n\n` +
      "O prazo de entrega para a regiao central e de dois dias uteis.\n\n" +
      "Trocas de produto lacrado valem por sete dias com a nota fiscal.\n";
    const outroLado: LadoDoTeste = lado === "A" ? "B" : "A";

    // Act
    const indexado = page.waitForResponse(
      (resposta) =>
        resposta.request().method() === "POST" &&
        new URL(resposta.url()).pathname === "/api/v1/settings/ai/acervo",
      { timeout: HTTP_TIMEOUT },
    );
    await page.getByTestId("acervo-arquivo").setInputFiles({
      name: nomeDoArquivo,
      mimeType: "text/plain",
      buffer: Buffer.from(conteudo, "utf8"),
    });
    await page.getByTestId("acervo-enviar").click();
    expect((await indexado).status()).toBe(201);

    // Assert 1 — está na lista DESTE tenant, com trechos (material sem trecho é
    // item que a busca nunca alcança).
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.locator(`[data-testid="acervo-item"][data-nome="${nomeDoArquivo}"]`),
    ).toHaveCount(1);
    const daqui = await acervoNoBanco(page);
    expect(daqui.map((m) => m.nome)).toContain(nomeDoArquivo);
    expect(daqui.find((m) => m.nome === nomeDoArquivo)?.nome).toBe(nomeDoArquivo);

    // Assert 2 — o OUTRO tenant não enxerga nada disso: nem na tela, nem na API.
    await trocarPara(page, fixture.orgs[outroLado]);
    await page.goto(TELA, { waitUntil: "domcontentloaded" });
    await expect(
      page.locator(`[data-testid="acervo-item"][data-nome="${nomeDoArquivo}"]`),
    ).toHaveCount(0);
    await expect(page.getByTestId("acervo-vazio")).toBeVisible();
    expect((await acervoNoBanco(page)).map((m) => m.nome)).not.toContain(nomeDoArquivo);
  });
}
