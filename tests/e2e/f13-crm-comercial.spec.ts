/**
 * F13-T06 — o CRM comercial pela tela, nas DUAS organizações (ADR-034 §2).
 * TRÊS jornadas × dois tenants + UMA do painel do dono = SETE testes — o
 * inventário que `scripts/verify/f02-e2e.mjs` cobra (`EXPECTED_F13_E2E_TESTS`,
 * ADR-035 §1).
 *
 * ═══ O que cada jornada CONFERE ═════════════════════════════════════════════
 *
 * 1. Campos configuráveis (T01): o admin define um campo de EMPRESA em
 *    `/app/settings/tenant/crm-fields`; o formulário de `/app/companies` passa
 *    a mostrá-lo; o valor gravado pela tela volta do BANCO; a rota recusa o
 *    obrigatório vazio (422 `custom_field_invalid`); o outro tenant não vê a
 *    definição.
 *
 * 2. Fila e histórico (T03/T04): o admin liga o rodízio pela tela da fila,
 *    três oportunidades nascem pela rota herdada, a tela mostra a fila (+3) e
 *    os 2 elegíveis, "Distribuir" esvazia a fila e o BANCO mostra os dois
 *    attendants com 2/1; um pedido é vinculado, a etapa muda pela rota herdada
 *    e a linha do tempo mostra `stage_changed` + `owner_assigned` +
 *    `order_linked` (3/3); o attendant é negado nas rotas de manager (403).
 *
 * 3. Relatório (T05): `/app/reports/crm` mostra os mesmos números da rota, e
 *    a rota os mesmos do banco (fila, abertas do funil, ganhas, pedidos).
 *
 * 4. Painel do dono (§B17): `GET /api/v1/admin/tenants?q=<slug de A>` responde
 *    200 com A e sem B — a busca por texto que respondia 500 em produção.
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
      expect(limpeza).toEqual({ deleted_organizations: 3, deleted_users: 4, domain_tables_checked: 6, domain_rows_remaining: 0, f13_tables_checked: 6, f13_rows_remaining: 0 });
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

async function funilPadrao(page: Page): Promise<{ pipeline_id: string; stage_id: string; proxima_stage_id: string }> {
  const r = await page.request.get("/api/v1/pipelines/default", { timeout: HTTP_TIMEOUT });
  expect(r.status()).toBe(200);
  const { pipeline, stages } = (await r.json()).data as { pipeline: { id: string }; stages: Array<{ id: string; is_won: boolean; is_lost: boolean; position: number }> };
  const abertas = stages.filter((s) => !s.is_won && !s.is_lost).sort((a, b) => a.position - b.position);
  if (abertas.length < 2) throw new Error("funil padrão com menos de duas etapas abertas");
  return { pipeline_id: pipeline.id, stage_id: abertas[0]!.id, proxima_stage_id: abertas[1]!.id };
}

async function criarOportunidade(page: Page, funil: { pipeline_id: string; stage_id: string }, titulo: string, valor: number): Promise<string> {
  const r = await page.request.post("/api/v1/leads", { data: { pipeline_id: funil.pipeline_id, stage_id: funil.stage_id, title: titulo, value_cents: valor }, timeout: HTTP_TIMEOUT });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).data.id as string;
}

for (const lado of ["A", "B"] as LadoDoTeste[]) {
  test(`campos configuráveis em ${lado}: definido na tela, aparece no formulário da empresa, o valor volta do banco, obrigatório vazio é 422, o outro tenant não vê`, async ({ page, fixture }) => {
    // Arrange
    await entrarComo(page, fixture.admin.email, fixture, lado);
    const chave = `codigo_${fixture.suffix}`;

    // Act — a definição pela tela.
    await page.goto("/app/settings/tenant/crm-fields", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("crm-fields-companies")).toBeVisible({ timeout: HTTP_TIMEOUT });
    await page.getByTestId("novo-campo-companies-key").fill(chave);
    await page.getByTestId("novo-campo-companies-label").fill("Código interno");
    await page.getByTestId("novo-campo-companies-required").check();
    await page.getByTestId("adicionar-campo-companies").click();
    await expect(page.getByTestId(`crm-field-companies-${chave}`)).toBeVisible({ timeout: HTTP_TIMEOUT });
    await expect(page.getByTestId("crm-fields-companies-total")).toHaveText("1");

    // O formulário da empresa mostra o campo; o valor gravado pela tela volta do banco.
    await page.goto("/app/companies", { waitUntil: "domcontentloaded" });
    await page.getByTestId("nova-empresa").click();
    await expect(page.getByTestId("empresa-campos-configuraveis")).toBeVisible({ timeout: HTTP_TIMEOUT });
    const razao = `Empresa F13 ${lado} ${fixture.suffix}`;
    await page.getByTestId("empresa-razao-social").fill(razao);
    await page.locator(`#cf-${chave}`).fill("K-2026");
    const criada = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/companies", { timeout: HTTP_TIMEOUT });
    await page.getByTestId("salvar-empresa").click();
    const resposta = await criada;
    expect(resposta.status()).toBe(201);
    const empresaId = (await resposta.json()).data.id as string;

    // Assert — banco, rota e o outro tenant.
    const noBanco = await f02E2eSandbox().from("crm_companies" as never).select("legal_name, custom_fields").eq("id", empresaId).single();
    if (noBanco.error) throw noBanco.error;
    expect(noBanco.data as unknown).toEqual({ legal_name: razao, custom_fields: { [chave]: "K-2026" } });
    const semObrigatorio = await page.request.post("/api/v1/companies", { data: { legal_name: "Sem código" }, timeout: HTTP_TIMEOUT });
    expect(semObrigatorio.status()).toBe(422);
    expect((await semObrigatorio.json()).error.code).toBe("custom_field_invalid");
    const outro = lado === "A" ? "B" : "A";
    const doOutro = await f02E2eSandbox().from("tenant_settings" as never).select("value").eq("organization_id", fixture.orgs[outro]).eq("key", "crm.fields.companies");
    if (doOutro.error) throw doOutro.error;
    expect(doOutro.data).toEqual([]);
  });

  test(`fila e histórico em ${lado}: rodízio ligado pela tela, 3 oportunidades distribuídas entre 2 attendants, pedido vinculado, linha do tempo 3/3, attendant negado`, async ({ page, fixture }) => {
    // Arrange — o admin liga o rodízio pela tela e três oportunidades nascem pela rota herdada.
    await entrarComo(page, fixture.admin.email, fixture, lado);
    await page.goto("/app/crm/fila", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("fila-modo")).toBeVisible({ timeout: HTTP_TIMEOUT });
    const modoGravado = page.waitForResponse((r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === "/api/v1/settings/crm", { timeout: HTTP_TIMEOUT });
    await page.getByTestId("fila-modo").selectOption("round_robin");
    expect((await modoGravado).status()).toBe(200);
    const funil = await funilPadrao(page);
    // A organização A pode vir do seed (ADR-029 §2): a fila é medida em relação ao que já havia, nunca suposta vazia.
    const antes = await page.request.get("/api/v1/crm/opportunities/queue", { timeout: HTTP_TIMEOUT });
    expect(antes.status()).toBe(200);
    const filaAntes = (await antes.json()).data as { queue_size: number; eligible: Array<{ user_id: string }> };
    const ids = [] as string[];
    for (const n of [1, 2, 3]) ids.push(await criarOportunidade(page, funil, `Oportunidade ${n} ${fixture.suffix}`, n * 1000));

    // Act — a tela lista a fila e distribui.
    await page.goto("/app/crm/fila", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("fila-tamanho")).toHaveText(String(filaAntes.queue_size + 3), { timeout: HTTP_TIMEOUT });
    await expect(page.getByTestId("fila-elegiveis")).toHaveText(String(filaAntes.eligible.length));
    expect(filaAntes.eligible.map((e) => e.user_id).sort()).toEqual(fixture.attendants.map((a) => a.id).sort());
    for (const id of ids) await expect(page.getByTestId(`fila-item-${id}`)).toBeVisible();
    const distribuida = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/crm/opportunities/distribute", { timeout: HTTP_TIMEOUT });
    await page.getByTestId("fila-distribuir").click();
    expect((await distribuida).status()).toBe(200);
    await expect(page.getByTestId("fila-distribuidas")).toHaveText(String(filaAntes.queue_size + 3), { timeout: HTTP_TIMEOUT });
    await expect(page.getByTestId("fila-equilibrada")).toHaveText("sim");
    await expect(page.getByTestId("fila-vazia")).toBeVisible({ timeout: HTTP_TIMEOUT });

    // Assert — banco: as três têm dono humano entre os elegíveis, repartidas (nenhum ficou com as três), linhas owner_assigned = 3.
    const db = f02E2eSandbox();
    const donos = await db.from("crm_leads" as never).select("owner_user_id, owner_kind").in("id", ids);
    if (donos.error) throw donos.error;
    const linhas = donos.data as unknown as Array<{ owner_user_id: string; owner_kind: string }>;
    const porDono = new Map<string, number>();
    for (const l of linhas) {
      expect(l.owner_kind).toBe("user");
      porDono.set(l.owner_user_id, (porDono.get(l.owner_user_id) ?? 0) + 1);
    }
    const elegiveis = new Set(fixture.attendants.map((a) => a.id));
    expect([...porDono.keys()].every((u) => elegiveis.has(u))).toBe(true);
    expect([...porDono.values()].sort()).toEqual([1, 2]);
    const atribuicoes = await db.from("crm_lead_activities" as never).select("*", { count: "exact", head: true }).in("lead_id", ids).eq("type", "owner_assigned");
    if (atribuicoes.error) throw atribuicoes.error;
    expect(atribuicoes.count).toBe(3);

    // O pedido (contrato de ADR-012, rota herdada) vinculado à primeira oportunidade.
    const contato = await page.request.post("/api/v1/contacts", { data: { display_name: `Cliente F13 ${fixture.suffix}` }, timeout: HTTP_TIMEOUT });
    expect(contato.status()).toBe(201);
    // `POST /api/v1/contacts` devolve `{contact, action}` (herdado).
    const contactId = (await contato.json()).data.contact.id as string;
    const pedido = await page.request.post("/api/v1/crm-orders/commands", {
      data: { command: "create_draft", idempotency_key: randomUUID(), contact_id: contactId, company_id: null, company_name: null, channel: null, delivery_date: null, currency: null, items: [] },
      timeout: HTTP_TIMEOUT,
    });
    expect(pedido.status(), await pedido.text()).toBe(201);
    const orderId = (await pedido.json()).data.id as string;
    const vinculo = await page.request.post(`/api/v1/crm/opportunities/${ids[0]}/link-order`, { data: { order_id: orderId }, timeout: HTTP_TIMEOUT });
    expect(vinculo.status(), await vinculo.text()).toBe(201);
    // A etapa muda pela rota herdada (`stage_changed`); a criação manual não escreve linha (só o nascimento pelo WhatsApp escreve `lead_created`).
    // Não há GET /api/v1/leads/[id]; o `updated_at` vem do banco (a distribuição acabou de tocá-lo).
    const atual = await db.from("crm_leads" as never).select("updated_at").eq("id", ids[0]!).single();
    if (atual.error) throw atual.error;
    const updatedAt = (atual.data as unknown as { updated_at: string }).updated_at;
    const movida = await page.request.post(`/api/v1/leads/${ids[0]}/move`, { data: { stage_id: funil.proxima_stage_id, position_in_stage: 1000, expected_updated_at: updatedAt }, timeout: HTTP_TIMEOUT });
    expect(movida.status(), await movida.text()).toBe(200);
    const timeline = await page.request.get(`/api/v1/leads/${ids[0]}/timeline`, { timeout: HTTP_TIMEOUT });
    expect(timeline.status()).toBe(200);
    const tipos = new Set(((await timeline.json()).data as Array<{ type: string }>).map((a) => a.type));
    const esperados = ["stage_changed", "owner_assigned", "order_linked"];
    expect(esperados.filter((t) => tipos.has(t)), [...tipos].join(",")).toEqual(esperados);

    // O attendant vê a fila mas não distribui, não define campos e não lê o relatório (3/3 negadas).
    await entrarComo(page, fixture.attendants[0]!.email, fixture, lado);
    const negadas = await Promise.all([
      page.request.post("/api/v1/crm/opportunities/distribute", { data: {}, timeout: HTTP_TIMEOUT }),
      page.request.put("/api/v1/settings/crm-fields", { data: { entity: "contacts", fields: [] }, timeout: HTTP_TIMEOUT }),
      page.request.get("/api/v1/reports/crm", { timeout: HTTP_TIMEOUT }),
    ]);
    expect(negadas.map((r) => r.status())).toEqual([403, 403, 403]);
    const fila = await page.request.get("/api/v1/crm/opportunities/queue", { timeout: HTTP_TIMEOUT });
    expect(fila.status()).toBe(200);
  });

  test(`relatório comercial em ${lado}: a tela mostra os números da rota, e a rota os do banco`, async ({ page, fixture }) => {
    // Arrange — duas abertas na fila, uma ganha, um pedido.
    await entrarComo(page, fixture.admin.email, fixture, lado);
    const funil = await funilPadrao(page);
    await criarOportunidade(page, funil, `Aberta 1 ${fixture.suffix}`, 1500);
    await criarOportunidade(page, funil, `Aberta 2 ${fixture.suffix}`, 2500);
    const ganha = await criarOportunidade(page, funil, `Ganha ${fixture.suffix}`, 9900);
    const win = await page.request.post(`/api/v1/leads/${ganha}/win`, { data: {}, timeout: HTTP_TIMEOUT });
    expect(win.status(), await win.text()).toBe(200);
    const contato = await page.request.post("/api/v1/contacts", { data: { display_name: `Cliente relatório ${fixture.suffix}` }, timeout: HTTP_TIMEOUT });
    const pedido = await page.request.post("/api/v1/crm-orders/commands", {
      data: { command: "create_draft", idempotency_key: randomUUID(), contact_id: (await contato.json()).data.contact.id, company_id: null, company_name: null, channel: null, delivery_date: null, currency: null, items: [] },
      timeout: HTTP_TIMEOUT,
    });
    expect(pedido.status()).toBe(201);

    // Act — a rota e a tela.
    const rota = await page.request.get("/api/v1/reports/crm", { timeout: HTTP_TIMEOUT });
    expect(rota.status()).toBe(200);
    const rel = (await rota.json()).data as { queue_size: number; closed: { won: number; won_value_cents: number }; funnel: Array<{ open: number }>; orders: Array<{ status: string; count: number }> };
    await page.goto("/app/reports/crm", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("relatorio-comercial")).toBeVisible({ timeout: HTTP_TIMEOUT });

    // Assert — tela × rota × banco.
    const org = fixture.orgs[lado];
    const db = f02E2eSandbox();
    const conta = async (filtro: (q: ReturnType<typeof db.from>) => unknown) => {
      const r = (await filtro(db.from("crm_leads" as never))) as { count: number | null; error: unknown };
      if (r.error) throw r.error;
      return r.count ?? 0;
    };
    const naFila = await conta((q) => q.select("*", { count: "exact", head: true }).eq("organization_id", org).eq("status", "open").is("owner_user_id", null).is("owner_agent_id", null));
    const abertas = await conta((q) => q.select("*", { count: "exact", head: true }).eq("organization_id", org).eq("status", "open"));
    const ganhas = await conta((q) => q.select("*", { count: "exact", head: true }).eq("organization_id", org).eq("status", "won"));
    expect(rel.queue_size).toBe(naFila);
    expect(rel.funnel.reduce((s, e) => s + e.open, 0)).toBe(abertas);
    expect(rel.closed.won).toBe(ganhas);
    expect(rel.closed.won).toBeGreaterThanOrEqual(1);
    expect(rel.orders.find((o) => o.status === "draft")?.count ?? 0).toBeGreaterThanOrEqual(1);
    expect(Number(await page.getByTestId("relatorio-queue-size").getAttribute("data-value"))).toBe(rel.queue_size);
    expect(Number(await page.getByTestId("relatorio-closed-won").getAttribute("data-value"))).toBe(rel.closed.won);
    expect(Number(await page.getByTestId("relatorio-closed-won-value").getAttribute("data-value"))).toBe(rel.closed.won_value_cents);
    const abertasNaTela = await page.locator('[data-testid^="relatorio-etapa-"]').evaluateAll((linhas) => linhas.reduce((s, l) => s + Number(l.getAttribute("data-open") ?? 0), 0));
    expect(abertasNaTela).toBe(abertas);
    expect(Number(await page.getByTestId("relatorio-pedidos-draft").getAttribute("data-count"))).toBe(rel.orders.find((o) => o.status === "draft")?.count);
  });
}

test("§B17: o dono busca a empresa por texto em /api/v1/admin/tenants?q= e recebe 200 com A, sem B", async ({ page, fixture }) => {
  await login(page, fixture.dono.email, fixture.password);
  // O slug de A depende de `E2E_TENANT` (`<seed>-e2e-<sufixo>` ou `f11-a-<sufixo>`): lido do banco, não suposto.
  const orgA = await f02E2eSandbox().from("organizations" as never).select("slug").eq("id", fixture.orgs.A).single();
  if (orgA.error) throw orgA.error;
  const slugA = (orgA.data as unknown as { slug: string }).slug;
  const r = await page.request.get(`/api/v1/admin/tenants?q=${encodeURIComponent(slugA)}`, { timeout: HTTP_TIMEOUT });
  expect(r.status(), await r.text()).toBe(200);
  const ids = ((await r.json()).data as Array<{ id: string }>).map((t) => t.id);
  expect(ids).toContain(fixture.orgs.A);
  expect(ids).not.toContain(fixture.orgs.B);
  const porNome = await page.request.get(`/api/v1/admin/tenants?q=${encodeURIComponent(`Empresa B ${fixture.suffix}`)}`, { timeout: HTTP_TIMEOUT });
  expect(porNome.status()).toBe(200);
  const idsB = ((await porNome.json()).data as Array<{ id: string }>).map((t) => t.id);
  expect(idsB).toContain(fixture.orgs.B);
  expect(idsB).not.toContain(fixture.orgs.A);
});
