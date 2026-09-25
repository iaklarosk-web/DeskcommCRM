/**
 * F15 — automação e autonomia de IA (ADR-036/037), no navegador.
 *
 * Três jornadas × dois tenants (`A` e `B` da fixture F13, por tenant do seed
 * via `E2E_TENANT`) + uma do painel do dono = SETE testes (ADR-037 §1). Cada
 * jornada é uma tela nova da F15 com o efeito conferido na rota e no banco:
 *
 *  1. autonomia — `/app/settings/tenant/ia/autonomia`: as ações do catálogo (13 da F15, schedule_appointment da F14 e as 14 da F18 = 28),
 *     sobrescrever `create_task` para "Bloquear" muda o modo efetivo e a
 *     origem, o limite diário grava e mostra o uso do dia, "Voltar ao padrão"
 *     limpa; o outro tenant não vê; o attendant é 403 no PATCH;
 *  2. regras — `/app/settings/tenant/automation-rules`: criar pela tela liga a
 *     regra; ação fora do catálogo é 422 `outside_catalog` pela rota; desligar
 *     e apagar;
 *  3. regra dispara — regra `lead.stage_changed → assign_owner` criada pela
 *     tela; a oportunidade muda de etapa pela rota herdada; o drain do
 *     `event_log` (cron) roda o motor; a tela mostra a execução `success` e a
 *     oportunidade ganhou dono no banco;
 *  +  dono — `/api/v1/usage` por organização continua respondendo 200 com as
 *     duas (o painel lê o uso que o limite diário conta).
 */
import { test as base, expect, type Page } from "@playwright/test";

import { f02E2eSandbox } from "./utils/f02-crm-cadastros";
import { cleanupF13, seedF13, type F13Fixture } from "./utils/f13-fixture";
import type { LadoDoTeste } from "./utils/f11-f12-fixture";

const HTTP_TIMEOUT = 30_000;
const SEGREDO_CRON = process.env.INTERNAL_CRON_SECRET || process.env.INTERNAL_SECRET || "e2e-placeholder-nao-e-segredo";

