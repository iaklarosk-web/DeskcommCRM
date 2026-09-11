import { test as base, expect, type Page } from "@playwright/test";

import {
  cleanupF03Inbox,
  seedF03Inbox,
  type F03InboxFixture,
  type LadoDoTeste,
} from "./utils/f03-inbox";

/**
 * F03-T09 — O INBOX OPERADO PELA MÁQUINA DE ESTADOS, PELA TELA.
 *
 * Sete jornadas, rodadas nas DUAS organizações fictícias: o "7/7 por tenant" de
 * §7.4. Cada uma termina afirmando o TEXTO do estado D16 na tela — na lista e no
 * cabeçalho —, porque é isso que a prova da task pede: não "a rota respondeu
 * 200", e sim "o atendente lê o estado certo depois de agir".
 *
 * As cinco ações atravessam `transition()` no servidor (ADR-016). Nada aqui
 * chama a máquina de estados direto: se a tela mostra o estado novo, é porque o
 * caminho inteiro — rota, transição, projeção, leitura, render — ficou de pé.
 *
 * Nenhum provedor real é exercitado: o canal da fixture nunca fica `WORKING`, e
 * `WHATSAPP_MODE=mock`/`AI_PROVIDER=mock` valem por fora (D12).
 */

const HTTP_TIMEOUT = 30_000;

/** Os rótulos que a tela escreve — a prova cita TEXTO, não enum. */
const ESTADO = {
  aguardando: "Aguardando atendente",
  automatico: "Atendimento automático",
  humano: "Em atendimento humano",
  resolvida: "Resolvida",
} as const;

const test = base.extend<{ fixture: F03InboxFixture }>({
  fixture: async ({}, runTest, info) => {
    const fixture = await seedF03Inbox();
    try {
      await runTest(fixture);
    } finally {
      const limpeza = await cleanupF03Inbox(fixture);
      await info.attach("sandbox-cleanup", {
        body: JSON.stringify(limpeza),
        contentType: "application/json",
      });
      expect(limpeza).toEqual({
        deleted_organizations: 2,
        deleted_users: 2,
        domain_tables_checked: 8,
        domain_rows_remaining: 0,
      });
    }
  },
});
test.describe.configure({ timeout: 300_000 });

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/app/inbox", {
    timeout: HTTP_TIMEOUT,
    waitUntil: "domcontentloaded",
  });
}

async function orgAtiva(page: Page): Promise<string> {
  const resposta = await page.request.get("/api/v1/auth/interface", { timeout: HTTP_TIMEOUT });
  expect(resposta.status()).toBe(200);
  return (await resposta.json()).data.organization_id as string;
}

