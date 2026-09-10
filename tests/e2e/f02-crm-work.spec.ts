/**
 * F02-T03 — notas e tarefas de pedido no navegador real, somente no sandbox.
 *
 * O pedido é uma precondição criada pela API já coberta na T02. Esta jornada
 * começa na tela do pedido e mede o trabalho novo sem fabricar lead.
 */
import { randomUUID } from "node:crypto";
import { test as base, expect, type Page, type Response } from "@playwright/test";

import { f02E2eSandbox } from "./utils/f02-crm-cadastros";
import { cleanupF02Orders, seedF02Orders, type F02OrdersFixture } from "./utils/f02-crm-orders";

const HTTP_TIMEOUT = 30_000;
const test = base.extend<{ fixture: F02OrdersFixture }>({
  fixture: async ({}, runTest, testInfo) => {
    const fixture = await seedF02Orders();
    try {
      await runTest(fixture);
    } finally {
      const cleanup = await cleanupF02Orders(fixture);
      expect(cleanup).toMatchObject({
        domain_tables_checked: 12,
        domain_rows_remaining: 0,
      });
      await testInfo.attach("sandbox-cleanup", {
        body: JSON.stringify(cleanup),
        contentType: "application/json",
      });
    }
  },
});
test.describe.configure({ timeout: 480_000 });

async function complete(response: Response, status = 200) {
  expect(response.status()).toBe(status);
  expect(await response.finished()).toBeNull();
  return response;
}

