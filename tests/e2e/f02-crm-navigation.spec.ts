import { randomUUID } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";
import { f02E2eSandbox } from "./utils/f02-crm-cadastros";
import { cleanupF02Orders, seedF02Orders, type F02OrdersFixture } from "./utils/f02-crm-orders";

// Preparação T05/T06: somente sandbox descartável, sem canais/IA/cobrança reais.
// O fixture guard exige URL local + marcador explícito antes de criar registros.
const HTTP_TIMEOUT = 30_000;
const test = base.extend<{ fixture: F02OrdersFixture }>({
  fixture: async ({}, runTest, info) => {
    const fixture = await seedF02Orders();
    try {
      await runTest(fixture);
    } finally {
      const cleanup = await cleanupF02Orders(fixture);
      await info.attach("sandbox-cleanup", {
        body: JSON.stringify(cleanup),
        contentType: "application/json",
      });
      expect(cleanup).toEqual({
        deleted_organizations: 2,
        deleted_users: 2,
        domain_tables_checked: 12,
        domain_rows_remaining: 0,
      });
    }
  },
});
test.describe.configure({ timeout: 480_000 });

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
async function org(page: Page) {
  const response = await page.request.get("/api/v1/auth/interface", {
    timeout: HTTP_TIMEOUT,
  });
  expect(response.status()).toBe(200);
  return (await response.json()).data.organization_id as string;
}
async function switchTo(page: Page, id: string) {
  if ((await org(page)) === id) return;
  await page.getByTestId("tenant-switcher").click();
  // Trocar o cookie no servidor antecede window.location.assign. Esperar só a
  // API confirmaria o tenant antes de o documento novo terminar de navegar.
  await Promise.all([
    page.waitForEvent("framenavigated", {
      predicate: (frame) =>
        frame === page.mainFrame() && new URL(frame.url()).pathname === "/app/inbox",
      timeout: HTTP_TIMEOUT,
    }),
    page.getByTestId(`tenant-switcher-item-${id}`).click(),
  ]);
  await page.waitForLoadState("domcontentloaded");
  await expect.poll(() => org(page), { timeout: HTTP_TIMEOUT }).toBe(id);
}

