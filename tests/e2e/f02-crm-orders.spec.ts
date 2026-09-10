import { randomUUID } from "node:crypto";
import { test as base, expect, type Page, type Response } from "@playwright/test";
import { cleanupF02Orders, seedF02Orders, type F02OrdersFixture } from "./utils/f02-crm-orders";

const HTTP_TIMEOUT = 30_000;
const test = base.extend<{ fixture: F02OrdersFixture }>({
  fixture: async ({}, runTest, testInfo) => {
    const fixture = await seedF02Orders();
    try {
      await runTest(fixture);
    } finally {
      const cleanup = await cleanupF02Orders(fixture);
      await testInfo.attach("sandbox-cleanup", {
        body: JSON.stringify(cleanup),
        contentType: "application/json",
      });
    }
  },
});
test.describe.configure({ timeout: 420_000 });

async function complete(response: Response, status = 200) {
  expect(response.status()).toBe(status);
  expect(await response.finished()).toBeNull();
  return response;
}
async function activeOrg(page: Page) {
  const response = await page.request.get("/api/v1/auth/interface", { timeout: HTTP_TIMEOUT });
  expect(response.status()).toBe(200);
  return (await response.json()).data.organization_id as string;
}
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: HTTP_TIMEOUT });
}
async function switchTo(page: Page, orgId: string) {
  if ((await activeOrg(page)) === orgId) return;
  await page.getByTestId("tenant-switcher").click();
  const navigation = page.waitForResponse(
    (response) =>
      response.request().isNavigationRequest() &&
      response.request().frame() === page.mainFrame() &&
      new URL(response.url()).pathname === "/app/inbox",
    { timeout: HTTP_TIMEOUT },
  );
  await page.getByTestId(`tenant-switcher-item-${orgId}`).click();
  await complete(await navigation);
  expect(await activeOrg(page)).toBe(orgId);
}
function nextGet(page: Page, pathname: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && new URL(response.url()).pathname === pathname,
    { timeout: HTTP_TIMEOUT },
  );
}
async function openOrder(page: Page, id: string) {
  const ready = nextGet(page, `/api/v1/crm-orders/${id}`);
  await page.goto(`/app/orders/${id}`, { timeout: HTTP_TIMEOUT });
  await complete(await ready);
  await expect(page.getByTestId("pedido-detalhe")).toBeVisible();
}
async function command(page: Page, name: string, action: () => Promise<void>, orderId?: string) {
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/crm-orders/commands" &&
      response.request().postDataJSON()?.command === name,
    { timeout: HTTP_TIMEOUT },
  );
  const fresh = orderId ? nextGet(page, `/api/v1/crm-orders/${orderId}`) : null;
  await action();
  const response = await complete(await saved, name === "create_draft" ? 201 : 200);
  const data = await response.json();
  if (fresh) await complete(await fresh);
  return data.data;
}

