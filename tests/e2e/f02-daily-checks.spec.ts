import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { expect, test as base, type Page } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { f02E2eSandbox } from "./utils/f02-crm-cadastros";
import { cleanupF02Orders, seedF02Orders, type F02OrdersFixture } from "./utils/f02-crm-orders";

const HTTP_TIMEOUT = 30_000;
const test = base.extend<{ fixture: F02OrdersFixture }>({
  fixture: async ({}, runTest, info) => {
    const fixture = await seedF02Orders();
    try {
      await runTest(fixture);
    } finally {
      const cleanup = await cleanupF02Orders(fixture);
      const db = f02E2eSandbox(),
        orgs = [fixture.orgA, fixture.orgB];
      const tables = [
        "crm_orders",
        "crm_order_check_events",
        "crm_order_check_command_receipts",
      ] as const;
      const remaining = await Promise.all(
        tables.map(async (table) => {
          const query = await db
            .from(table)
            .select("*", { count: "exact", head: true })
            .in("organization_id", orgs);
          return query.error ? -1 : (query.count ?? -1);
        }),
      );
      expect(cleanup).toMatchObject({
        deleted_organizations: 2,
        deleted_users: 2,
        domain_rows_remaining: 0,
      });
      expect(remaining).toEqual([0, 0, 0]);
      await info.attach("sandbox-cleanup", {
        body: JSON.stringify({ ...cleanup, daily_check_rows_remaining: remaining }),
        contentType: "application/json",
      });
    }
  },
});
test.describe.configure({ timeout: 600_000 });

async function login(page: Page, email: string, password: string) {
  await page.goto("/login", { timeout: HTTP_TIMEOUT });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/app/inbox", { timeout: HTTP_TIMEOUT });
}
async function org(page: Page) {
  const response = await page.request.get("/api/v1/auth/interface", { timeout: HTTP_TIMEOUT });
  expect(response.status()).toBe(200);
  return (await response.json()).data.organization_id as string;
}
async function switchTo(page: Page, orgId: string) {
  if ((await org(page)) === orgId) return;
  await page.getByTestId("tenant-switcher").click();
  await Promise.all([
    page.waitForEvent("framenavigated", {
      predicate: (frame) =>
        frame === page.mainFrame() && new URL(frame.url()).pathname === "/app/inbox",
      timeout: HTTP_TIMEOUT,
    }),
    page.getByTestId(`tenant-switcher-item-${orgId}`).click(),
  ]);
  expect(await org(page)).toBe(orgId);
}
async function order(
  page: Page,
  fixture: F02OrdersFixture,
  customer: F02OrdersFixture["customers"]["A"],
  count: number,
  offset: number,
) {
  const items = Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    position: index + 1,
    requested_text: `Linha diária ${fixture.suffix} ${offset + index}`,
    product_id: customer.productId,
    product_name: `Linha diária ${fixture.suffix} ${offset + index}`,
    sale_unit: "cx",
    quantity: "1.000",
    unit_price_cents: 1250,
    currency: "BRL",
  }));
  const draft = await page.request.post("/api/v1/crm-orders/commands", {
    data: {
      command: "create_draft",
      idempotency_key: randomUUID(),
      contact_id: customer.contactId,
      company_id: customer.companyId,
      company_name: `Empresa ${customer.name}`,
      channel: null,
      delivery_date: "2099-01-15",
      currency: "BRL",
      items,
    },
  });
  expect(draft.status()).toBe(201);
  const created = (await draft.json()).data;
  const confirmed = await page.request.post("/api/v1/crm-orders/commands", {
    data: {
      command: "confirm_order",
      idempotency_key: randomUUID(),
      order_id: created.id,
      expected_revision: created.revision,
    },
  });
  expect(confirmed.status()).toBe(200);
  return (await confirmed.json()).data;
}
function localDate(iso: string, zone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
function textFromPdfItems(items: unknown[]) {
  return items
    .map((item) =>
      typeof item === "object" && item !== null && "str" in item && typeof item.str === "string"
        ? `${item.str}${"hasEOL" in item && item.hasEOL ? "\n" : ""}`
        : "",
    )
    .join("");
}
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function dailyMarkers(text: string, suffix: string) {
  const pattern = new RegExp(
    `${escapeRegExp(`Linha diária ${suffix} `)}(\\d(?:\\s*\\d)*)(?=\\s*·)`,
    "g",
  );
  return [...text.matchAll(pattern)].map((match) => Number(match[1]!.replace(/\s/g, "")));
}
async function pdfText(bytes: Buffer) {
  const fonts =
    join(
      dirname(
        createRequire(join(process.cwd(), "package.json")).resolve("pdfjs-dist/package.json"),
      ),
      "standard_fonts",
    ) + sep;
  const task = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: fonts });
  const document = await task.promise;
  try {
    const pages = await Promise.all(
      Array.from({ length: document.numPages }, async (_, index) => {
        const content = await (await document.getPage(index + 1)).getTextContent();
        return textFromPdfItems(content.items);
      }),
    );
    return { pages: document.numPages, text: pages.join("\n") };
  } finally {
    await task.destroy();
  }
}

