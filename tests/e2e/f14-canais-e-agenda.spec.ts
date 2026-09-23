/**
 * F14 — chat do site, agenda adotada e IA que marca horário, no navegador
 * (ADR-038 §2 T05; ADR-039 §1): três jornadas × dois tenants (A e B, ou o
 * tenant do seed via `E2E_TENANT`) + uma do painel do dono = SETE testes.
 *
 *  1. chat do site — o admin LIGA o chat em `/app/settings/tenant/webchat`
 *     (PATCH 200, código de embed com o slug); um VISITANTE sem cookie abre
 *     `/chat/<slug>` (HTML servido com `frame-ancestors`), se identifica e
 *     escreve; a conversa `webchat` aparece para o atendente pela rota do
 *     inbox; o atendente abre a conversa, ASSUME e responde pelo mesmo
 *     `POST /api/v1/messages`; a página do visitante mostra a resposta (polling); o slug do OUTRO tenant
 *     (chat desligado) é 404; o script de embed é servido;
 *  2. agenda — tipo + jornada do atendente (fixture); marcar pela rota herdada
 *     (201), o MESMO horário de novo é recusado, remarcar (200); `/app/agenda`
 *     lista o compromisso;
 *  3. IA marca horário — `schedule_appointment` aparece na tela de autonomia
 *     com o padrão "Pedir aprovação"; o admin sobe para "Permitir" (PATCH 200,
 *     origem organização) e volta ao padrão; o attendant é 403;
 *  +  dono — `/api/v1/admin/tenants` lista as duas organizações e a conversa
 *     `webchat` de A é lida pelo acompanhamento só-leitura (`/api/v1/admin/inbox/conversations`).
 */
import { randomUUID } from "node:crypto";

import { test as base, expect, type Page } from "@playwright/test";

import { f02E2eSandbox } from "./utils/f02-crm-cadastros";
import { cleanupF13, seedF13, type F13Fixture } from "./utils/f13-fixture";
import type { LadoDoTeste } from "./utils/f11-f12-fixture";

const HTTP_TIMEOUT = 30_000;

const test = base.extend<{ fixture: F13Fixture }>({
  fixture: async ({}, runTest, info) => {
    const fixture = await seedF13();
    try {
      await runTest(fixture);
    } finally {
      const limpeza = await cleanupF13(fixture);
      await info.attach("sandbox-cleanup", { body: JSON.stringify(limpeza), contentType: "application/json" });
      expect(limpeza).toEqual({ deleted_organizations: 3, deleted_users: 4, domain_tables_checked: 7, domain_rows_remaining: 0, f13_tables_checked: 6, f13_rows_remaining: 0 });
    }
  },
});

test.describe.configure({ timeout: 300_000 });

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/app/**", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });
}

async function orgAtiva(page: Page): Promise<string> {
  const r = await page.request.get("/api/v1/auth/interface", { timeout: HTTP_TIMEOUT });
  expect(r.status()).toBe(200);
  return (await r.json()).data.organization_id as string;
}

async function trocarPara(page: Page, orgId: string): Promise<void> {
  if ((await orgAtiva(page)) === orgId) return;
  await page.getByTestId("tenant-switcher").click();
  await Promise.all([
    page.waitForEvent("framenavigated", {
      predicate: (frame) => frame === page.mainFrame() && new URL(frame.url()).pathname.startsWith("/app"),
      timeout: HTTP_TIMEOUT,
    }),
    page.getByTestId(`tenant-switcher-item-${orgId}`).click(),
  ]);
  await page.waitForLoadState("domcontentloaded");
  await expect.poll(() => orgAtiva(page), { timeout: HTTP_TIMEOUT }).toBe(orgId);
}

async function entrarComo(page: Page, email: string, fixture: F13Fixture, lado: LadoDoTeste): Promise<void> {
  await login(page, email, fixture.password);
  await trocarPara(page, fixture.orgs[lado]);
}

async function slugDa(orgId: string): Promise<string> {
  const db = f02E2eSandbox();
  const r = await db.from("organizations" as never).select("slug").eq("id", orgId).single();
  if (r.error) throw r.error;
  return String((r.data as { slug: string }).slug);
}

/** Terça 06/10/2026 14:00 em São Paulo = 17:00Z, dentro da jornada 09–18 semeada. */
const TERCA_14H_SP = "2026-10-06T17:00:00.000Z";

