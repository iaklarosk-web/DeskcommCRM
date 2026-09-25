/**
 * F05-T09 — a tela de USO de IA do `tenant_admin`, nas DUAS organizações
 * fictícias.
 *
 * DUAS jornadas × dois tenants = QUATRO testes. O número não é estilo: é o
 * inventário que `scripts/verify/f02-e2e.mjs` cobra
 * (`EXPECTED_F05_E2E_TESTS = EXPECTED_F04_E2E_TESTS + 4`, ADR-024 decisão 5).
 *
 * As duas jornadas são as duas coisas que §7.6 pede: "tokens, custo por
 * período" — a SOMA e o PERÍODO.
 *
 * ═══ O que cada jornada CONFERE ═════════════════════════════════════════════
 *
 * Tela contra BANCO, nunca tela contra tela. O esperado sai da FIXTURE (as
 * linhas que ela mesma semeou em `ai_usage_events`, com números diferentes por
 * lado), e o observado vem de dois lugares: o texto renderizado pela página
 * SERVIDA e `GET /api/v1/settings/ai/uso`, que lê pela mesma `resumoDeUso`.
 * A prova de tenant é a soma: se o filtro de organização vazasse, o número de A
 * carregaria o de B — e os dois foram escolhidos para nunca coincidirem.
 */
import { test as base, expect, type Page } from "@playwright/test";

import {
  cleanupF05AiUsage,
  seedF05AiUsage,
  somaDe,
  type F05AiUsageFixture,
  type LadoDoTeste,
} from "./utils/f05-ai-usage";

const HTTP_TIMEOUT = 30_000;
const TELA = "/app/settings/tenant/ia/uso";