const test = base.extend<{ fixture: F13Fixture }>({
  fixture: async ({}, runTest, info) => {
    const fixture = await seedF13();
    try {
      await runTest(fixture);
    } finally {
      // As tabelas da F15 (automation_rules/_runs, handoffs) somem com a organização (FK cascade).
      const db = f02E2eSandbox();
      for (const tabela of ["automation_rule_runs", "automation_rules"] as const) {
        const r = await db.from(tabela as never).delete().in("organization_id", [fixture.orgs.A, fixture.orgs.B]);
        if (r.error) throw r.error;
      }
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

for (const lado of ["A", "B"] as LadoDoTeste[]) {
  test(`autonomia em ${lado}: 28 ações, bloquear create_task pela tela muda o modo efetivo, limite diário gravado e mostrado, voltar ao padrão limpa, o outro tenant não vê, attendant é 403`, async ({ page, fixture }) => {
    // Arrange
    await entrarComo(page, fixture.admin.email, fixture, lado);

    // Act — a tela.
    await page.goto("/app/settings/tenant/ia/autonomia", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("ai-autonomy")).toBeVisible({ timeout: HTTP_TIMEOUT });
    // A contagem é do CATÁLOGO, e ele cresce por fase: 14 até a F14, 28 desde a
    // F18 (ADR-040 §2). O número fica aqui como afirmação, não derivado — mudar
    // o catálogo tem de custar esta linha.
    await expect(page.getByTestId("ai-autonomy-total")).toHaveText("28");
    await expect(page.getByTestId("ai-autonomy-sobrescritas")).toHaveText("0");
    const linha = page.getByTestId("ai-autonomy-create_task");
    await expect(linha).toHaveAttribute("data-mode", "allow");
    await expect(linha).toHaveAttribute("data-source", "padrão");
    const gravou = page.waitForResponse((r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === "/api/v1/settings/ai-autonomy", { timeout: HTTP_TIMEOUT });
    await page.getByTestId("ai-autonomy-create_task-modo").selectOption("block");
    expect((await gravou).status()).toBe(200);
    await expect(linha).toHaveAttribute("data-mode", "block", { timeout: HTTP_TIMEOUT });
    await expect(linha).toHaveAttribute("data-source", "organização");
    await expect(page.getByTestId("ai-autonomy-sobrescritas")).toHaveText("1");

    // O limite diário.
    await page.getByTestId("ai-limits-input").fill("7");
    const gravouLimite = page.waitForResponse((r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === "/api/v1/settings/ai-autonomy", { timeout: HTTP_TIMEOUT });
    await page.getByTestId("ai-limits-salvar").click();
    expect((await gravouLimite).status()).toBe(200);
    await expect(page.getByTestId("ai-limits-teto")).toHaveText("7", { timeout: HTTP_TIMEOUT });
    await expect(page.getByTestId("ai-limits-usado")).toHaveText("0");
    await expect(page.getByTestId("ai-limits")).toHaveAttribute("data-paused", "0");

    // Assert — a rota e o banco dizem o mesmo; o outro tenant não tem nada.
    const rota = await page.request.get("/api/v1/settings/ai-autonomy", { timeout: HTTP_TIMEOUT });
    expect(rota.status()).toBe(200);
    const dados = (await rota.json()).data as { policy: Record<string, string>; limits: { daily_turns: number; used_today: number } };
    expect(dados.policy).toEqual({ create_task: "block" });
    expect(dados.limits).toMatchObject({ daily_turns: 7, used_today: 0 });
    const db = f02E2eSandbox();
    const doOutro = await db.from("tenant_settings" as never).select("key").eq("organization_id", fixture.orgs[lado === "A" ? "B" : "A"]).in("key", ["actions.policy", "ai.limits.daily_turns"]);
    if (doOutro.error) throw doOutro.error;
    expect(doOutro.data).toEqual([]);

    // Voltar ao padrão limpa a sobrescrita.
    const limpou = page.waitForResponse((r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === "/api/v1/settings/ai-autonomy", { timeout: HTTP_TIMEOUT });
    await page.getByTestId("ai-autonomy-create_task-padrao").click();
    expect((await limpou).status()).toBe(200);
    await expect(linha).toHaveAttribute("data-source", "padrão", { timeout: HTTP_TIMEOUT });
    await expect(page.getByTestId("ai-autonomy-sobrescritas")).toHaveText("0");

    // O attendant lê, mas não configura.
    await entrarComo(page, fixture.attendants[0]!.email, fixture, lado);
    const leitura = await page.request.get("/api/v1/settings/ai-autonomy", { timeout: HTTP_TIMEOUT });
    expect(leitura.status()).toBe(200);
    const negado = await page.request.patch("/api/v1/settings/ai-autonomy", { data: { policy: { create_task: "allow" } }, timeout: HTTP_TIMEOUT });
    expect(negado.status()).toBe(403);
  });

  test(`regras em ${lado}: criar pela tela liga a regra, ação fora do catálogo é 422 outside_catalog, desligar e apagar`, async ({ page, fixture }) => {
    // Arrange
    await entrarComo(page, fixture.admin.email, fixture, lado);
    await page.goto("/app/settings/tenant/automation-rules", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("automation-rules")).toBeVisible({ timeout: HTTP_TIMEOUT });
    await expect(page.getByTestId("automation-rules-total")).toHaveText("0");

    // Act — a regra pela tela: nasce ligada.
    await page.getByTestId("nova-regra-nome").fill(`Tarefa ao confirmar ${fixture.suffix}`);
    await page.getByTestId("nova-regra-gatilho").selectOption("order.confirmed");
    await page.getByTestId("nova-regra-acao").selectOption("create_task");
    await page.getByTestId("nova-regra-texto").fill("Preparar a entrega");
    const criada = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/automation-rules", { timeout: HTTP_TIMEOUT });
    await page.getByTestId("nova-regra-salvar").click();
    const resposta = await criada;
    expect(resposta.status(), await resposta.text()).toBe(201);
    const regraId = (await resposta.json()).data.id as string;
    await expect(page.getByTestId(`automation-rule-${regraId}`)).toHaveAttribute("data-active", "1", { timeout: HTTP_TIMEOUT });
    await expect(page.getByTestId("automation-rules-total")).toHaveText("1");
    await expect(page.getByTestId("automation-rules-ligadas")).toHaveText("1");

    // Fora do catálogo: a rota recusa com nome (a tela nem oferece).
    const fora = await page.request.post("/api/v1/automation-rules", {
      data: { name: "webhook", trigger_event: "order.confirmed", conditions: [], actions: [{ type: "call_webhook", config: { url: "https://example.invalid/hook", method: "POST" } }] },
      timeout: HTTP_TIMEOUT,
    });
    expect(fora.status(), await fora.text()).toBe(422);
    expect((await fora.json()).error.code).toBe("outside_catalog");
    const gatilhoFora = await page.request.post("/api/v1/automation-rules", {
      data: { name: "msg", trigger_event: "message.received", conditions: [], actions: [{ type: "send_message", config: { body: "oi" } }] },
      timeout: HTTP_TIMEOUT,
    });
    expect(gatilhoFora.status()).toBe(422);

    // Desligar e apagar.
    await page.getByTestId(`automation-rule-${regraId}-ligar`).click();
    await expect(page.getByTestId(`automation-rule-${regraId}`)).toHaveAttribute("data-active", "0", { timeout: HTTP_TIMEOUT });
    await expect(page.getByTestId("automation-rules-ligadas")).toHaveText("0");
    await page.getByTestId(`automation-rule-${regraId}-apagar`).click();
    await expect(page.getByTestId("automation-rules-total")).toHaveText("0", { timeout: HTTP_TIMEOUT });

    // Assert — banco: nenhuma regra desta organização; o outro tenant nunca teve.
    const db = f02E2eSandbox();
    const restantes = await db.from("automation_rules" as never).select("id", { count: "exact", head: true }).in("organization_id", [fixture.orgs.A, fixture.orgs.B]);
    if (restantes.error) throw restantes.error;
    expect(restantes.count).toBe(0);
  });

  test(`regra dispara em ${lado}: lead.stage_changed → assign_owner criada pela tela; a oportunidade muda de etapa, o drain roda o motor, a execução aparece e a oportunidade ganha dono`, async ({ page, fixture }) => {
    // Arrange — a regra, pela tela; uma oportunidade sem dono.
    await entrarComo(page, fixture.admin.email, fixture, lado);
    await page.goto("/app/settings/tenant/automation-rules", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("automation-rules")).toBeVisible({ timeout: HTTP_TIMEOUT });
    await page.getByTestId("nova-regra-nome").fill(`Entregar ao mudar de etapa ${fixture.suffix}`);
    await page.getByTestId("nova-regra-gatilho").selectOption("lead.stage_changed");
    await page.getByTestId("nova-regra-acao").selectOption("assign_owner");
    const criada = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/automation-rules", { timeout: HTTP_TIMEOUT });
    await page.getByTestId("nova-regra-salvar").click();
    const regraId = ((await (await criada).json()).data as { id: string }).id;
    await expect(page.getByTestId(`automation-rule-${regraId}`)).toHaveAttribute("data-active", "1", { timeout: HTTP_TIMEOUT });

    const funil = await page.request.get("/api/v1/pipelines/default", { timeout: HTTP_TIMEOUT });
    expect(funil.status()).toBe(200);
    const { pipeline, stages } = (await funil.json()).data as { pipeline: { id: string }; stages: Array<{ id: string; is_won: boolean; is_lost: boolean; position: number }> };
    const abertas = stages.filter((s) => !s.is_won && !s.is_lost).sort((a, b) => a.position - b.position);
    const lead = await page.request.post("/api/v1/leads", { data: { pipeline_id: pipeline.id, stage_id: abertas[0]!.id, title: `Oportunidade regra ${fixture.suffix}`, value_cents: 1000 }, timeout: HTTP_TIMEOUT });
    expect(lead.status(), await lead.text()).toBe(201);
    const leadId = (await lead.json()).data.id as string;
    const db = f02E2eSandbox();
    const atual = await db.from("crm_leads" as never).select("updated_at, owner_user_id").eq("id", leadId).single();
    if (atual.error) throw atual.error;
    expect((atual.data as unknown as { owner_user_id: string | null }).owner_user_id).toBeNull();

    // Act — a etapa muda pela rota herdada (emite lead.stage_changed); o drain do cron roda o motor.
    const movida = await page.request.post(`/api/v1/leads/${leadId}/move`, {
      data: { stage_id: abertas[1]!.id, position_in_stage: 1000, expected_updated_at: (atual.data as unknown as { updated_at: string }).updated_at },
      timeout: HTTP_TIMEOUT,
    });
    expect(movida.status(), await movida.text()).toBe(200);
    const drain = await page.request.get("/api/v1/cron/event-log-drain", { headers: { authorization: `Bearer ${SEGREDO_CRON}` }, timeout: HTTP_TIMEOUT });
    expect(drain.status(), await drain.text()).toBe(200);

    // Assert — a run e o dono, na tela e no banco.
    await expect.poll(async () => {
      const r = await db.from("automation_rule_runs" as never).select("status").eq("rule_id", regraId);
      if (r.error) throw r.error;
      return (r.data as unknown as Array<{ status: string }>).map((x) => x.status);
    }, { timeout: HTTP_TIMEOUT }).toEqual(["success"]);
    const depois = await db.from("crm_leads" as never).select("owner_user_id").eq("id", leadId).single();
    if (depois.error) throw depois.error;
    expect(fixture.attendants.map((a) => a.id)).toContain((depois.data as unknown as { owner_user_id: string | null }).owner_user_id);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId(`automation-rule-${regraId}-runs`).click();
    await expect(page.getByTestId(`automation-rule-${regraId}-lista-de-runs`).getByTestId("automation-run")).toHaveAttribute("data-status", "success", { timeout: HTTP_TIMEOUT });
  });
}

test("dono: o painel lê o uso de IA por organização (o que o limite diário conta) — 200 com as duas organizações da fixture", async ({ page, fixture }) => {
  await login(page, fixture.dono.email, fixture.password);
  const r = await page.request.get("/api/v1/admin/tenants", { timeout: HTTP_TIMEOUT });
  expect(r.status(), await r.text()).toBe(200);
  const ids = ((await r.json()).data as Array<{ id: string }>).map((t) => t.id);
  expect(ids).toContain(fixture.orgs.A);
  expect(ids).toContain(fixture.orgs.B);
  const uso = await page.request.get(`/api/v1/admin/usage?range=7d&tenant_id=${fixture.orgs.A}`, { timeout: HTTP_TIMEOUT });
  expect(uso.status(), await uso.text()).toBe(200);
  const corpo = (await uso.json()).data as { tenants: Array<{ organization_id: string }> };
  expect(Array.isArray(corpo.tenants)).toBe(true);
  expect(corpo.tenants.every((t) => t.organization_id === fixture.orgs.A)).toBe(true);
});