/** Mesmo passo da fixture de F02: o cookie muda no servidor antes da navegação. */
async function trocarPara(page: Page, orgId: string) {
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

/** A linha da conversa na lista — achada pelo id, que é o que a fixture conhece. */
function linhaDaLista(page: Page, conversationId: string) {
  return page.locator(`[data-conversation-id="${conversationId}"]`);
}

/** O selo de estado DENTRO da linha: nunca o primeiro da página. */
function estadoNaLista(page: Page, conversationId: string) {
  return linhaDaLista(page, conversationId).getByTestId("estado-d16");
}

function estadoNoCabecalho(page: Page) {
  return page.getByTestId("estado-d16-cabecalho");
}

/**
 * Abre uma conversa pela URL do inbox.
 *
 * `?filter=all` porque as abas herdadas recortam por status e por comando, e a
 * jornada quer a conversa que ela semeou, não a que a aba julga relevante.
 */
async function abrirConversa(page: Page, conversationId: string) {
  await page.goto(`/app/inbox?filter=all&id=${conversationId}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(estadoNoCabecalho(page)).toBeVisible({ timeout: HTTP_TIMEOUT });
}

/** Radix Select: o gatilho abre um portal e a opção é um `option` acessível. */
async function escolherNoSelect(page: Page, testId: string, rotulo: string) {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name: rotulo, exact: true }).click();
}

for (const lado of ["A", "B"] as LadoDoTeste[]) {
  test(`lista filtra por estado e o filtro sobrevive à recarga em ${lado}`, async ({
    page,
    fixture,
  }, info) => {
    const tenant = fixture.tenants[lado];
    await login(page, fixture.atendente.email, fixture.password);
    await trocarPara(page, tenant.orgId);

    await page.goto("/app/inbox?filter=all", { waitUntil: "domcontentloaded" });
    // O CONTROLE: sem ele, um filtro que devolvesse lista vazia passaria como
    // "filtrou". As quatro conversas existem ANTES de qualquer recorte.
    for (const chave of ["esperando", "automatica", "humana", "resolvida"] as const) {
      await expect(linhaDaLista(page, tenant.conversas[chave].id)).toBeVisible({
        timeout: HTTP_TIMEOUT,
      });
    }

    await escolherNoSelect(page, "filtro-estado", ESTADO.humano);
    await expect
      .poll(() => new URL(page.url()).searchParams.get("estado"), { timeout: HTTP_TIMEOUT })
      .toBe("human_handling");

    const humana = tenant.conversas.humana;
    await expect(estadoNaLista(page, humana.id)).toHaveText(ESTADO.humano, {
      timeout: HTTP_TIMEOUT,
    });
    await expect(linhaDaLista(page, tenant.conversas.esperando.id)).toHaveCount(0);
    await expect(linhaDaLista(page, tenant.conversas.automatica.id)).toHaveCount(0);
    await expect(linhaDaLista(page, tenant.conversas.resolvida.id)).toHaveCount(0);

    // A RECARGA é o ponto da jornada: o filtro vive na URL, não em memória.
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).searchParams.get("estado")).toBe("human_handling");
    await expect(estadoNaLista(page, humana.id)).toHaveText(ESTADO.humano, {
      timeout: HTTP_TIMEOUT,
    });
    await expect(linhaDaLista(page, tenant.conversas.esperando.id)).toHaveCount(0);

    await linhaDaLista(page, humana.id).click();
    await expect(estadoNoCabecalho(page)).toHaveText(ESTADO.humano, { timeout: HTTP_TIMEOUT });
    await info.attach(`f03-filtro-estado-${lado}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });

  test(`lista filtra por responsável em ${lado}`, async ({ page, fixture }) => {
    const tenant = fixture.tenants[lado];
    await login(page, fixture.atendente.email, fixture.password);
    await trocarPara(page, tenant.orgId);

    await page.goto("/app/inbox?filter=all", { waitUntil: "domcontentloaded" });
    await expect(linhaDaLista(page, tenant.conversas.esperando.id)).toBeVisible({
      timeout: HTTP_TIMEOUT,
    });

    await escolherNoSelect(page, "filtro-responsavel", fixture.atendente.nome);
    await expect
      .poll(() => new URL(page.url()).searchParams.get("responsavel"), { timeout: HTTP_TIMEOUT })
      .toBe(fixture.atendente.id);

    // Só as duas com dono sobram; as sem dono somem.
    await expect(estadoNaLista(page, tenant.conversas.humana.id)).toHaveText(ESTADO.humano, {
      timeout: HTTP_TIMEOUT,
    });
    await expect(estadoNaLista(page, tenant.conversas.resolvida.id)).toHaveText(ESTADO.resolvida, {
      timeout: HTTP_TIMEOUT,
    });
    await expect(linhaDaLista(page, tenant.conversas.esperando.id)).toHaveCount(0);
    await expect(linhaDaLista(page, tenant.conversas.automatica.id)).toHaveCount(0);

    await linhaDaLista(page, tenant.conversas.resolvida.id).click();
    await expect(estadoNoCabecalho(page)).toHaveText(ESTADO.resolvida, { timeout: HTTP_TIMEOUT });
  });

  test(`assumir leva a conversa para atendimento humano em ${lado}`, async ({ page, fixture }) => {
    const tenant = fixture.tenants[lado];
    await login(page, fixture.atendente.email, fixture.password);
    await trocarPara(page, tenant.orgId);

    // (1) A partir do AUTOMÁTICO: a tabela D16 não tem `ai_handling + human.claimed`,
    // e o caminho é a sequência `handoff.requested` -> `human.claimed`. É o caso
    // que o desenho desta task existe para cobrir.
    const automatica = tenant.conversas.automatica;
    await abrirConversa(page, automatica.id);
    await expect(estadoNoCabecalho(page)).toHaveText(ESTADO.automatico, { timeout: HTTP_TIMEOUT });
    await page.getByRole("button", { name: /^Assumir$/i }).click();
    await expect(estadoNoCabecalho(page)).toHaveText(ESTADO.humano, { timeout: HTTP_TIMEOUT });
    await expect(page.getByTestId("comando-da-conversa")).toContainText(fixture.atendente.nome, {
      timeout: HTTP_TIMEOUT,
    });
    await expect(estadoNaLista(page, automatica.id)).toHaveText(ESTADO.humano, {
      timeout: HTTP_TIMEOUT,
    });

    // (2) O par direto da tabela: `waiting_human + human.claimed`.
    const esperando = tenant.conversas.esperando;
    await abrirConversa(page, esperando.id);
    await expect(estadoNoCabecalho(page)).toHaveText(ESTADO.aguardando, { timeout: HTTP_TIMEOUT });
    await page.getByRole("button", { name: /^Assumir$/i }).click();
    await expect(estadoNoCabecalho(page)).toHaveText(ESTADO.humano, { timeout: HTTP_TIMEOUT });
    await expect(estadoNaLista(page, esperando.id)).toHaveText(ESTADO.humano, {
      timeout: HTTP_TIMEOUT,
    });
  });

  test(`responder mantém o estado da conversa em ${lado}`, async ({ page, fixture }) => {
    const tenant = fixture.tenants[lado];
    const humana = tenant.conversas.humana;
    await login(page, fixture.atendente.email, fixture.password);
    await trocarPara(page, tenant.orgId);
    await abrirConversa(page, humana.id);
    await expect(estadoNoCabecalho(page)).toHaveText(ESTADO.humano, { timeout: HTTP_TIMEOUT });

    const texto = `Resposta fictícia ${fixture.suffix} ${lado}`;
    await page.getByLabel("Mensagem", { exact: true }).fill(texto);
    const enviada = page.waitForResponse(
      (resposta) =>
        resposta.request().method() === "POST" &&
        new URL(resposta.url()).pathname === "/api/v1/messages",
      { timeout: HTTP_TIMEOUT },
    );
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    const resposta = await enviada;
    // 201 é o contrato da rota; qualquer outra coisa significa que a máquina de
    // estados recusou o envio, e aí a jornada precisa falhar dizendo isso.
    expect(resposta.status()).toBe(201);
    // ESCOPADO AO THREAD, e não por estilo: quando o envio dá certo o mesmo texto
    // aparece DUAS vezes na tela — na bolha e na prévia do item da lista, que a
    // invalidação acabou de atualizar. Um `getByText` solto resolve para 2
    // elementos e o modo estrito reprova o teste por excesso de sucesso. É a
    // mesma armadilha já documentada em `inbox-tempo-real.spec.ts`.
    await expect(
      page.getByTestId("chat-thread").getByText(texto, { exact: true }),
    ).toBeVisible({ timeout: HTTP_TIMEOUT });

    await expect(estadoNoCabecalho(page)).toHaveText(ESTADO.humano, { timeout: HTTP_TIMEOUT });
    await expect(estadoNaLista(page, humana.id)).toHaveText(ESTADO.humano, {
      timeout: HTTP_TIMEOUT,
    });
  });

  test(`transferir troca o responsável e mantém o estado em ${lado}`, async ({ page, fixture }) => {
    const tenant = fixture.tenants[lado];
    const humana = tenant.conversas.humana;
    await login(page, fixture.atendente.email, fixture.password);
    await trocarPara(page, tenant.orgId);
    await abrirConversa(page, humana.id);
    await expect(page.getByTestId("comando-da-conversa")).toContainText(fixture.atendente.nome, {
      timeout: HTTP_TIMEOUT,
    });

    await page.getByRole("button", { name: "Transferir", exact: true }).first().click();
    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible({ timeout: HTTP_TIMEOUT });
    await dialogo.locator("#reassign-target").click();
    await page.getByRole("option", { name: new RegExp(fixture.colega.nome) }).click();
    await dialogo.getByRole("button", { name: "Transferir", exact: true }).click();

    await expect(page.getByTestId("comando-da-conversa")).toContainText(fixture.colega.nome, {
      timeout: HTTP_TIMEOUT,
    });
    await expect(estadoNoCabecalho(page)).toHaveText(ESTADO.humano, { timeout: HTTP_TIMEOUT });
    await expect(estadoNaLista(page, humana.id)).toHaveText(ESTADO.humano, {
      timeout: HTTP_TIMEOUT,
    });
  });

  test(`resolver encerra a conversa em ${lado}`, async ({ page, fixture }) => {
    const tenant = fixture.tenants[lado];
    const humana = tenant.conversas.humana;
    await login(page, fixture.atendente.email, fixture.password);
    await trocarPara(page, tenant.orgId);
    await abrirConversa(page, humana.id);
    await expect(estadoNoCabecalho(page)).toHaveText(ESTADO.humano, { timeout: HTTP_TIMEOUT });

    // O "Fechar" herdado pergunta antes; o teste responde como a pessoa.
    page.once("dialog", (dialogo) => void dialogo.accept());
    await page.getByRole("button", { name: "Fechar", exact: true }).click();

    await expect(estadoNoCabecalho(page)).toHaveText(ESTADO.resolvida, { timeout: HTTP_TIMEOUT });
    await expect(estadoNaLista(page, humana.id)).toHaveText(ESTADO.resolvida, {
      timeout: HTTP_TIMEOUT,
    });
  });

  test(`reabrir devolve a conversa ao ator em ${lado}`, async ({ page, fixture }) => {
    const tenant = fixture.tenants[lado];
    const resolvida = tenant.conversas.resolvida;
    await login(page, fixture.atendente.email, fixture.password);
    await trocarPara(page, tenant.orgId);
    await abrirConversa(page, resolvida.id);
    await expect(estadoNoCabecalho(page)).toHaveText(ESTADO.resolvida, { timeout: HTTP_TIMEOUT });

    await page.getByRole("button", { name: "Reabrir", exact: true }).click();

    await expect(estadoNoCabecalho(page)).toHaveText(ESTADO.humano, { timeout: HTTP_TIMEOUT });
    await expect(page.getByTestId("comando-da-conversa")).toContainText(fixture.atendente.nome, {
      timeout: HTTP_TIMEOUT,
    });
    await expect(estadoNaLista(page, resolvida.id)).toHaveText(ESTADO.humano, {
      timeout: HTTP_TIMEOUT,
    });
  });
}