for (const lado of ["A", "B"] as LadoDoTeste[]) {
  test(`chat do site em ${lado}: ligar pela tela, visitante sem cookie conversa, atendente responde pelo inbox, o outro tenant é 404`, async ({ page, browser, fixture }) => {
    await entrarComo(page, fixture.admin.email, fixture, lado);
    const slug = await slugDa(fixture.orgs[lado]);
    const outro = await slugDa(fixture.orgs[lado === "A" ? "B" : "A"]);

    // Desligado (default declarado): a página do visitante é 404.
    expect((await page.request.get(`/chat/${slug}`, { timeout: HTTP_TIMEOUT })).status()).toBe(404);

    await page.goto("/app/settings/tenant/webchat", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("webchat-estado")).toHaveAttribute("data-enabled", "0", { timeout: HTTP_TIMEOUT });
    const ligou = page.waitForResponse((r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === "/api/v1/settings/webchat", { timeout: HTTP_TIMEOUT });
    await page.getByTestId("webchat-alternar").click();
    expect((await ligou).status()).toBe(200);
    await expect(page.getByTestId("webchat-estado")).toHaveAttribute("data-enabled", "1", { timeout: HTTP_TIMEOUT });
    await expect(page.getByTestId("webchat-snippet")).toContainText(`/embed/${slug}.js`);
    const embed = await page.request.get(`/embed/${slug}.js`, { timeout: HTTP_TIMEOUT });
    expect(embed.status()).toBe(200);
    expect(await embed.text()).toContain(`/chat/${slug}`);

    // O visitante: contexto NOVO, sem cookie de sessão do app.
    const contexto = await browser.newContext();
    const visitante = await contexto.newPage();
    try {
      const pagina = await visitante.goto(`/chat/${slug}`, { waitUntil: "domcontentloaded" });
      expect(pagina?.status()).toBe(200);
      expect(pagina?.headers()["content-security-policy"]).toContain("frame-ancestors");
      await expect(visitante.locator("[data-form-ident]")).toBeVisible({ timeout: HTTP_TIMEOUT });
      await visitante.locator("[data-nome]").fill("Visitante Da Spec");
      await visitante.locator("[data-contato]").fill(`visitante-${fixture.suffix}-${lado.toLowerCase()}@example.test`);
      const identificou = visitante.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/identify"), { timeout: HTTP_TIMEOUT });
      await visitante.locator("[data-continuar]").click();
      expect((await identificou).status()).toBe(200);
      await expect(visitante.locator("[data-form-msg]")).toBeVisible({ timeout: HTTP_TIMEOUT });
      const enviou = visitante.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/messages"), { timeout: HTTP_TIMEOUT });
      await visitante.locator("[data-corpo]").fill(`Olá, vocês entregam no sábado? ${fixture.suffix}`);
      await visitante.locator("[data-enviar]").click();
      expect((await enviou).status()).toBe(202);
      await expect(visitante.locator(".msg.visitor")).toHaveCount(1, { timeout: HTTP_TIMEOUT });

      // O atendente vê a conversa `webchat` e responde pelo MESMO caminho de todo canal.
      const lista = await page.request.get("/api/v1/conversations?limit=50", { timeout: HTTP_TIMEOUT });
      expect(lista.status(), await lista.text()).toBe(200);
      const conversas = (await lista.json()).data as Array<{ id: string; channel: string; last_message_preview: string | null }>;
      const daSpec = conversas.find((c) => c.channel === "webchat" && (c.last_message_preview ?? "").includes(fixture.suffix));
      expect(daSpec, JSON.stringify(conversas.map((c) => [c.channel, c.last_message_preview]))).toBeTruthy();
      // …abre a conversa no inbox, ASSUME (D16: automático → humano) e responde.
      await page.goto(`/app/inbox?filter=all&id=${daSpec!.id}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("estado-d16-cabecalho")).toBeVisible({ timeout: HTTP_TIMEOUT });
      await page.getByRole("button", { name: /^Assumir$/i }).click();
      await expect(page.getByTestId("estado-d16-cabecalho")).toHaveText("Em atendimento humano", { timeout: HTTP_TIMEOUT });
      const resposta = await page.request.post("/api/v1/messages", {
        data: { conversation_id: daSpec!.id, type: "text", body: `Entregamos sim, até as 13h. ${fixture.suffix}` },
        timeout: HTTP_TIMEOUT,
      });
      expect([200, 201, 202], await resposta.text()).toContain(resposta.status());
      const saida = await f02E2eSandbox().from("messages" as never).select("direction, status, provider, sent_via, type, external_id").eq("conversation_id", daSpec!.id).eq("direction", "outbound");
      if (saida.error) throw saida.error;
      // O handler herdado não carimba `messages.provider` na saída; o que prova a entrega é `status=sent` + o id do adapter webchat.
      expect(saida.data, "a resposta do atendente não ficou entregue pelo adapter webchat").toEqual([expect.objectContaining({ status: "sent", type: "text", external_id: expect.stringMatching(/^webchat:/) })]);
      await expect(visitante.locator(".msg.human")).toHaveCount(1, { timeout: HTTP_TIMEOUT });
      await expect(visitante.locator(".msg.human")).toContainText("Entregamos sim");

      // O slug do OUTRO tenant (chat desligado) é 404 para o mesmo visitante.
      const alheia = await visitante.goto(`/chat/${outro}`, { waitUntil: "domcontentloaded" });
      expect(alheia?.status()).toBe(404);
    } finally {
      await contexto.close();
    }

    // No banco: uma sessão identificada, uma conversa webchat, 2 mensagens (1 de cada lado), nada no outro tenant.
    const db = f02E2eSandbox();
    const sessoes = await db.from("webchat_sessions" as never).select("id, identified_at").eq("organization_id", fixture.orgs[lado]);
    if (sessoes.error) throw sessoes.error;
    expect((sessoes.data as Array<{ identified_at: string | null }>).filter((s) => s.identified_at !== null)).toHaveLength(1);
    const doOutro = await db.from("webchat_sessions" as never).select("id", { count: "exact", head: true }).eq("organization_id", fixture.orgs[lado === "A" ? "B" : "A"]);
    if (doOutro.error) throw doOutro.error;
    expect(doOutro.count).toBe(0);
  });

  test(`agenda em ${lado}: marcar pela rota herdada, o mesmo horário é recusado, remarcar, e /app/agenda lista`, async ({ page, fixture }) => {
    await entrarComo(page, fixture.admin.email, fixture, lado);
    const db = f02E2eSandbox();
    const org = fixture.orgs[lado];
    const tipoId = randomUUID();
    const disp = await db.from("attendant_availability" as never).upsert({ organization_id: org, user_id: fixture.admin.id, is_available: true, schedule: { timezone: "America/Sao_Paulo", windows: [1, 2, 3, 4, 5].map((dow) => ({ dow, start: "09:00", end: "18:00" })) } } as never, { onConflict: "organization_id,user_id" });
    if (disp.error) throw disp.error;
    const tipo = await db.from("calendar_event_types" as never).insert({ id: tipoId, organization_id: org, name: `Consulta ${fixture.suffix}`, slug: `consulta-${fixture.suffix}-${lado.toLowerCase()}`, duration_minutes: 60, minimum_notice_minutes: 120, booking_window_days: 60, default_owner_user_id: fixture.admin.id, is_active: true } as never);
    if (tipo.error) throw tipo.error;

    const marcou = await page.request.post("/api/v1/agenda/agendamentos", { data: { event_type_id: tipoId, starts_at: TERCA_14H_SP }, timeout: HTTP_TIMEOUT });
    expect(marcou.status(), await marcou.text()).toBe(201);
    const criado = (await marcou.json()).data as { id: string; revision: number; status: string };
    expect(criado.status).toBe("confirmed");

    const repetido = await page.request.post("/api/v1/agenda/agendamentos", { data: { event_type_id: tipoId, starts_at: TERCA_14H_SP }, timeout: HTTP_TIMEOUT });
    expect([409, 422]).toContain(repetido.status());

    const remarcou = await page.request.patch("/api/v1/agenda/agendamentos", { data: { id: criado.id, revision: criado.revision, starts_at: "2026-10-06T19:00:00.000Z" }, timeout: HTTP_TIMEOUT });
    expect(remarcou.status(), await remarcou.text()).toBe(200);

    await page.goto("/app/agenda", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(`Consulta ${fixture.suffix}`).first()).toBeVisible({ timeout: HTTP_TIMEOUT });

    const noBanco = await db.from("calendar_appointments" as never).select("id, starts_at, status").eq("organization_id", org);
    if (noBanco.error) throw noBanco.error;
    const linhas = noBanco.data as Array<{ id: string; starts_at: string; status: string }>;
    expect(linhas.filter((l) => l.status !== "cancelled")).toHaveLength(1);
    expect(new Date(linhas[0]!.starts_at).toISOString()).toBe("2026-10-06T19:00:00.000Z");
  });

  test(`IA marca horário em ${lado}: schedule_appointment na tela de autonomia nasce "Pedir aprovação", sobe para Permitir e volta; attendant é 403`, async ({ page, fixture }) => {
    await entrarComo(page, fixture.admin.email, fixture, lado);
    await page.goto("/app/settings/tenant/ia/autonomia", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("ai-autonomy")).toBeVisible({ timeout: HTTP_TIMEOUT });
    const linha = page.getByTestId("ai-autonomy-schedule_appointment");
    await expect(linha).toHaveAttribute("data-mode", "approve");
    await expect(linha).toHaveAttribute("data-source", "padrão");
    const gravou = page.waitForResponse((r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === "/api/v1/settings/ai-autonomy", { timeout: HTTP_TIMEOUT });
    await page.getByTestId("ai-autonomy-schedule_appointment-modo").selectOption("allow");
    expect((await gravou).status()).toBe(200);
    await expect(linha).toHaveAttribute("data-mode", "allow", { timeout: HTTP_TIMEOUT });
    await expect(linha).toHaveAttribute("data-source", "organização");
    const rota = await page.request.get("/api/v1/settings/ai-autonomy", { timeout: HTTP_TIMEOUT });
    expect(((await rota.json()).data as { policy: Record<string, string> }).policy).toEqual({ schedule_appointment: "allow" });
    const limpou = page.waitForResponse((r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === "/api/v1/settings/ai-autonomy", { timeout: HTTP_TIMEOUT });
    await page.getByTestId("ai-autonomy-schedule_appointment-padrao").click();
    expect((await limpou).status()).toBe(200);
    await expect(linha).toHaveAttribute("data-source", "padrão", { timeout: HTTP_TIMEOUT });

    await entrarComo(page, fixture.attendants[0]!.email, fixture, lado);
    const negado = await page.request.patch("/api/v1/settings/webchat", { data: { enabled: true }, timeout: HTTP_TIMEOUT });
    expect(negado.status()).toBe(403);
  });
}

test("dono: as duas organizações no painel e o acompanhamento só-leitura lê a conversa webchat de A", async ({ page, browser, fixture }) => {
  // Liga o chat em A e cria UMA conversa de visitante (sem cookie do app).
  const db = f02E2eSandbox();
  const ligar = await db.from("tenant_settings" as never).insert({ organization_id: fixture.orgs.A, key: "webchat.enabled", value: true, schema_version: 1, source: "tenant_admin" } as never);
  if (ligar.error) throw ligar.error;
  const slug = await slugDa(fixture.orgs.A);
  const contexto = await browser.newContext();
  const visitante = await contexto.newPage();
  try {
    await visitante.goto(`/chat/${slug}`, { waitUntil: "domcontentloaded" });
    await expect(visitante.locator("[data-form-ident]")).toBeVisible({ timeout: HTTP_TIMEOUT });
    await visitante.locator("[data-nome]").fill("Visitante Do Dono");
    await visitante.locator("[data-contato]").fill(`dono-${fixture.suffix}@example.test`);
    await visitante.locator("[data-continuar]").click();
    await expect(visitante.locator("[data-form-msg]")).toBeVisible({ timeout: HTTP_TIMEOUT });
    const enviou = visitante.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/messages"), { timeout: HTTP_TIMEOUT });
    await visitante.locator("[data-corpo]").fill(`Mensagem para o painel ${fixture.suffix}`);
    await visitante.locator("[data-enviar]").click();
    expect((await enviou).status()).toBe(202);
  } finally {
    await contexto.close();
  }

  await login(page, fixture.dono.email, fixture.password);
  const r = await page.request.get("/api/v1/admin/tenants", { timeout: HTTP_TIMEOUT });
  expect(r.status(), await r.text()).toBe(200);
  const ids = ((await r.json()).data as Array<{ id: string }>).map((t) => t.id);
  expect(ids).toContain(fixture.orgs.A);
  expect(ids).toContain(fixture.orgs.B);
  const conversas = await db.from("conversations" as never).select("id, channel").eq("organization_id", fixture.orgs.A).eq("channel", "webchat");
  if (conversas.error) throw conversas.error;
  expect(conversas.data).toHaveLength(1);
  const inbox = await page.request.get(`/api/v1/admin/inbox/conversations?tenant_id=${fixture.orgs.A}`, { timeout: HTTP_TIMEOUT });
  expect(inbox.status(), await inbox.text()).toBe(200);
  const texto = await inbox.text();
  expect(texto).toContain((conversas.data as Array<{ id: string }>)[0]!.id);
});
