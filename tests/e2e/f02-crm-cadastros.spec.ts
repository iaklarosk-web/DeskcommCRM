/**
 * F02 — cadastro comercial em navegador REAL, exclusivamente no sandbox local.
 *
 * Pré-requisito: o root provisiona um projeto Supabase descartável separado do
 * projeto local de desenvolvimento e injeta suas credenciais loopback em
 * `.env.e2e`. Esta spec não inicia, para ou semeia o stack fora desse sandbox.
 */
import { test, expect, type Frame, type Page, type Request } from "@playwright/test";

import { cleanupF02Fixture, seedF02Fixture, type F02Fixture } from "./utils/f02-crm-cadastros";

let fixture: F02Fixture;
const HTTP_TIMEOUT = 30_000;

async function readActiveOrg(page: Page): Promise<string> {
  const response = await page.request.get("/api/v1/auth/interface", { timeout: HTTP_TIMEOUT });
  expect(response.status()).toBe(200);
  return (await response.json()).data.organization_id;
}

async function login(page: Page, email: string) {
  await page.goto("/login", { timeout: HTTP_TIMEOUT });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(fixture.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 30_000 });
  const orgId = await readActiveOrg(page);
  if (email === fixture.viewer.email) expect(orgId).toBe(fixture.orgA);
}

async function switchTo(page: Page, orgId: string) {
  if (await readActiveOrg(page) === orgId) return;
  const switcher = page.getByTestId("tenant-switcher");
  await expect(switcher).toBeVisible();
  await switcher.click();
  const navigation = page.waitForResponse((response) =>
    response.request().isNavigationRequest() && response.request().frame() === page.mainFrame()
    && new URL(response.url()).pathname === "/app/inbox", { timeout: HTTP_TIMEOUT },
  );
  await page.getByTestId(`tenant-switcher-item-${orgId}`).click();
  const document = await navigation;
  expect(document.status()).toBe(200);
  expect(await document.finished()).toBeNull();
  await expect(switcher).toBeEnabled({ timeout: 30_000 });
  expect(await readActiveOrg(page)).toBe(orgId);
}

/** Ignora o refetch da página anterior, que a navegação pode cancelar. */
async function navigateAndWaitForGet(page: Page, pathname: string, navigate: () => Promise<unknown>) {
  let newDocument = false;
  const requests = new Set<Request>();
  const onNavigation = (frame: Frame) => {
    if (frame === page.mainFrame()) newDocument = true;
  };
  const onRequest = (request: Request) => {
    if (newDocument && request.method() === "GET" && new URL(request.url()).pathname === pathname) {
      requests.add(request);
    }
  };
  page.on("framenavigated", onNavigation);
  page.on("request", onRequest);
  try {
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => requests.has(candidate.request()), { timeout: HTTP_TIMEOUT }),
      navigate(),
    ]);
    expect(response.status(), `GET da nova página: ${pathname}`).toBe(200);
    expect(await response.finished()).toBeNull();
    return response;
  } finally {
    page.off("framenavigated", onNavigation);
    page.off("request", onRequest);
  }
}

/** Produtos chega no HTML/RSC do servidor; não dispara GET de catálogo no browser. */
async function loadProducts(page: Page, reload = false) {
  const response = await (reload
    ? page.reload({ timeout: HTTP_TIMEOUT })
    : page.goto("/app/products", { timeout: HTTP_TIMEOUT }));
  expect(response?.status()).toBe(200);
  expect(await response?.finished()).toBeNull();
  await expect(page.getByTestId("tela-produtos")).toBeVisible();
}

test.beforeAll(async () => {
  fixture = await seedF02Fixture();
});
test.afterAll(async () => {
  if (fixture) await cleanupF02Fixture(fixture);
});
test.describe.configure({ timeout: 360_000 });

