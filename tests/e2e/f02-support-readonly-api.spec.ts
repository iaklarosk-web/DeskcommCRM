/**
 * F02/T04 — suporte readonly nas APIs comerciais, sem depender de Realtime,
 * WAHA ou outra integração externa. A sessão é aberta e encerrada pela UI real;
 * o Supabase service role existe apenas para semear e provar efeitos no sandbox.
 */
import { randomUUID } from "node:crypto";

import { test as base, expect, type APIResponse, type Page } from "@playwright/test";

import { cleanupF02Orders, seedF02Orders, type F02OrdersFixture } from "./utils/f02-crm-orders";
import { f02E2eSandbox } from "./utils/f02-crm-cadastros";

const HTTP_TIMEOUT = 30_000;

type SupportFixture = F02OrdersFixture & {
  orderIds: Record<"A" | "B", string>;
  noteIds: Record<"A" | "B", string>;
};

const test = base.extend<{ fixture: SupportFixture }>({
  fixture: async ({}, runTest, testInfo) => {
    const baseFixture = await seedF02Orders();
    const db = f02E2eSandbox();
    const orderIds = { A: randomUUID(), B: randomUUID() };
    const noteIds = { A: randomUUID(), B: randomUUID() };
    const fixture: SupportFixture = { ...baseFixture, orderIds, noteIds };
    let scenarioFailure: unknown;

    try {
      const membership = await db
        .from("user_organizations")
        .delete()
        .eq("organization_id", fixture.orgB)
        .eq("user_id", fixture.manager.id);
      if (membership.error) throw membership.error;

      const platformAdmin = await db.from("platform_admins").insert({
        user_id: fixture.manager.id,
        granted_by: fixture.manager.id,
        scope: "full",
        mfa_required: false,
        reason: "F02 T04 E2E support readonly",
      });
      if (platformAdmin.error) throw platformAdmin.error;

      for (const side of ["A", "B"] as const) {
        const customer = fixture.customers[side];
        const order = await db.from("crm_orders").insert({
          id: orderIds[side],
          organization_id: customer.orgId,
          contact_id: customer.contactId,
          company_id: customer.companyId,
          company_name_snapshot: `Empresa ${customer.name}`,
          source: "ui",
          status: "draft",
          revision: 1,
          created_by_actor_type: "user",
          created_by_actor_id: fixture.manager.id,
        });
        if (order.error) throw order.error;
        const note = await db.from("crm_notes").insert({
          id: noteIds[side],
          organization_id: customer.orgId,
          contact_id: customer.contactId,
          order_id: orderIds[side],
          body: `Nota suporte ${side} ${fixture.suffix}`,
          actor_user_id: fixture.manager.id,
        });
        if (note.error) throw note.error;
      }

      await runTest(fixture);
    } catch (error) {
      scenarioFailure = error;
      throw error;
    } finally {
      const cleanupFailures: string[] = [];
      const grant = await db.from("platform_admins").delete().eq("user_id", fixture.manager.id);
      if (grant.error) cleanupFailures.push(`platform_admins: ${grant.error.message}`);
      try {
        const cleanup = await cleanupF02Orders(fixture);
        await testInfo.attach("sandbox-cleanup", {
          body: JSON.stringify(cleanup),
          contentType: "application/json",
        });
        if (cleanup.domain_tables_checked !== 12 || cleanup.domain_rows_remaining !== 0) {
          cleanupFailures.push(`domínio: ${JSON.stringify(cleanup)}`);
        }
      } catch (error) {
        cleanupFailures.push(error instanceof Error ? error.message : String(error));
      }
      if (cleanupFailures.length > 0) {
        await testInfo.attach("sandbox-cleanup-failure", {
          body: cleanupFailures.join("; "),
          contentType: "text/plain",
        });
        if (!scenarioFailure) throw new Error(cleanupFailures.join("; "));
      }
    }
  },
});

test.describe.configure({ timeout: 180_000 });