const test = base.extend<{ fixture: F05AiUsageFixture }>({
  fixture: async ({}, runTest, info) => {
    const fixture = await seedF05AiUsage();
    try {
      await runTest(fixture);
    } finally {
      const limpeza = await cleanupF05AiUsage(fixture);
      await info.attach("sandbox-cleanup", {
        body: JSON.stringify(limpeza),
        contentType: "application/json",
      });
      expect(limpeza).toEqual({
        deleted_organizations: 2,
        deleted_users: 1,
        domain_tables_checked: 2,
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

interface Totais {
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_cents: number;
}

/** O que a TELA mostra, lido do DOM servido. */
async function totaisNaTela(page: Page): Promise<Totais> {
  const numero = async (testId: string) => Number((await page.getByTestId(testId).textContent())?.trim());
  return {
    calls: await numero("uso-ia-chamadas"),
    prompt_tokens: await numero("uso-ia-prompt-tokens"),
    completion_tokens: await numero("uso-ia-completion-tokens"),
    total_tokens: await numero("uso-ia-total-tokens"),
    estimated_cost_cents: Number((await numero("uso-ia-custo-cents")).toFixed(4)),
  };
}

/** O REGISTRO-FONTE, como `resumoDeUso` o devolve pela API. */
async function totaisNoBanco(page: Page, desde?: string, ate?: string): Promise<Totais> {
  const query = desde && ate ? `?desde=${desde}&ate=${ate}` : "";
  const resposta = await page.request.get(`/api/v1/settings/ai/uso${query}`, { timeout: HTTP_TIMEOUT });
  expect(resposta.status()).toBe(200);
  const data = (await resposta.json()).data as Totais;
  return {
    calls: data.calls,
    prompt_tokens: data.prompt_tokens,
    completion_tokens: data.completion_tokens,
    total_tokens: data.total_tokens,
    estimated_cost_cents: Number(data.estimated_cost_cents.toFixed(4)),
  };
}

async function abrirTela(page: Page, fixture: F05AiUsageFixture, lado: LadoDoTeste) {
  await login(page, fixture.admin.email, fixture.password);
  await trocarPara(page, fixture.orgs[lado]);
  await page.goto(TELA, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("uso-ia")).toBeVisible();
}

const outroLado = (lado: LadoDoTeste): LadoDoTeste => (lado === "A" ? "B" : "A");

for (const lado of ["A", "B"] as LadoDoTeste[]) {
  test(`o valor exibido é sum(ai_usage_events) do mês corrente, só desta organização, em ${lado}`, async ({ page, fixture }) => {
    // Arrange — o esperado sai da fixture: as linhas DESTE lado, deste mês.
    const esperado = somaDe(fixture.linhas[lado].filter((l) => l.quando === "este_mes"));
    const doOutroLado = somaDe(fixture.linhas[outroLado(lado)].filter((l) => l.quando === "este_mes"));
    expect(esperado.total_tokens, "a fixture tem de distinguir os lados").not.toBe(doOutroLado.total_tokens);
    expect(esperado.estimated_cost_cents).not.toBe(doOutroLado.estimated_cost_cents);
    await abrirTela(page, fixture, lado);

    // Act — o que a tela mostra, e o que o banco devolve pela API.
    const naTela = await totaisNaTela(page);
    const noBanco = await totaisNoBanco(page);

    // Assert — tela = fixture = banco; e NÃO o outro tenant.
    expect(naTela).toEqual(esperado);
    expect(noBanco).toEqual(esperado);
    expect(naTela.total_tokens).not.toBe(doOutroLado.total_tokens);
    // A tabela por modelo lista só o modelo deste lado.
    const modelos = await page.getByTestId("uso-ia-linha").evaluateAll((linhas) =>
      linhas.map((l) => l.getAttribute("data-model")),
    );
    expect(new Set(modelos)).toEqual(new Set(fixture.linhas[lado].map((l) => l.model)));
    // Recarregar traz o mesmo número do servidor.
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await totaisNaTela(page)).toEqual(esperado);
  });

  test(`o período filtra: "mês passado" e um intervalo que cobre os dois meses, em ${lado}`, async ({ page, fixture }) => {
    // Arrange
    const mesPassado = somaDe(fixture.linhas[lado].filter((l) => l.quando === "mes_passado"));
    const tudo = somaDe(fixture.linhas[lado]);
    expect(mesPassado.calls).toBeGreaterThan(0);
    await abrirTela(page, fixture, lado);

    // Act 1 — o atalho "Mês passado" muda a URL e o servidor responde só aquele mês.
    await Promise.all([
      page.waitForURL((url) => url.pathname === TELA && url.searchParams.has("desde"), { timeout: HTTP_TIMEOUT }),
      page.getByTestId("uso-ia-mes-passado").click(),
    ]);
    await expect(page.getByTestId("uso-ia")).toBeVisible();
    const url = new URL(page.url());
    const desde = url.searchParams.get("desde") ?? "";
    const ate = url.searchParams.get("ate") ?? "";

    // Assert 1 — tela = fixture = banco, para o MESMO período da URL.
    expect(await totaisNaTela(page)).toEqual(mesPassado);
    expect(await totaisNoBanco(page, desde, ate)).toEqual(mesPassado);
    expect(await page.getByTestId("uso-ia-periodo-atual").textContent()).toContain(desde);

    // Act 2 — o formulário de datas, do primeiro dia do mês passado até hoje.
    const hoje = new Date().toISOString().slice(0, 10);
    await page.getByTestId("uso-ia-desde").fill(desde);
    await page.getByTestId("uso-ia-ate").fill(hoje);
    await Promise.all([
      page.waitForURL((u) => u.pathname === TELA && u.searchParams.get("ate") === hoje, { timeout: HTTP_TIMEOUT }),
      page.getByTestId("uso-ia-aplicar").click(),
    ]);
    await expect(page.getByTestId("uso-ia")).toBeVisible();

    // Assert 2 — os dois meses somados, e o banco concorda.
    expect(await totaisNaTela(page)).toEqual(tudo);
    expect(await totaisNoBanco(page, desde, hoje)).toEqual(tudo);
  });
}