for (const side of ["A", "B"] as const) {
  test(`perfil, empresa e catálogo completo em ${side}`, async ({
    page,
    browser,
    fixture,
  }, info) => {
    const customer = fixture.customers[side];
    const other = fixture.customers[side === "A" ? "B" : "A"];
    if (side === "B") {
      const membership = await f02E2eSandbox().from("user_organizations").insert({
        organization_id: customer.orgId,
        user_id: fixture.viewer.id,
        role: "viewer",
        accepted_at: new Date().toISOString(),
      });
      if (membership.error) throw membership.error;
    }
    await login(page, fixture.manager.email, fixture.password);
    await switchTo(page, customer.orgId);

    await test.step("pedido começa na ficha e guarda empresa/canal declarados", async () => {
      await page.goto(`/app/contacts/${customer.contactId}`);
      await page.getByRole("tab", { name: "Pedidos", exact: true }).click();
      const panel = page.locator('[aria-label="Pedidos do contato"]');
      await expect(panel.getByText("Nenhum pedido encontrado.", { exact: true })).toBeVisible();
      // Falha sintética somente na leitura: a recarga seguinte usa a API real.
      const reader = (url: URL) =>
        url.pathname === "/api/v1/crm-orders" &&
        url.searchParams.get("contact_id") === customer.contactId;
      await page.route(reader, (route) =>
        route.fulfill({
          status: 503,
          json: {
            error: {
              code: "upstream_unavailable",
              message: "Falha fictícia de leitura.",
            },
          },
        }),
      );
      await page.reload();
      await page.getByRole("tab", { name: "Pedidos", exact: true }).click();
      await expect(panel.getByRole("alert")).toBeVisible();
      await expect(panel.getByText("Nenhum pedido encontrado.", { exact: true })).toHaveCount(0);
      await page.unroute(reader);
      await panel.getByRole("button", { name: "Tentar novamente", exact: true }).click();
      await expect(panel.getByText("Nenhum pedido encontrado.", { exact: true })).toBeVisible();
      await page
        .getByRole("link", {
          name: "Novo pedido para este contato",
          exact: true,
        })
        .click();
      const form = page.getByRole("region", {
        name: "Novo pedido",
        exact: true,
      });
      await expect(form).toBeVisible();
      await expect(form.getByText(customer.name, { exact: true })).toBeVisible();
      await expect(
        form.getByText("Pedido sem empresa selecionada.", { exact: true }),
      ).toBeVisible();
      await expect(form.getByLabel("Canal declarado (opcional)", { exact: true })).toHaveValue("");
      await form.getByRole("button", { name: "Usar empresa do contato", exact: true }).click();
      await expect(form.getByLabel("Nome da empresa no pedido", { exact: true })).toHaveValue(
        `Empresa ${customer.name}`,
      );
      const snapshotName = `Empresa declarada ${side} ${fixture.suffix}`;
      await form.getByLabel("Nome da empresa no pedido", { exact: true }).fill(snapshotName);
      await form.getByLabel("Canal declarado (opcional)", { exact: true }).fill("balcão fictício");
      await form
        .getByLabel("Buscar produto", { exact: true })
        .fill(`Produto de pedidos ${side} ${fixture.suffix}`);
      await form
        .getByRole("button", {
          name: `Produto de pedidos ${side} ${fixture.suffix} (PED-${fixture.suffix})`,
          exact: true,
        })
        .click();
      await form.getByLabel("Quantidade", { exact: true }).fill("2 cx");
      await form.getByLabel("Moeda do pedido", { exact: true }).fill("BRL");
      await form.getByLabel("Entrega em", { exact: true }).fill("2026-09-10");
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/v1/crm-orders/commands" &&
          response.request().postDataJSON()?.command === "create_draft",
      );
      await form.getByRole("button", { name: "Salvar rascunho", exact: true }).click();
      const response = await saved;
      expect(response.status()).toBe(201);
      const draft = (await response.json()).data;
      expect(draft).toMatchObject({
        contact_id: customer.contactId,
        company_id: customer.companyId,
        company_name: snapshotName,
        channel: "balcão fictício",
        total_cents: 2500,
        status: "draft",
      });
      await page.goto(`/app/orders/${draft.id}`);
      const detail = page.getByTestId("pedido-detalhe");
      await expect(detail).toBeVisible({ timeout: HTTP_TIMEOUT });
      await expect(detail.locator("header p")).toHaveText(`${snapshotName} · Rascunho`);
      await expect(detail.getByRole("link", { name: customer.name, exact: true })).toBeVisible();
      await expect(
        detail.getByText("Canal declarado: balcão fictício", { exact: true }),
      ).toBeVisible();
      await page.goto(`/app/contacts/${customer.contactId}`);
      await page.getByRole("tab", { name: "Pedidos", exact: true }).click();
      await expect(
        page
          .locator('[aria-label="Pedidos do contato"]')
          .locator(`a[href="/app/orders/${draft.id}"]`),
      ).toBeVisible();
      await info.attach(`perfil-pedidos-${side}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    });

    await test.step("busca literal e paginação alcançam além das primeiras 500 posições", async () => {
      const db = f02E2eSandbox();
      const standard = {
        organization_id: customer.orgId,
        preco_cents: 100,
        moeda: "BRL",
        sale_unit: "un",
        ativo: true,
      };
      const filler = Array.from({ length: 501 }, (_, index) => ({
        ...standard,
        id: randomUUID(),
        codigo: `FILL-${fixture.suffix}-${index}`,
        nome: `AAA catálogo ${String(index).padStart(3, "0")}`,
      }));
      const last = {
        ...standard,
        id: randomUUID(),
        codigo: `ULTIMO-${fixture.suffix}`,
        nome: `ZZZ fora das primeiras 500 ${fixture.suffix}`,
      };
      const literals = [
        "AB*CD",
        "100%_A",
        'Aspas " (valor), barra\\fim',
        'x\",organization_id.neq.y',
      ];
      const literalRows = literals.map((nome, index) => ({
        ...standard,
        id: randomUUID(),
        codigo: `LITERAL-${fixture.suffix}-${index}`,
        nome,
      }));
      const decoys = ["ABqualquerCD", "100qualquerXA"].map((nome, index) => ({
        ...standard,
        id: randomUUID(),
        codigo: `DECOY-${fixture.suffix}-${index}`,
        nome,
      }));
      const inserted = await db
        .from("catalog_products")
        .insert([...filler, last, ...literalRows, ...decoys]);
      if (inserted.error) throw inserted.error;
      const foreign = await db.from("catalog_products").insert({
        ...standard,
        organization_id: other.orgId,
        id: randomUUID(),
        codigo: `FOREIGN-${fixture.suffix}`,
        nome: last.nome,
      });
      if (foreign.error) throw foreign.error;

      // Prova que o alvo realmente está fora do lote legado de 500, e não
      // apenas fora da primeira página de 50 apresentada pela nova UI.
      const defaultPage = await page.request.get("/api/v1/products");
      expect(defaultPage.status()).toBe(200);
      const defaultBody = await defaultPage.json();
      expect(defaultBody.meta).toMatchObject({
        total: filler.length + literalRows.length + decoys.length + 2,
        has_more: true,
      });
      expect(defaultBody.data).toHaveLength(500);
      expect(defaultBody.data.map((row: { id: string }) => row.id)).not.toContain(last.id);

      for (const expected of [...literalRows, last]) {
        const result = await page.request.get(
          `/api/v1/products?busca=${encodeURIComponent(expected.nome)}&limit=50`,
        );
        expect(result.status()).toBe(200);
        const body = await result.json();
        expect(body.meta).toMatchObject({ total: 1, has_more: false });
        expect(body.data.map((row: { id: string }) => row.id)).toEqual([expected.id]);
      }
      const first = await page.request.get("/api/v1/products?page=1&limit=50&busca=AAA");
      const second = await page.request.get("/api/v1/products?page=2&limit=50&busca=AAA");
      expect(first.status()).toBe(200);
      expect(second.status()).toBe(200);
      const a = await first.json(),
        b = await second.json();
      expect(a.meta).toMatchObject({ total: 501, has_more: true });
      expect(b.meta).toMatchObject({ total: 501, has_more: true });
      expect(a.data).toHaveLength(50);
      expect(b.data).toHaveLength(50);
      expect(new Set([...a.data, ...b.data].map((row: { id: string }) => row.id)).size).toBe(100);
      await page.goto("/app/products");
      await expect(page.getByTestId(`produto-FILL-${fixture.suffix}-0`)).toBeVisible();
      await expect(page.getByTestId(`produto-${last.codigo}`)).toHaveCount(0);
      await page.getByTestId("busca-produto").fill("AAA");
      await page.getByRole("button", { name: "Buscar", exact: true }).click();
      const pagination = page.getByRole("navigation", {
        name: "Paginação do catálogo",
        exact: true,
      });
      await expect(pagination.getByText("Página 1 · 501 produtos", { exact: true })).toBeVisible();
      await pagination.getByRole("button", { name: "Próxima", exact: true }).click();
      await expect(page.getByTestId(`produto-FILL-${fixture.suffix}-50`)).toBeVisible();
      await expect(page.getByTestId(`produto-FILL-${fixture.suffix}-0`)).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get("page")).toBe("2");
      expect(new URL(page.url()).searchParams.get("busca")).toBe("AAA");
      await page.getByTestId("busca-produto").fill(last.nome);
      await page.getByRole("button", { name: "Buscar", exact: true }).click();
      await expect(page.getByTestId(`produto-${last.codigo}`)).toBeVisible();
      await info.attach(`catalogo-busca-completa-${side}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    });

    await test.step("viewer mantém leitura sem controles de escrita", async () => {
      const context = await browser.newContext({
        baseURL: new URL(page.url()).origin,
      });
      try {
        const viewer = await context.newPage();
        await login(viewer, fixture.viewer.email, fixture.password);
        await switchTo(viewer, customer.orgId);
        await viewer.goto(`/app/contacts/${customer.contactId}`);
        await viewer.getByRole("tab", { name: "Pedidos", exact: true }).click();
        await expect(viewer.locator('[aria-label="Pedidos do contato"]')).toBeVisible();
        // Ausência de botões só conta depois que a leitura real terminou.
        await expect(
          viewer.locator('[aria-label="Pedidos do contato"] a[href^="/app/orders/"]'),
        ).toHaveCount(1);
        await expect(
          viewer.getByRole("link", {
            name: "Novo pedido para este contato",
            exact: true,
          }),
        ).toHaveCount(0);
        await expect(viewer.getByRole("button", { name: "Editar", exact: true })).toHaveCount(0);
        await viewer.goto("/app/contacts");
        await expect(viewer.getByRole("heading", { name: "Contatos", exact: true })).toBeVisible();
        await expect(viewer.getByText(customer.name, { exact: true })).toBeVisible();
        await expect(viewer.getByRole("button", { name: "Novo contato", exact: true })).toHaveCount(
          0,
        );
        await expect(viewer.getByRole("button", { name: "Importar CSV", exact: true })).toHaveCount(
          0,
        );
        await viewer.goto("/app/products");
        await expect(viewer.getByTestId(`produto-FILL-${fixture.suffix}-0`)).toBeVisible();
        await expect(viewer.getByTestId("novo-produto")).toHaveCount(0);
        await expect(viewer.getByTestId("importar-planilha")).toHaveCount(0);
        await expect(viewer.getByTestId(`alternar-FILL-${fixture.suffix}-0`)).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  });
}