for (const side of ["A", "B"] as const)
  test(`daily/checks em ${side}`, async ({ page, browser, fixture }, info) => {
    const customer = fixture.customers[side],
      other = fixture.customers[side === "A" ? "B" : "A"];
    await login(page, fixture.manager.email, fixture.password);
    await switchTo(page, customer.orgId);
    const orders = [
      await order(page, fixture, customer, 200, 0),
      await order(page, fixture, customer, 200, 200),
      await order(page, fixture, customer, 101, 400),
    ];

    const delivery = await page.request.get(
      "/api/v1/crm-orders/daily?date=2099-01-15&basis=delivery_date",
    );
    expect(delivery.status()).toBe(200);
    const report = (await delivery.json()).data;
    expect(report).toMatchObject({ criteria: { date: "2099-01-15", basis: "delivery_date" } });
    expect(report.orders.flatMap((entry: { items: unknown[] }) => entry.items)).toHaveLength(501);
    const byCreated = await page.request.get(
      `/api/v1/crm-orders/daily?date=${localDate(orders[0].created_at, report.criteria.timezone)}&basis=created_at`,
    );
    expect(byCreated.status()).toBe(200);
    const createdReport = (await byCreated.json()).data;
    expect(createdReport.criteria).toMatchObject({
      basis: "created_at",
      timezone: report.criteria.timezone,
    });
    expect(
      createdReport.orders.map((entry: { order_id: string }) => entry.order_id).sort(),
    ).toEqual(orders.map((entry) => entry.id).sort());

    const db = f02E2eSandbox();
    const snapshot = async () =>
      Promise.all(
        (
          [
            "crm_orders",
            "crm_order_items",
            "crm_order_events",
            "crm_order_command_receipts",
            "crm_order_check_events",
            "crm_order_check_command_receipts",
            "api_audit_log",
          ] as const
        ).map(async (table) => {
          const result = await db
            .from(table)
            .select("*", { count: "exact", head: true })
            .eq("organization_id", customer.orgId);
          expect(result.error).toBeNull();
          expect(result.count).not.toBeNull();
          return result.count;
        }),
      );
    const beforePrint = await snapshot();
    await page.goto("/app/orders/daily");
    await page.getByLabel("Data", { exact: true }).fill("2099-01-15");
    await page.getByLabel("Critério obrigatório", { exact: true }).selectOption("delivery_date");
    await page.getByRole("button", { name: "Consultar", exact: true }).click();
    await expect(
      page.getByText(`Linha diária ${fixture.suffix} 500`, { exact: false }).first(),
    ).toBeVisible();
    const chromium = page as Page & {
      pdf: (options: { printBackground: boolean }) => Promise<Buffer>;
    };
    const pdf = await chromium.pdf({ printBackground: true });
    await info.attach(`daily-${side}.pdf`, { body: pdf, contentType: "application/pdf" });
    const parsed = await pdfText(pdf);
    expect(parsed.pages).toBeGreaterThan(1);
    expect(report.criteria.organization.id).toBe(customer.orgId);
    expect(parsed.text).toContain(report.criteria.organization.name);
    const markers = dailyMarkers(parsed.text, fixture.suffix);
    expect(markers).toHaveLength(1002);
    expect(markers.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 501 }, (_, index) => [index, index]).flat(),
    );
    await page.evaluate(() => {
      window.print = () => document.documentElement.setAttribute("data-print-called", "true");
    });
    await page.getByRole("button", { name: "Imprimir", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-print-called", "true");
    expect(await snapshot()).toEqual(beforePrint);

    const first = orders[0],
      item = first.items[0],
      key = randomUUID(),
      checkUrl = `/api/v1/crm-orders/${first.id}/checks`;
    const zero = await page.request.post(checkUrl, {
      data: {
        idempotency_key: key,
        expected_revision: first.revision,
        item_id: item.id,
        checked_quantity: "0.000",
      },
    });
    expect(zero.status()).toBe(201);
    expect((await zero.json()).data).toMatchObject({ state: "pending", checked_quantity: "0.000" });
    expect(
      (
        await page.request.post(checkUrl, {
          data: {
            idempotency_key: randomUUID(),
            expected_revision: first.revision,
            item_id: item.id,
            checked_quantity: "0.500",
          },
        })
      ).status(),
    ).toBe(201);
    const replay = await page.request.post(checkUrl, {
      data: {
        idempotency_key: key,
        expected_revision: first.revision,
        item_id: item.id,
        checked_quantity: "0.000",
      },
    });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toMatchObject({ meta: { replayed: true } });
    const complete = await page.request.post(checkUrl, {
      data: {
        idempotency_key: randomUUID(),
        expected_revision: first.revision,
        item_id: item.id,
        checked_quantity: "1.000",
      },
    });
    expect(complete.status()).toBe(201);
    expect((await complete.json()).data).toMatchObject({ state: "checked", sale_unit: "cx" });
    expect(
      (
        await page.request.post("/api/v1/crm-orders/commands", {
          data: {
            command: "edit_order",
            idempotency_key: randomUUID(),
            order_id: first.id,
            expected_revision: first.revision,
            delivery_date: "2099-01-16",
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await page.request.post(checkUrl, {
          data: {
            idempotency_key: randomUUID(),
            expected_revision: first.revision,
            item_id: item.id,
            checked_quantity: "1.000",
          },
        })
      ).status(),
    ).toBe(409);
    const history = await page.request.get(`${checkUrl}?limit=1`);
    expect(history.status()).toBe(200);
    const head = (await history.json()).data;
    expect(head.order_revision).toBe(first.revision + 1);
    expect(
      head.items.find((entry: { item_id: string }) => entry.item_id === item.id),
    ).toMatchObject({ state: "pending", checked_quantity: "0.000", event_id: null });
    expect(head.history).toHaveLength(1);
    expect(head.history[0]).toMatchObject({ order_revision: first.revision, state: "checked" });
    expect(head.next_before_sequence).toEqual(expect.any(String));
    expect(
      (
        await page.request.get(`${checkUrl}?limit=100&before_sequence=${head.next_before_sequence}`)
      ).status(),
    ).toBe(200);
    const uiOrder = orders[1];
    await page.goto(`/app/orders/${uiOrder.id}`);
    await page.getByLabel("Quantidade conferida", { exact: true }).first().fill("1,000");
    const uiSaved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/v1/crm-orders/${uiOrder.id}/checks`,
    );
    await page.getByRole("button", { name: "Registrar conferência", exact: true }).first().click();
    expect((await uiSaved).status()).toBe(201);
    const current = await page.request.get(`/api/v1/crm-orders/${uiOrder.id}/checks`);
    expect(current.status()).toBe(200);
    expect((await current.json()).data.items[0]).toMatchObject({
      state: "checked",
      checked_quantity: "1.000",
    });
    await switchTo(page, other.orgId);
    expect((await page.request.get(checkUrl)).status()).toBe(404);

    if (side === "A") {
      const context = await browser.newContext();
      try {
        const viewer = await context.newPage();
        await login(viewer, fixture.viewer.email, fixture.password);
        await viewer.goto(`/app/orders/${first.id}`);
        await expect(
          viewer.getByRole("region", { name: "Conferência", exact: true }),
        ).toBeVisible();
        await expect(
          viewer.getByRole("button", { name: "Registrar conferência", exact: true }),
        ).toHaveCount(0);
        expect(
          (
            await viewer.request.post(checkUrl, {
              data: {
                idempotency_key: randomUUID(),
                expected_revision: first.revision,
                item_id: item.id,
                checked_quantity: "1.000",
              },
            })
          ).status(),
        ).toBe(403);
      } finally {
        await context.close();
      }
    }
  });