// Uma jornada com três passos: os dados criados na UI são os medidos nos
// passos seguintes. O restart de worker após falha não fabrica pré-condições.
test("cadastros comerciais persistem, isolam empresas e respeitam viewer", async ({
  page,
  browser,
}) => {
  await test.step("cadastro de empresa e vínculo recorrente", async () => {
    await login(page, fixture.manager.email);
    await switchTo(page, fixture.orgA);

    await navigateAndWaitForGet(page, "/api/v1/companies", () => page.goto("/app/companies", { timeout: HTTP_TIMEOUT }));
    await page.getByTestId("nova-empresa").click();
    await page.getByTestId("empresa-razao-social").fill(`Empresa Cliente ${fixture.suffix}`);
    await page.getByTestId("empresa-nome-fantasia").fill(`Cliente ${fixture.suffix}`);
    await page.getByTestId("empresa-cnpj").fill("12AB3456789012");
    const companyResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/companies") && response.request().method() === "POST",
      { timeout: HTTP_TIMEOUT },
    );
    const refreshedCompanies = page.waitForResponse((response) =>
      response.request().method() === "GET" && new URL(response.url()).pathname === "/api/v1/companies",
      { timeout: HTTP_TIMEOUT },
    );
    await page.getByTestId("salvar-empresa").click();
    const createdCompany = await companyResponse;
    expect(createdCompany.status()).toBe(201);
    const companyBody = (await createdCompany.json()) as { data: { id: string } };
    fixture.companyId = companyBody.data.id;
    const refreshed = await refreshedCompanies;
    expect(refreshed.status()).toBe(200);
    expect((await refreshed.json()).data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: fixture.companyId, legal_name: `Empresa Cliente ${fixture.suffix}` }),
    ]));
    await expect(page.getByText(`Empresa Cliente ${fixture.suffix}`)).toBeVisible();

    // A ficha é a jornada medida; criar o contato por API evita transformar esta
    // prova em cobertura do diálogo de criação, que já tem sua própria suíte.
    const created = await page.request.post("/api/v1/contacts", {
      data: { display_name: `Contato F02 ${fixture.suffix}`, source: "manual" },
      timeout: HTTP_TIMEOUT,
    });
    expect(created.status()).toBe(201);
    fixture.contactId = (
      (await created.json()) as { data: { contact: { id: string } } }
    ).data.contact.id;
    const contactResponse = await navigateAndWaitForGet(
      page, `/api/v1/contacts/${fixture.contactId}`,
      () => page.goto(`/app/contacts/${fixture.contactId}`, { timeout: HTTP_TIMEOUT }),
    );
    expect((await contactResponse.json()).data).toMatchObject({ id: fixture.contactId, company_id: null });
    const searchResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "GET" && url.pathname === "/api/v1/companies"
        && url.searchParams.get("search") === `Empresa Cliente ${fixture.suffix}`;
    }, { timeout: HTTP_TIMEOUT });
    await page.getByTestId("buscar-empresa-vinculo").fill(`Empresa Cliente ${fixture.suffix}`);
    const searched = await searchResponse;
    expect(searched.status()).toBe(200);
    expect((await searched.json()).data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: fixture.companyId, legal_name: `Empresa Cliente ${fixture.suffix}` }),
    ]));
    await expect(
      page.getByTestId("resultados-empresas").getByText(`Empresa Cliente ${fixture.suffix}`),
    ).toBeVisible();
    await page
      .getByTestId("resultados-empresas")
      .getByText(`Empresa Cliente ${fixture.suffix}`)
      .click();
    await page.getByTestId("contato-recorrente").check();
    const savedLink = page.waitForResponse((response) =>
      response.request().method() === "PATCH"
      && new URL(response.url()).pathname === `/api/v1/contacts/${fixture.contactId}`,
      { timeout: HTTP_TIMEOUT },
    );
    await page.getByTestId("salvar-vinculo-comercial").click();
    const saved = await savedLink;
    expect(saved.status()).toBe(200);
    expect((await saved.json()).data).toMatchObject({ company_id: fixture.companyId, recurring: true });
    await expect(page.getByRole("status")).toHaveText("Vínculo comercial atualizado.");
    // A recarga monta a ficha, lê o contato e só então consulta a empresa por ID.
    // Medir essa resposta evita gastar os 5 s do locator nas três etapas de rede.
    const linkedResponse = await navigateAndWaitForGet(
      page, `/api/v1/companies/${fixture.companyId}`, () => page.reload({ timeout: HTTP_TIMEOUT }),
    );
    expect((await linkedResponse.json()).data).toMatchObject({
      id: fixture.companyId,
      legal_name: `Empresa Cliente ${fixture.suffix}`,
    });
    await expect(page.getByTestId("empresa-vinculada")).toHaveText(
      `Empresa Cliente ${fixture.suffix}`,
    );
    await expect(page.getByTestId("contato-recorrente")).toBeChecked();

    const blockedDelete = await page.request.delete(`/api/v1/companies/${fixture.companyId}`, { timeout: HTTP_TIMEOUT });
    expect(blockedDelete.status()).toBe(409);
  });
  await test.step("catálogo e isolamento ao trocar a empresa", async () => {
    await switchTo(page, fixture.orgA);
    await loadProducts(page);
    await page.getByTestId("novo-produto").click();
    await page.getByTestId("produto-codigo").fill(`F02-${fixture.suffix}`);
    await page.getByTestId("produto-nome").fill(`Produto F02 ${fixture.suffix}`);
    await page.getByTestId("produto-preco").fill("19,90");
    await page.getByTestId("produto-unidade-venda").fill("un");
    const createdResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/products") && response.request().method() === "POST",
      { timeout: HTTP_TIMEOUT },
    );
    await page.getByTestId("salvar-produto").click();
    const productResponse = await createdResponse;
    expect(productResponse.status()).toBe(201);
    const created = (await productResponse.json()) as {
      data: { id: string; preco_cents: number; quantidade: number; controla_estoque: boolean };
    };
    fixture.productId = created.data.id;

    // A tela atual cria e exibe unidade, mas não expõe edição de produto. O PATCH
    // autenticado mede o contrato que a UI usa, e a recarga mede a exibição real.
    const changed = await page.request.patch(`/api/v1/products/${fixture.productId}`, {
      data: { sale_unit: "caixa" },
      timeout: HTTP_TIMEOUT,
    });
    expect(changed.status()).toBe(200);
    const after = (await changed.json()) as {
      data: {
        preco_cents: number;
        quantidade: number;
        controla_estoque: boolean;
        sale_unit: string;
      };
    };
    expect(after.data).toMatchObject({
      preco_cents: created.data.preco_cents,
      quantidade: created.data.quantidade,
      controla_estoque: created.data.controla_estoque,
      sale_unit: "caixa",
    });
    const productRead = await page.request.get(`/api/v1/products?busca=F02-${fixture.suffix}`, { timeout: HTTP_TIMEOUT });
    expect(productRead.status()).toBe(200);
    expect((await productRead.json()).data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: fixture.productId, sale_unit: "caixa" }),
    ]));
    await loadProducts(page, true);
    await expect(page.getByTestId(`produto-F02-${fixture.suffix}`)).toContainText("caixa");

    await switchTo(page, fixture.orgB);
    const companiesB = await page.request.get(
      `/api/v1/companies?search=${encodeURIComponent(`Empresa Cliente ${fixture.suffix}`)}&page=1&limit=50`,
      { timeout: HTTP_TIMEOUT },
    );
    expect(companiesB.status()).toBe(200);
    expect(((await companiesB.json()) as { data: unknown[] }).data).toEqual([]);
    const contactB = await page.request.get(`/api/v1/contacts/${fixture.contactId}`, { timeout: HTTP_TIMEOUT });
    expect(contactB.status()).toBe(404);
    const productsB = await page.request.get(`/api/v1/products?busca=F02-${fixture.suffix}`, { timeout: HTTP_TIMEOUT });
    expect(productsB.status()).toBe(200);
    expect((await productsB.json()).data).toEqual([]);
    await loadProducts(page);
    await expect(page.getByTestId(`produto-F02-${fixture.suffix}`)).toHaveCount(0);
  });
  await test.step("viewer lê e não altera", async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await login(page, fixture.viewer.email);
      await navigateAndWaitForGet(page, "/api/v1/companies", () => page.goto("/app/companies", { timeout: HTTP_TIMEOUT }));
      await expect(page.getByText(`Empresa Cliente ${fixture.suffix}`)).toBeVisible();
      await expect(page.getByTestId("nova-empresa")).toHaveCount(0);
      const companyWrite = await page.request.post("/api/v1/companies", {
        data: { legal_name: "Bloqueada" },
        timeout: HTTP_TIMEOUT,
      });
      expect(companyWrite.status()).toBe(403);
      await navigateAndWaitForGet(
        page, `/api/v1/companies/${fixture.companyId}`, () => page.goto(`/app/contacts/${fixture.contactId}`, { timeout: HTTP_TIMEOUT }),
      );
      await expect(page.getByTestId("empresa-vinculada")).toHaveText(`Empresa Cliente ${fixture.suffix}`);
      await expect(page.getByTestId("buscar-empresa-vinculo")).toHaveCount(0);
      const contactWrite = await page.request.patch(`/api/v1/contacts/${fixture.contactId}`, {
        data: { recurring: false },
        timeout: HTTP_TIMEOUT,
      });
      expect(contactWrite.status()).toBe(403);
    } finally {
      await context.close();
    }
  });
});