async function activeOrg(page: Page): Promise<string> {
  const response = await page.request.get("/api/v1/auth/interface", { timeout: HTTP_TIMEOUT });
  expect(response.status()).toBe(200);
  return (await response.json()).data.organization_id as string;
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login", { timeout: HTTP_TIMEOUT });
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

async function createOrder(
  page: Page,
  customer: F02OrdersFixture["customers"]["A"],
): Promise<string> {
  const response = await page.request.post("/api/v1/crm-orders/commands", {
    data: {
      command: "create_draft",
      idempotency_key: randomUUID(),
      contact_id: customer.contactId,
      company_id: customer.companyId,
      company_name: `Empresa ${customer.name}`,
      channel: null,
      delivery_date: null,
      currency: null,
      items: [],
    },
    timeout: HTTP_TIMEOUT,
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data.id as string;
}

async function openOrder(page: Page, orderId: string) {
  const ready = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === `/api/v1/crm-orders/${orderId}`,
    { timeout: HTTP_TIMEOUT },
  );
  await page.goto(`/app/orders/${orderId}`, { timeout: HTTP_TIMEOUT });
  await complete(await ready);
  await expect(page.getByTestId("pedido-detalhe")).toBeVisible();
  await expect(page.getByText("Nenhuma nota registrada.")).toBeVisible();
  await expect(page.getByText("Nenhuma tarefa neste pedido.")).toBeVisible();
  await expect(page.getByText("Nenhum evento de tarefa registrado.")).toBeVisible();
}

async function uiWorkCommand(
  page: Page,
  command: string,
  action: () => Promise<void>,
  status = 200,
) {
  const pending = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/tasks/commands" &&
      response.request().postDataJSON()?.command === command,
    { timeout: HTTP_TIMEOUT },
  );
  await action();
  const response = await complete(await pending, status);
  return {
    payload: response.request().postDataJSON() as Record<string, unknown>,
    body: (await response.json()) as {
      data: { task_id: string; task_revision: number; status: string };
      meta?: { replayed?: boolean };
    },
  };
}

async function setTaskStatus(page: Page, title: string, status: string) {
  return uiWorkCommand(page, "set_linked_task_status", async () => {
    await page.getByRole("combobox", { name: `Situação da tarefa: ${title}` }).selectOption(status);
  });
}

for (const side of ["A", "B"] as const) {
  const legacyScope = side === "A" ? " e legado" : "";
  test(`trabalho do pedido em ${side}: nota, revisões, isolamento${legacyScope}`, async ({
    page,
    browser,
    fixture,
  }, testInfo) => {
    const customer = fixture.customers[side];
    const other = fixture.customers[side === "A" ? "B" : "A"];
    const noteText = `Nota do pedido ${side} ${fixture.suffix}`;
    const initialTitle = `Separar volumes ${side} ${fixture.suffix}`;
    const finalTitle = `Conferir volumes ${side} ${fixture.suffix}`;

    await login(page, fixture.manager.email, fixture.password);
    await switchTo(page, customer.orgId);
    const orderId = await createOrder(page, customer);
    await openOrder(page, orderId);

    const noteWrite = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/crm-notes",
      { timeout: HTTP_TIMEOUT },
    );
    await page.getByLabel("Nova nota").fill(noteText);
    await page.getByRole("button", { name: "Salvar nota" }).click();
    const noteResponse = await complete(await noteWrite, 201);
    const notePayload = noteResponse.request().postDataJSON() as {
      id: string;
      contact_id: string;
      order_id: string;
      body: string;
    };
    expect(notePayload).toEqual({
      id: expect.any(String),
      contact_id: customer.contactId,
      order_id: orderId,
      body: noteText,
    });
    await expect(page.getByText(noteText, { exact: true })).toBeVisible();
    const noteReplay = await page.request.post("/api/v1/crm-notes", {
      data: notePayload,
      timeout: HTTP_TIMEOUT,
    });
    expect(noteReplay.status()).toBe(200);
    expect(await noteReplay.json()).toMatchObject({
      data: { id: notePayload.id, contact_id: customer.contactId, order_id: orderId },
      meta: { replayed: true },
    });

    await page.getByLabel("Título da tarefa").fill(initialTitle);
    await page.getByLabel("Descrição da tarefa").fill("Conferir a separação física.");
    await page.getByLabel("Prazo da tarefa").fill("2026-09-12T09:30");
    const created = await uiWorkCommand(
      page,
      "create_linked_task",
      () => page.getByRole("button", { name: "Salvar tarefa" }).click(),
      201,
    );
    expect(created.body.data).toMatchObject({ task_revision: 1, status: "pending" });
    const taskId = created.body.data.task_id;
    expect(created.payload).toMatchObject({
      command_id: expect.any(String),
      order_id: orderId,
      title: initialTitle,
    });
    await expect(page.getByText(initialTitle, { exact: true })).toBeVisible();
    const taskReplay = await page.request.post("/api/v1/tasks/commands", {
      data: created.payload,
      timeout: HTTP_TIMEOUT,
    });
    expect(taskReplay.status()).toBe(200);
    expect(await taskReplay.json()).toMatchObject({
      data: { task_id: taskId, task_revision: 1, status: "pending" },
      meta: { replayed: true },
    });

    await page.getByRole("button", { name: "Editar tarefa" }).click();
    await page.getByLabel("Título da tarefa").fill(finalTitle);
    await page.getByLabel("Descrição da tarefa").fill("Snapshot atual sem lead fictício.");
    const edited = await uiWorkCommand(page, "edit_linked_task", () =>
      page.getByRole("button", { name: "Salvar tarefa" }).click(),
    );
    expect(edited.body.data).toMatchObject({ task_id: taskId, task_revision: 2 });
    await expect(page.getByText(finalTitle, { exact: true })).toBeVisible();

    const inProgress = await setTaskStatus(page, finalTitle, "in_progress");
    expect(inProgress.body.data).toMatchObject({ task_revision: 3, status: "in_progress" });
    const done = await setTaskStatus(page, finalTitle, "done");
    expect(done.body.data).toMatchObject({ task_revision: 4, status: "done" });
    const cancelled = await setTaskStatus(page, finalTitle, "cancelled");
    expect(cancelled.body.data).toMatchObject({ task_revision: 5, status: "cancelled" });
    const reopened = await setTaskStatus(page, finalTitle, "pending");
    expect(reopened.body.data).toMatchObject({ task_revision: 6, status: "pending" });

    const stale = await page.request.post("/api/v1/tasks/commands", {
      data: {
        command_id: randomUUID(),
        command: "set_linked_task_status",
        task_id: taskId,
        expected_revision: 5,
        status: "done",
      },
      timeout: HTTP_TIMEOUT,
    });
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "revision_conflict" } });

    const taskRead = await page.request.get(`/api/v1/crm-orders/${orderId}/tasks`, {
      timeout: HTTP_TIMEOUT,
    });
    expect(taskRead.status()).toBe(200);
    expect(await taskRead.json()).toMatchObject({
      data: [
        {
          id: taskId,
          order_id: orderId,
          contact_id: customer.contactId,
          title: finalTitle,
          description: "Snapshot atual sem lead fictício.",
          status: "pending",
          revision: 6,
        },
      ],
    });
    const history = await page.request.get(
      `/api/v1/crm-task-events?contact_id=${customer.contactId}&order_id=${orderId}&limit=25`,
      { timeout: HTTP_TIMEOUT },
    );
    expect(history.status()).toBe(200);
    const historyBody = (await history.json()) as {
      data: Array<{
        id: string;
        task_id: string;
        task_revision: number;
        from_status: string | null;
        to_status: string;
      }>;
    };
    expect(historyBody.data).toHaveLength(6);
    expect(
      historyBody.data.map(({ task_revision }) => task_revision).sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4, 5, 6]);
    expect(historyBody.data.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        String(created.payload.command_id),
        String(edited.payload.command_id),
        String(cancelled.payload.command_id),
        String(reopened.payload.command_id),
      ]),
    );
    expect(historyBody.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ task_revision: 5, from_status: "done", to_status: "cancelled" }),
        expect.objectContaining({
          task_revision: 6,
          from_status: "cancelled",
          to_status: "pending",
        }),
      ]),
    );
    await expect(page.getByText(/Revisão da tarefa: 6/)).toBeVisible();
    await expect(page.getByText("Cancelada → Pendente", { exact: true })).toBeVisible();
    await testInfo.attach(`pedido-${side}-notas-tarefas-historico`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    const db = f02E2eSandbox();
    const [storedTask, fictitiousLead] = await Promise.all([
      db
        .from("crm_tasks")
        .select("id,organization_id,order_id,contact_id,lead_id,revision")
        .eq("organization_id", customer.orgId)
        .eq("id", taskId)
        .single(),
      db
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", customer.orgId)
        .eq("contact_id", customer.contactId),
    ]);
    expect(storedTask.error).toBeNull();
    expect(storedTask.data).toMatchObject({
      id: taskId,
      order_id: orderId,
      contact_id: customer.contactId,
      lead_id: null,
      revision: 6,
    });
    expect(fictitiousLead.error).toBeNull();
    expect(fictitiousLead.count).toBe(0);

    const contactReady = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === `/api/v1/contacts/${customer.contactId}`,
      { timeout: HTTP_TIMEOUT },
    );
    await page.goto(`/app/contacts/${customer.contactId}`, { timeout: HTTP_TIMEOUT });
    await complete(await contactReady);
    await page.getByRole("tab", { name: "Notas", exact: true }).click();
    await expect(page.getByText(noteText, { exact: true })).toBeVisible();
    await testInfo.attach(`perfil-cliente-${side}-nota`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    if (side === "A") {
      const linkedPatch = await page.request.patch(`/api/v1/tasks/${taskId}`, {
        data: { title: "Atalho legado recusado" },
        timeout: HTTP_TIMEOUT,
      });
      expect(linkedPatch.status()).toBe(409);
      expect(await linkedPatch.json()).toMatchObject({
        error: {
          code: "state_conflict",
          message: "Esta tarefa pertence a um pedido. Use o pedido para alterá-la.",
        },
      });
      const linkedDelete = await page.request.delete(`/api/v1/tasks/${taskId}`, {
        timeout: HTTP_TIMEOUT,
      });
      expect(linkedDelete.status()).toBe(409);

      const tasksReady = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          new URL(response.url()).pathname === "/api/v1/tasks",
        { timeout: HTTP_TIMEOUT },
      );
      await page.goto("/app/tasks", { timeout: HTTP_TIMEOUT });
      await complete(await tasksReady);
      await expect(page.getByText(finalTitle, { exact: true })).toBeVisible();
      const orderLink = page.getByRole("link", { name: "Gerenciar no pedido" });
      await expect(orderLink).toHaveAttribute("href", `/app/orders/${orderId}#tarefas`);
      await expect(page.getByRole("button", { name: "Editar a tarefa" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Apagar a tarefa" })).toHaveCount(0);

      const legacyTitle = `Tarefa avulsa ${fixture.suffix}`;
      const legacyEdited = `Tarefa avulsa revisada ${fixture.suffix}`;
      await page.getByRole("button", { name: "Nova tarefa" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("O que precisa ser feito").fill(legacyTitle);
      await dialog.getByLabel("Detalhes").fill("Continua no fluxo legado.");
      const legacyCreate = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/v1/tasks",
        { timeout: HTTP_TIMEOUT },
      );
      await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
      const legacyCreated = await complete(await legacyCreate, 201);
      const legacyTaskId = (await legacyCreated.json()).data.task.id as string;
      await expect(page.getByText(legacyTitle, { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Editar a tarefa" }).click();
      await page.getByRole("dialog").getByLabel("O que precisa ser feito").fill(legacyEdited);
      const legacyPatch = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          new URL(response.url()).pathname === `/api/v1/tasks/${legacyTaskId}`,
        { timeout: HTTP_TIMEOUT },
      );
      await page.getByRole("dialog").getByRole("button", { name: "Salvar", exact: true }).click();
      await complete(await legacyPatch);
      await expect(page.getByText(legacyEdited, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Apagar a tarefa" }).click();
      const legacyDelete = page.waitForResponse(
        (response) =>
          response.request().method() === "DELETE" &&
          new URL(response.url()).pathname === `/api/v1/tasks/${legacyTaskId}`,
        { timeout: HTTP_TIMEOUT },
      );
      await page.getByRole("button", { name: "Confirmar", exact: true }).click();
      await complete(await legacyDelete);
      await expect(page.getByText(legacyEdited, { exact: true })).toHaveCount(0);

      const viewerContext = await browser.newContext();
      try {
        const viewer = await viewerContext.newPage();
        await login(viewer, fixture.viewer.email, fixture.password);
        expect(await activeOrg(viewer)).toBe(fixture.orgA);
        await viewer.goto(`/app/contacts/${customer.contactId}`, { timeout: HTTP_TIMEOUT });
        await viewer.getByRole("tab", { name: "Notas", exact: true }).click();
        await expect(viewer.getByText(noteText, { exact: true })).toBeVisible();
        await expect(viewer.getByText("Autor registrado")).toBeVisible();
        await expect(viewer.getByLabel("Nova nota")).toHaveCount(0);
        await viewer.getByRole("tab", { name: "Histórico de tarefas" }).click();
        await expect(viewer.getByText(/Revisão da tarefa: 6/)).toBeVisible();
        await expect(viewer.getByText("Autor registrado").first()).toBeVisible();
      } finally {
        await viewerContext.close();
      }
    }

    await switchTo(page, other.orgId);
    const foreignReads = await Promise.all([
      page.request.get(`/api/v1/crm-orders/${orderId}/tasks`, { timeout: HTTP_TIMEOUT }),
      page.request.get(`/api/v1/crm-notes?contact_id=${customer.contactId}`, {
        timeout: HTTP_TIMEOUT,
      }),
      page.request.get(`/api/v1/crm-task-events?contact_id=${customer.contactId}`, {
        timeout: HTTP_TIMEOUT,
      }),
    ]);
    expect(foreignReads.map((response) => response.status())).toEqual([404, 404, 404]);
    const foreignCommand = await page.request.post("/api/v1/tasks/commands", {
      data: {
        command_id: randomUUID(),
        command: "set_linked_task_status",
        task_id: taskId,
        expected_revision: 6,
        status: "done",
      },
      timeout: HTTP_TIMEOUT,
    });
    expect(foreignCommand.status()).toBe(404);
    expect(await foreignCommand.json()).toMatchObject({
      error: { code: "linked_task_not_found" },
    });
  });
}