for (const side of ["A", "B"] as const) {
  test(`pedido completo em ${side}: snapshots, estados, histórico e isolamento`, async ({
    page,
    browser,
    fixture,
  }) => {
    const customer = fixture.customers[side];
    const other = fixture.customers[side === "A" ? "B" : "A"];
    await login(page, fixture.manager.email, fixture.password);
    await switchTo(page, customer.orgId);
    const listed = nextGet(page, "/api/v1/crm-orders");
    await page.goto("/app/orders", { timeout: HTTP_TIMEOUT });
    await complete(await listed);
    await page.getByRole("button", { name: "Novo pedido", exact: true }).click();
    const contacts = nextGet(page, "/api/v1/contacts");
    await page.getByLabel("Buscar contato", { exact: true }).fill(customer.name);
    await complete(await contacts);
    await page.getByRole("button", { name: customer.name, exact: true }).click();
    const products = nextGet(page, "/api/v1/products");
    await page
      .getByLabel("Buscar produto", { exact: true })
      .fill(`Produto de pedidos ${side} ${fixture.suffix}`);
    await complete(await products);
    await page
      .getByRole("button", {
        name: `Produto de pedidos ${side} ${fixture.suffix} (PED-${fixture.suffix})`,
        exact: true,
      })
      .click();
    await page.getByLabel("Quantidade", { exact: true }).fill("2 cx");
    await page.getByLabel("Moeda do pedido", { exact: true }).fill("BRL");
    await page
      .getByRole("region", { name: "Novo pedido", exact: true })
      .getByLabel("Entrega em")
      .fill("2026-09-10");
    const refreshed = nextGet(page, "/api/v1/crm-orders");
    const draft = await command(page, "create_draft", () =>
      page.getByRole("button", { name: "Salvar rascunho" }).click(),
    );
    await complete(await refreshed);
    expect(draft).toMatchObject({
      contact_id: customer.contactId,
      revision: 1,
      total_cents: 2500,
      currency: "BRL",
      status: "draft",
      pending: [],
    });
    expect(draft.items[0]).toMatchObject({
      quantity: "2.000",
      sale_unit: "cx",
      unit_price_cents: 1250,
    });
    const itemId = draft.items[0].id;

    await openOrder(page, draft.id);
    const confirmed = await command(
      page,
      "confirm_order",
      () => page.getByRole("button", { name: "Confirmar", exact: true }).click(),
      draft.id,
    );
    expect(confirmed).toMatchObject({ revision: 2, status: "confirmed", total_cents: 2500 });
    const catalog = await page.request.patch(`/api/v1/products/${customer.productId}`, {
      data: { preco_cents: 9999 },
    });
    expect(catalog.status()).toBe(200);
    await page.getByRole("button", { name: "Editar pedido", exact: true }).click();
    await expect(page.getByLabel("Quantidade", { exact: true })).toHaveValue("2,000");
    await expect(page.getByLabel("Buscar contato", { exact: true })).toBeDisabled();
    await page.getByLabel("Quantidade", { exact: true }).fill("3 cx");
    const edited = await command(
      page,
      "edit_order",
      () => page.getByRole("button", { name: "Salvar alterações" }).click(),
      draft.id,
    );
    expect(edited).toMatchObject({ revision: 3, total_cents: 3750, status: "confirmed" });
    expect(edited.items[0]).toMatchObject({
      id: itemId,
      quantity: "3.000",
      unit_price_cents: 1250,
    });
    const stale = await page.request.post("/api/v1/crm-orders/commands", {
      data: {
        command: "edit_order",
        idempotency_key: randomUUID(),
        order_id: draft.id,
        expected_revision: 2,
        delivery_date: "2026-09-11",
      },
    });
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "revision_conflict" } });
    const unchangedAfterConflict = await page.request.get(`/api/v1/crm-orders/${draft.id}`);
    expect(unchangedAfterConflict.status()).toBe(200);
    expect(await unchangedAfterConflict.json()).toMatchObject({
      data: { revision: 3, delivery_date: "2026-09-10" },
    });
    const production = await command(
      page,
      "advance_order",
      () => page.getByRole("button", { name: "Iniciar produção" }).click(),
      draft.id,
    );
    expect(production).toMatchObject({ revision: 4, status: "in_production" });
    const delivered = await command(
      page,
      "advance_order",
      () => page.getByRole("button", { name: "Marcar como entregue" }).click(),
      draft.id,
    );
    expect(delivered).toMatchObject({ revision: 5, status: "delivered", total_cents: 3750 });
    await expect(page.getByRole("button", { name: "Editar pedido", exact: true })).toHaveCount(0);
    const history = await page.request.get(`/api/v1/crm-orders/${draft.id}/events?limit=2`);
    expect(history.status()).toBe(200);
    const events = await history.json();
    const firstPageRevisions = events.data.map(
      (event: { order_revision: number }) => event.order_revision,
    );
    expect(firstPageRevisions).toEqual([5, 4]);
    expect(events.meta).toMatchObject({ has_more: true, before_revision: 4 });
    const olderHistory = await page.request.get(
      `/api/v1/crm-orders/${draft.id}/events?limit=2&before_revision=4`,
    );
    expect(olderHistory.status()).toBe(200);
    const olderEvents = await olderHistory.json();
    const secondPageRevisions = olderEvents.data.map(
      (event: { order_revision: number }) => event.order_revision,
    );
    expect(secondPageRevisions).toEqual([3, 2]);
    expect(
      secondPageRevisions.filter((revision: number) => firstPageRevisions.includes(revision)),
    ).toEqual([]);

    const incompleteCommand = {
      command: "create_draft",
      idempotency_key: randomUUID(),
      contact_id: customer.contactId,
      company_id: null,
      company_name: null,
      channel: null,
      delivery_date: null,
      currency: null,
      items: [],
    };
    const created = await page.request.post("/api/v1/crm-orders/commands", {
      data: incompleteCommand,
    });
    expect(created.status()).toBe(201);
    const incomplete = (await created.json()).data;
    await openOrder(page, incomplete.id);
    await expect(page.getByRole("button", { name: "Confirmar", exact: true })).toBeDisabled();
    const cancelled = await command(
      page,
      "cancel_order",
      () => page.getByRole("button", { name: "Cancelar pedido" }).click(),
      incomplete.id,
    );
    expect(cancelled.status).toBe("cancelled");
    const replay = await page.request.post("/api/v1/crm-orders/commands", {
      data: incompleteCommand,
    });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toMatchObject({
      data: { id: incomplete.id, revision: 1, status: "draft" },
      meta: { replayed: true },
    });

    await switchTo(page, other.orgId);
    for (const url of [`/api/v1/crm-orders/${draft.id}`, `/api/v1/crm-orders/${draft.id}/events`])
      expect((await page.request.get(url)).status()).toBe(404);
    const foreign = await page.request.post("/api/v1/crm-orders/commands", {
      data: {
        command: "cancel_order",
        idempotency_key: randomUUID(),
        order_id: draft.id,
        expected_revision: 5,
      },
    });
    expect(foreign.status()).toBe(404);

    if (side === "A") {
      const context = await browser.newContext();
      try {
        const viewer = await context.newPage();
        await login(viewer, fixture.viewer.email, fixture.password);
        expect(await activeOrg(viewer)).toBe(fixture.orgA);
        await openOrder(viewer, draft.id);
        await expect(viewer.getByRole("button", { name: "Editar pedido" })).toHaveCount(0);
        const denied = await viewer.request.post("/api/v1/crm-orders/commands", {
          data: incompleteCommand,
        });
        expect(denied.status()).toBe(403);
      } finally {
        await context.close();
      }
    }
  });
}
