/**
 * F02/T04 — matriz de organização ativa das APIs comerciais que ainda não
 * tinham prova A/B simétrica. Usa somente o Supabase descartável identificado
 * por `f02E2eSandbox`; o manager é membro das duas organizações.
 */
import { test, expect, type APIResponse, type Page } from "@playwright/test";

import { cleanupF02Orders, seedF02Orders, type F02OrdersFixture } from "./utils/f02-crm-orders";
import { f02E2eSandbox } from "./utils/f02-crm-cadastros";

const HTTP_TIMEOUT = 30_000;
const SIDES = ["A", "B"] as const;
type Side = (typeof SIDES)[number];
const OPERATIONS = [
  "C02 POST contact",
  "C03 GET contact",
  "C04 PATCH contact",
  "C05 DELETE contact",
  "E01 GET companies",
  "E02 POST company",
  "E03 GET company",
  "E04 PATCH company",
  "E05 DELETE company",
  "P02 POST product",
  "P03 PATCH product",
  "P04 DELETE product",
  "L01 GET tasks",
  "L02 POST task",
  "L03 PATCH task",
  "L04 DELETE task",
] as const;
type Operation = (typeof OPERATIONS)[number];

type Created = {
  contactId: string;
  contactName: string;
  companyId: string;
  companyName: string;
  productId: string;
  productName: string;
  taskId: string;
  taskTitle: string;
};

let fixture: F02OrdersFixture;
const created = {} as Record<Side, Created>;
const covered = new Set<string>();