async function login(page: Page, fixture: F02OrdersFixture) {
  await page.goto("/login", { timeout: HTTP_TIMEOUT });
  await page.locator("#email").fill(fixture.manager.email);
  await page.locator("#password").fill(fixture.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/app/inbox", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });
}

async function activeOrg(page: Page) {
  const response = await page.request.get("/api/v1/auth/interface", {
    timeout: HTTP_TIMEOUT,
  });
  expect(response.status()).toBe(200);
  return (await response.json()).data.organization_id as string;
}

async function startReadonly(page: Page, fixture: SupportFixture) {
  await page.goto(`/admin/tenants/${fixture.orgB}`, { timeout: HTTP_TIMEOUT });
  await page.getByRole("button", { name: /Acompanhar/ }).click();
  await page.getByLabel("Somente leitura", { exact: true }).check();
  // O app navega assim que recebe a resposta. Capture o corpo real antes de
  // entregá-lo ao navegador, que pode descartá-lo durante essa navegação.
  const endpoint = `/api/v1/admin/tenants/${fixture.orgB}/impersonate`;
  let sessionId: string | undefined;
  await page.route(
    `**${endpoint}`,
    async (route) => {
      const response = await route.fetch();
      if (response.status() === 200) {
        sessionId = (await response.json()).data.support_session_id;
      }
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  const pending = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === endpoint,
    { timeout: HTTP_TIMEOUT },
  );
  await page.getByRole("button", { name: "Confirmar e entrar" }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  expect(sessionId).toEqual(expect.any(String));
  await page.waitForURL("**/app/inbox", { timeout: HTTP_TIMEOUT });
  await expect(page.getByRole("button", { name: "Sair do acompanhamento" })).toBeVisible();
  expect(await activeOrg(page)).toBe(fixture.orgB);
  return sessionId!;
}

async function endSupport(page: Page, fixture: SupportFixture, sessionId: string) {
  // A saída também navega imediatamente; conserve a resposta real antes disso.
  let body: unknown;
  await page.route(
    "**/api/v1/admin/impersonate/end",
    async (route) => {
      const response = await route.fetch();
      body = await response.json();
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  const pending = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/admin/impersonate/end",
    { timeout: HTTP_TIMEOUT },
  );
  await page.getByRole("button", { name: "Sair do acompanhamento" }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  expect(body).toMatchObject({ data: { ended: true } });
  await page.waitForURL("**/app/inbox", { timeout: HTTP_TIMEOUT });
  await expect(page.getByRole("button", { name: "Sair do acompanhamento" })).toHaveCount(0);
  expect(await activeOrg(page)).toBe(fixture.orgA);

  const ended = await f02E2eSandbox()
    .from("platform_support_sessions")
    .select("organization_id,actor_user_id,access_mode,ended_at")
    .eq("id", sessionId)
    .single();
  if (ended.error) throw ended.error;
  expect(ended.data).toMatchObject({
    organization_id: fixture.orgB,
    actor_user_id: fixture.manager.id,
    access_mode: "support_readonly",
  });
  expect(ended.data.ended_at).toBeTruthy();
}

async function expectForbidden(
  response: APIResponse,
  code: "forbidden" | "forbidden_role",
): Promise<string> {
  expect(response.status(), response.url()).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code } });
  const requestId = response.headers()["x-request-id"];
  expect(requestId).toEqual(expect.any(String));
  expect(requestId).not.toBe("");
  return requestId!;
}

async function count(table: string, organizationId: string) {
  const result = await f02E2eSandbox()
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  if (result.error || result.count === null)
    throw result.error ?? new Error(`${table} sem contagem`);
  return result.count;
}

test("suporte readonly lê quatro grupos F02, recusa escritas comerciais e audita recusas", async ({
  page,
  fixture,
}) => {
  const db = f02E2eSandbox();
  const own = fixture.customers.B;
  const foreign = fixture.customers.A;
  const membership = await db
    .from("user_organizations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", fixture.orgB)
    .eq("user_id", fixture.manager.id);
  expect(membership.error).toBeNull();
  expect(membership.count).toBe(0);

  await login(page, fixture);
  expect(await activeOrg(page)).toBe(fixture.orgA);
  const supportSessionId = await startReadonly(page, fixture);

  const [contacts, products, orders, notes, foreignNotes] = await Promise.all([
    page.request.get("/api/v1/contacts?limit=100", { timeout: HTTP_TIMEOUT }),
    page.request.get("/api/v1/products?limit=100", { timeout: HTTP_TIMEOUT }),
    page.request.get("/api/v1/crm-orders?limit=100", { timeout: HTTP_TIMEOUT }),
    page.request.get(`/api/v1/crm-notes?contact_id=${own.contactId}&limit=10`, {
      timeout: HTTP_TIMEOUT,
    }),
    page.request.get(`/api/v1/crm-notes?contact_id=${foreign.contactId}&limit=10`, {
      timeout: HTTP_TIMEOUT,
    }),
  ]);
  for (const response of [contacts, products, orders, notes]) {
    expect(response.status(), response.url()).toBe(200);
  }
  expect(foreignNotes.status()).toBe(404);

  const contactRows = (await contacts.json()).data as Array<{ id: string }>;
  const productRows = (await products.json()).data as Array<{ id: string }>;
  const orderRows = (await orders.json()).data as Array<{ id: string }>;
  const noteRows = (await notes.json()).data as Array<{ id: string }>;
  expect(contactRows.map((row) => row.id)).toContain(own.contactId);
  expect(contactRows.map((row) => row.id)).not.toContain(foreign.contactId);
  expect(productRows.map((row) => row.id)).toContain(own.productId);
  expect(productRows.map((row) => row.id)).not.toContain(foreign.productId);
  expect(orderRows.map((row) => row.id)).toContain(fixture.orderIds.B);
  expect(orderRows.map((row) => row.id)).not.toContain(fixture.orderIds.A);
  expect(noteRows.map((row) => row.id)).toEqual([fixture.noteIds.B]);

  const deniedNoteId = randomUUID();
  const deniedCommandId = randomUUID();
  const suppliedRequestId = randomUUID();
  const before = {
    audits: await count("api_audit_log", fixture.orgB),
    products: await count("catalog_products", fixture.orgB),
    orders: await count("crm_orders", fixture.orgB),
    notes: await count("crm_notes", fixture.orgB),
  };
  const originalContact = await db
    .from("contacts")
    .select("display_name")
    .eq("organization_id", fixture.orgB)
    .eq("id", own.contactId)
    .single();
  if (originalContact.error) throw originalContact.error;

  const [contactWrite, productWrite, orderWrite, noteWrite] = await Promise.all([
    page.request.patch(`/api/v1/contacts/${own.contactId}`, {
      data: { display_name: `Alteração negada ${fixture.suffix}` },
      timeout: HTTP_TIMEOUT,
    }),
    page.request.post("/api/v1/products", {
      data: {
        codigo: `NEG-${fixture.suffix}`,
        nome: `Produto negado ${fixture.suffix}`,
        preco_cents: 9900,
        controla_estoque: false,
        quantidade: 0,
      },
      timeout: HTTP_TIMEOUT,
    }),
    page.request.post("/api/v1/crm-orders/commands", {
      data: {
        command: "create_draft",
        idempotency_key: deniedCommandId,
        contact_id: own.contactId,
        company_id: own.companyId,
        company_name: `Empresa ${own.name}`,
        channel: null,
        delivery_date: null,
        currency: null,
        items: [],
      },
      timeout: HTTP_TIMEOUT,
    }),
    page.request.post("/api/v1/crm-notes", {
      headers: { "x-request-id": suppliedRequestId },
      data: {
        id: deniedNoteId,
        contact_id: own.contactId,
        order_id: fixture.orderIds.B,
        body: `Nota negada ${fixture.suffix}`,
      },
      timeout: HTTP_TIMEOUT,
    }),
  ]);
  await expectForbidden(contactWrite, "forbidden");
  await expectForbidden(productWrite, "forbidden");
  // Pedidos e notas consultam requireRole antes da guarda de efeito. Suporte
  // readonly tem papel efetivo viewer e recebe a recusa canônica desse guard.
  const orderDeniedRequestId = await expectForbidden(orderWrite, "forbidden_role");
  const noteDeniedRequestId = await expectForbidden(noteWrite, "forbidden_role");
  expect(noteDeniedRequestId).toBe(suppliedRequestId);

  await expect
    .poll(
      async () => {
        const denied = await db
          .from("api_audit_log")
          .select("request_id,resource_type")
          .eq("organization_id", fixture.orgB)
          .eq("action", "authz.denied")
          .eq("actor_user_id", fixture.manager.id)
          .contains("metadata", {
            required_role: "agent",
            effective_role: "viewer",
            support_session_id: supportSessionId,
            support_access_mode: "support_readonly",
          })
          .in("request_id", [orderDeniedRequestId, noteDeniedRequestId])
          .order("resource_type");
        if (denied.error) throw denied.error;
        return denied.data;
      },
      { timeout: HTTP_TIMEOUT },
    )
    .toEqual([
      { request_id: noteDeniedRequestId, resource_type: "crm_notes" },
      { request_id: orderDeniedRequestId, resource_type: "crm_orders" },
    ]);
  expect(await count("api_audit_log", fixture.orgB)).toBe(before.audits + 2);
  expect(await count("catalog_products", fixture.orgB)).toBe(before.products);
  expect(await count("crm_orders", fixture.orgB)).toBe(before.orders);
  expect(await count("crm_notes", fixture.orgB)).toBe(before.notes);
  const unchangedContact = await db
    .from("contacts")
    .select("display_name")
    .eq("organization_id", fixture.orgB)
    .eq("id", own.contactId)
    .single();
  expect(unchangedContact.error).toBeNull();
  expect(unchangedContact.data).toEqual(originalContact.data);
  const deniedReceipt = await db
    .from("crm_order_command_receipts")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", fixture.orgB)
    .eq("id", deniedCommandId);
  expect(deniedReceipt.error).toBeNull();
  expect(deniedReceipt.count).toBe(0);
  const deniedNote = await db
    .from("crm_notes")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", fixture.orgB)
    .eq("id", deniedNoteId);
  expect(deniedNote.error).toBeNull();
  expect(deniedNote.count).toBe(0);

  await endSupport(page, fixture, supportSessionId);
});