function org(side: Side) {
  return side === "A" ? fixture.orgA : fixture.orgB;
}
function other(side: Side): Side {
  return side === "A" ? "B" : "A";
}
function cover(operation: Operation, side: Side) {
  covered.add(`${operation} @ ${side}`);
}
async function payload<T = unknown>(response: APIResponse) {
  return response.json() as Promise<{ data: T; error?: { code?: string } }>;
}
async function activeOrg(page: Page) {
  const response = await page.request.get("/api/v1/auth/interface", {
    timeout: HTTP_TIMEOUT,
  });
  expect(response.status()).toBe(200);
  return (await payload<{ organization_id: string }>(response)).data.organization_id;
}
async function login(page: Page, user = fixture.manager) {
  await page.goto("/login", { timeout: HTTP_TIMEOUT });
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(fixture.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/app/inbox", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });
}
async function switchTo(page: Page, organizationId: string) {
  if ((await activeOrg(page)) === organizationId) return;
  const switcher = page.getByTestId("tenant-switcher");
  await expect(switcher).toBeVisible();
  await switcher.click();
  const navigated = page.waitForEvent("framenavigated", {
    predicate: (frame) =>
      frame === page.mainFrame() && new URL(frame.url()).pathname === "/app/inbox",
    timeout: HTTP_TIMEOUT,
  });
  await page.getByTestId(`tenant-switcher-item-${organizationId}`).click();
  await navigated;
  await page.waitForLoadState("domcontentloaded");
  await expect.poll(() => activeOrg(page), { timeout: HTTP_TIMEOUT }).toBe(organizationId);
}
async function expectStatus(response: APIResponse, status: number) {
  expect(response.status(), response.url()).toBe(status);
  return payload(response);
}
async function auditCount(resourceId: string) {
  const db = f02E2eSandbox();
  const result = await db
    .from("api_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("resource_id", resourceId);
  if (result.error || result.count === null) throw result.error ?? new Error("audit sem contagem");
  return result.count;
}
async function domainSnapshot(values: Created) {
  const db = f02E2eSandbox();
  const [contact, company, product, task] = await Promise.all([
    db
      .from("contacts")
      .select("id,organization_id,display_name")
      .eq("id", values.contactId)
      .single(),
    db
      .from("crm_companies")
      .select("id,organization_id,legal_name,trade_name")
      .eq("id", values.companyId)
      .single(),
    db
      .from("catalog_products")
      .select("id,organization_id,nome,sale_unit")
      .eq("id", values.productId)
      .single(),
    db.from("crm_tasks").select("id,organization_id,title,status").eq("id", values.taskId).single(),
  ]);
  for (const result of [contact, company, product, task]) {
    if (result.error) throw result.error;
  }
  return {
    contact: contact.data,
    company: company.data,
    product: product.data,
    task: task.data,
    audit: await Promise.all([
      auditCount(values.contactId),
      auditCount(values.companyId),
      auditCount(values.productId),
      auditCount(values.taskId),
    ]),
  };
}

/** Cria, pela API e sob a organização ativa, os quatro recursos descartáveis. */
async function createOwn(page: Page, side: Side) {
  await switchTo(page, org(side));
  const suffix = `${fixture.suffix}-${side}`;

  const contactName = `Matriz contato ${suffix}`;
  const contactResponse = await page.request.post("/api/v1/contacts", {
    data: { display_name: contactName, source: "manual" },
    timeout: HTTP_TIMEOUT,
  });
  const contactBody = await expectStatus(contactResponse, 201);
  const contactId = (contactBody.data as { contact: { id: string } }).contact.id;
  cover("C02 POST contact", side);

  const companyName = `Matriz empresa ${suffix}`;
  const companyResponse = await page.request.post("/api/v1/companies", {
    data: { legal_name: companyName },
    timeout: HTTP_TIMEOUT,
  });
  const companyBody = await expectStatus(companyResponse, 201);
  const companyId = (companyBody.data as { id: string }).id;
  cover("E02 POST company", side);

  const productName = `Matriz produto ${suffix}`;
  const productResponse = await page.request.post("/api/v1/products", {
    data: {
      codigo: `MAT-${suffix}`,
      nome: productName,
      preco_cents: 2718,
      controla_estoque: false,
      quantidade: 0,
    },
    timeout: HTTP_TIMEOUT,
  });
  const productBody = await expectStatus(productResponse, 201);
  const productId = (productBody.data as { id: string }).id;
  cover("P02 POST product", side);

  const taskTitle = `Matriz tarefa ${suffix}`;
  const taskResponse = await page.request.post("/api/v1/tasks", {
    data: { title: taskTitle },
    timeout: HTTP_TIMEOUT,
  });
  const taskBody = await expectStatus(taskResponse, 201);
  const taskId = (taskBody.data as { task: { id: string } }).task.id;
  cover("L02 POST task", side);

  const own = {
    contactId,
    contactName,
    companyId,
    companyName,
    productId,
    productName,
    taskId,
    taskTitle,
  };
  const snapshot = await domainSnapshot(own);
  for (const row of [snapshot.contact, snapshot.company, snapshot.product, snapshot.task]) {
    if (!row) throw new Error(`recurso próprio ${side} não encontrado após criação`);
    expect(row.organization_id).toBe(org(side));
  }
  created[side] = own;
}

async function readAndPatchOwn(page: Page, side: Side) {
  await switchTo(page, org(side));
  const own = created[side];
  const foreign = created[other(side)];

  const ownContact = await page.request.get(`/api/v1/contacts/${own.contactId}`);
  expect(((await expectStatus(ownContact, 200)).data as { id: string }).id).toBe(own.contactId);
  const foreignContact = await page.request.get(`/api/v1/contacts/${foreign.contactId}`);
  await expectStatus(foreignContact, 404);
  cover("C03 GET contact", side);

  own.contactName += " revisado";
  const patchedContact = await page.request.patch(`/api/v1/contacts/${own.contactId}`, {
    data: { display_name: own.contactName },
  });
  expect(
    ((await expectStatus(patchedContact, 200)).data as { display_name: string }).display_name,
  ).toBe(own.contactName);
  cover("C04 PATCH contact", side);

  const companies = await page.request.get(
    `/api/v1/companies?search=${encodeURIComponent("Matriz empresa")}&page=1&limit=50`,
  );
  const companyRows = (await expectStatus(companies, 200)).data as Array<{
    id: string;
  }>;
  expect(companyRows.map((row) => row.id)).toContain(own.companyId);
  expect(companyRows.map((row) => row.id)).not.toContain(foreign.companyId);
  cover("E01 GET companies", side);

  const ownCompany = await page.request.get(`/api/v1/companies/${own.companyId}`);
  expect(((await expectStatus(ownCompany, 200)).data as { id: string }).id).toBe(own.companyId);
  const foreignCompany = await page.request.get(`/api/v1/companies/${foreign.companyId}`);
  await expectStatus(foreignCompany, 404);
  cover("E03 GET company", side);

  own.companyName += " revisada";
  const patchedCompany = await page.request.patch(`/api/v1/companies/${own.companyId}`, {
    data: { legal_name: own.companyName },
  });
  expect(
    ((await expectStatus(patchedCompany, 200)).data as { legal_name: string }).legal_name,
  ).toBe(own.companyName);
  cover("E04 PATCH company", side);

  own.productName += " revisado";
  const patchedProduct = await page.request.patch(`/api/v1/products/${own.productId}`, {
    data: { nome: own.productName, sale_unit: "kit" },
  });
  expect((await expectStatus(patchedProduct, 200)).data).toMatchObject({
    id: own.productId,
    nome: own.productName,
    sale_unit: "kit",
  });
  cover("P03 PATCH product", side);

  const tasks = await page.request.get("/api/v1/tasks?aberto=false");
  const taskRows = ((await expectStatus(tasks, 200)).data as { tasks: Array<{ id: string }> })
    .tasks;
  expect(taskRows.map((row) => row.id)).toContain(own.taskId);
  expect(taskRows.map((row) => row.id)).not.toContain(foreign.taskId);
  cover("L01 GET tasks", side);

  own.taskTitle += " revisada";
  const patchedTask = await page.request.patch(`/api/v1/tasks/${own.taskId}`, {
    data: { title: own.taskTitle },
  });
  expect(
    ((await expectStatus(patchedTask, 200)).data as { task: { title: string } }).task.title,
  ).toBe(own.taskTitle);
  cover("L03 PATCH task", side);
}

/** Todas as recusas usam um alvo que existe na outra organização e medem estado/audit antes/depois. */
async function rejectForeignMutations(page: Page, side: Side) {
  await switchTo(page, org(side));
  const foreign = created[other(side)];
  const before = await domainSnapshot(foreign);

  await expectStatus(
    await page.request.patch(`/api/v1/contacts/${foreign.contactId}`, {
      data: { display_name: `forjado por ${side}` },
    }),
    404,
  );
  await expectStatus(await page.request.delete(`/api/v1/contacts/${foreign.contactId}`), 404);
  cover("C05 DELETE contact", side);

  await expectStatus(
    await page.request.patch(`/api/v1/companies/${foreign.companyId}`, {
      data: { legal_name: `forjada por ${side}` },
    }),
    404,
  );
  await expectStatus(await page.request.delete(`/api/v1/companies/${foreign.companyId}`), 404);
  cover("E05 DELETE company", side);

  await expectStatus(
    await page.request.patch(`/api/v1/products/${foreign.productId}`, {
      data: { nome: `forjado por ${side}` },
    }),
    404,
  );
  await expectStatus(await page.request.delete(`/api/v1/products/${foreign.productId}`), 404);
  cover("P04 DELETE product", side);

  await expectStatus(
    await page.request.patch(`/api/v1/tasks/${foreign.taskId}`, {
      data: { title: `forjada por ${side}` },
    }),
    404,
  );
  await expectStatus(await page.request.delete(`/api/v1/tasks/${foreign.taskId}`), 404);
  cover("L04 DELETE task", side);

  expect(await domainSnapshot(foreign)).toEqual(before);
}

async function deleteOwn(page: Page, side: Side) {
  await switchTo(page, org(side));
  const own = created[side];
  const resourceIds = [own.taskId, own.productId, own.companyId, own.contactId];
  const auditBefore = await Promise.all(resourceIds.map(auditCount));
  await expectStatus(await page.request.delete(`/api/v1/tasks/${own.taskId}`), 200);
  await expectStatus(await page.request.delete(`/api/v1/products/${own.productId}`), 200);
  await expectStatus(await page.request.delete(`/api/v1/companies/${own.companyId}`), 200);
  const contactDelete = await page.request.delete(`/api/v1/contacts/${own.contactId}`);
  expect(contactDelete.status()).toBe(204);

  const db = f02E2eSandbox();
  for (const [table, id] of [
    ["crm_tasks", own.taskId],
    ["catalog_products", own.productId],
    ["crm_companies", own.companyId],
    ["contacts", own.contactId],
  ] as const) {
    const remaining = await db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("id", id);
    if (remaining.error) throw remaining.error;
    expect(remaining.count, `${table}:${id}`).toBe(0);
  }
  expect(await Promise.all(resourceIds.map(auditCount))).toEqual(
    auditBefore.map((count) => count + 1),
  );
}

test.beforeAll(async () => {
  fixture = await seedF02Orders();
});
test.afterAll(async () => {
  if (!fixture) return;
  const cleanup = await cleanupF02Orders(fixture);
  expect(cleanup).toMatchObject({
    domain_tables_checked: 12,
    domain_rows_remaining: 0,
  });
  const settings = await f02E2eSandbox()
    .from("tenant_settings")
    .select("key", { count: "exact", head: true })
    .in("organization_id", [fixture.orgA, fixture.orgB]);
  expect(settings.error).toBeNull();
  expect(settings.count).toBe(0);
});
test.describe.configure({ timeout: 360_000 });

test("matriz API usa a organização ativa em 16 operações nos dois sentidos", async ({ page }) => {
  await login(page);

  for (const side of SIDES) await createOwn(page, side);
  for (const side of SIDES) await readAndPatchOwn(page, side);
  for (const side of SIDES) await rejectForeignMutations(page, side);
  for (const side of SIDES) await deleteOwn(page, side);

  const expected = OPERATIONS.flatMap((operation) =>
    SIDES.map((side) => `${operation} @ ${side}`),
  ).sort();
  expect([...covered].sort()).toEqual(expected);
  expect(covered.size).toBe(32);
});

test("leitores C06 e C07 recusam o contato da outra organização nos dois sentidos", async ({
  page,
}) => {
  await login(page);
  const observed = new Set<string>();
  for (const side of SIDES) {
    await switchTo(page, org(side));
    for (const [operation, reader] of [
      ["C06", "timeline"],
      ["C07", "crm-summary"],
    ] as const) {
      const own = await page.request.get(
        `/api/v1/contacts/${fixture.customers[side].contactId}/${reader}`,
      );
      const ownBody = await expectStatus(own, 200);
      if (reader === "timeline") expect(Array.isArray(ownBody.data)).toBe(true);
      else {
        for (const key of ["leads", "orders", "activities", "demandas", "fatos", "historico"]) {
          expect(Array.isArray((ownBody.data as Record<string, unknown>)[key]), key).toBe(true);
        }
      }
      const foreign = await page.request.get(
        `/api/v1/contacts/${fixture.customers[other(side)].contactId}/${reader}`,
      );
      const foreignBody = await expectStatus(foreign, 404);
      expect(foreignBody.error?.code).toBe("not_found");
      observed.add(`${operation} @ ${side}`);
    }
  }
  expect([...observed].sort()).toEqual(["C06 @ A", "C06 @ B", "C07 @ A", "C07 @ B"]);
});

test("configuração comercial persiste por empresa e viewer não altera", async ({ page }) => {
  await login(page);
  for (const side of SIDES) {
    await switchTo(page, org(side));
    await page.goto("/app/settings/commercial", { waitUntil: "domcontentloaded" });
    const phone = page.getByLabel("Telefone comercial", { exact: true });
    await expect(phone).toBeEnabled();
    await phone.fill(`FICTICIO-${side}-${fixture.suffix}`);
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname === "/api/v1/settings/commercial",
    );
    await page.getByRole("button", { name: "Salvar dados comerciais", exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByRole("status")).toHaveText("Dados comerciais salvos.");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(phone).toHaveValue(`FICTICIO-${side}-${fixture.suffix}`);
  }
  for (const side of SIDES) {
    await switchTo(page, org(side));
    const response = await page.request.get("/api/v1/settings/commercial");
    expect(response.status()).toBe(200);
    expect((await response.json()).data.settings["business.phone"].value).toBe(
      `FICTICIO-${side}-${fixture.suffix}`,
    );
  }
  await page.context().clearCookies();
  await login(page, fixture.viewer);
  await page.goto("/app/settings/commercial", { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Telefone comercial", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Salvar dados comerciais", exact: true }),
  ).toHaveCount(0);
  const viewerOrg = await activeOrg(page);
  const side = viewerOrg === fixture.orgA ? "A" : "B";
  expect([fixture.orgA, fixture.orgB]).toContain(viewerOrg);
  const denied = await page.request.patch("/api/v1/settings/commercial", {
    data: { settings: { "business.phone": "ALTERACAO-NEGADA" } },
  });
  expect(denied.status()).toBe(403);
  const unchanged = await page.request.get("/api/v1/settings/commercial");
  expect(unchanged.status()).toBe(200);
  expect((await unchanged.json()).data.settings["business.phone"].value).toBe(
    `FICTICIO-${side}-${fixture.suffix}`,
  );
});
