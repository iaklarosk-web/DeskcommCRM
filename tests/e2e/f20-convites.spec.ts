/**
 * F20 — o convite com ciclo de vida, no navegador (ADR-045 §4/§6; ADR-046 §3):
 * duas jornadas × dois tenants (A e B) + uma do painel do dono = CINCO testes.
 *
 * O que estes testes existem para impedir, e que ninguém via antes:
 *  1. o link do convite existia UMA vez, na resposta da emissão — quem fechava
 *     a tela o perdia (VARREDURA §B27). Agora ele mora numa lista;
 *  2. cancelar um convite precisa DIZER que foi cancelado quando alguém abre o
 *     link. "Convite inválido" para um link revogado pelo administrador é
 *     mentira por omissão;
 *  3. o painel do dono precisa listar e emitir — é o caminho que a sessão de
 *     suporte só-leitura não oferece (D51) e de que D60 passa a depender.
 *
 * A matriz de papéis (gerente sim, atendente não — D61 c) é medida na
 * integração (`f20-rotas-de-convite`), onde o repo já mede papel negado; aqui
 * ficam as cinco jornadas de TELA.
 */
import { test as base, expect, type Page } from "@playwright/test";

import { cleanupF11F12, seedF11F12, type F11F12Fixture, type LadoDoTeste } from "./utils/f11-f12-fixture";

const HTTP_TIMEOUT = 30_000;

const test = base.extend<{ fixture: F11F12Fixture }>({
  fixture: async ({}, runTest, info) => {
    const fixture = await seedF11F12();
    try {
      await runTest(fixture);
    } finally {
      const limpeza = await cleanupF11F12(fixture);
      await info.attach("sandbox-cleanup", { body: JSON.stringify(limpeza), contentType: "application/json" });
      expect(limpeza.domain_rows_remaining).toBe(0);
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

/** Emite um convite pela API do produto e devolve o link curto. */
async function convidar(page: Page, email: string, role = "agent"): Promise<{ id: string; link: string }> {
  const r = await page.request.post("/api/v1/team/invite", {
    data: { invitations: [{ email, role }] },
    timeout: HTTP_TIMEOUT,
  });
  expect(r.status(), await r.text()).toBe(201);
  const corpo = (await r.json()) as { data: { sent: Array<{ invite_id: string; accept_url: string }> } };
  const enviado = corpo.data.sent[0]!;
  return { id: enviado.invite_id, link: enviado.accept_url };
}

for (const lado of ["A", "B"] as LadoDoTeste[]) {
  test(`o gerente vê o convite pendente e o link cabe no WhatsApp em ${lado}`, async ({ page, fixture }) => {
    await login(page, fixture.admin.email, fixture.password);
    await page.request.post("/api/v1/auth/active-org", { data: { organization_id: fixture.orgs[lado] }, timeout: HTTP_TIMEOUT });
    const email = `convidado.${lado.toLowerCase()}.${fixture.suffix}@exemplo.test`;
    const { link } = await convidar(page, email);

    // O tamanho é o ponto: 559 chars não viravam link clicável no WhatsApp.
    expect(link.length, `o link tem ${link.length} chars`).toBeLessThanOrEqual(64);
    expect(link).toContain("/i/");

    await page.goto("/app/team");
    const item = page.getByTestId(`convite-${email}`);
    await expect(item).toBeVisible({ timeout: HTTP_TIMEOUT });
    await expect(page.getByTestId(`convite-link-${email}`)).toContainText("/i/");
  });

  test(`cancelar o convite em ${lado} tira-o da lista e o link passa a dizer que foi cancelado`, async ({ page, fixture }) => {
    await login(page, fixture.admin.email, fixture.password);
    await page.request.post("/api/v1/auth/active-org", { data: { organization_id: fixture.orgs[lado] }, timeout: HTTP_TIMEOUT });
    const email = `cancelado.${lado.toLowerCase()}.${fixture.suffix}@exemplo.test`;
    const { link } = await convidar(page, email);

    await page.goto("/app/team");
    await page.getByTestId(`convite-cancelar-${email}`).click();
    await expect(page.getByTestId(`convite-${email}`)).toHaveCount(0, { timeout: HTTP_TIMEOUT });

    // A tela do link diz O QUE ACONTECEU — não "inválido".
    const caminho = new URL(link).pathname;
    await page.goto(caminho);
    await expect(page.getByRole("heading", { name: /cancelad/i })).toBeVisible({ timeout: HTTP_TIMEOUT });
  });

  /**
   * A JORNADA QUE FALTAVA — e por faltar deixou a F20 passar quebrada.
   *
   * Em 23/09 um convidado real não entrou: o link curto levava a
   * `/signup?invite=`, que só entendia o token HMAC legado, e o cadastro da
   * produção estava fechado (`GOTRUE_DISABLE_SIGNUP=true`). As três jornadas
   * acima cobrem quem CONVIDA; nenhuma cobria quem é CONVIDADO (ADR-047).
   */
  test(`o convidado SEM conta abre o link, cria a conta e cai na empresa certa em ${lado}`, async ({ page, fixture }) => {
    await login(page, fixture.admin.email, fixture.password);
    await page.request.post("/api/v1/auth/active-org", { data: { organization_id: fixture.orgs[lado] }, timeout: HTTP_TIMEOUT });
    const email = `novato.${lado.toLowerCase()}.${fixture.suffix}@exemplo.test`;
    const { link } = await convidar(page, email);

    // A partir daqui é a pessoa convidada, que nunca entrou no produto.
    const convidado = await page.context().browser()!.newContext();
    const dele = await convidado.newPage();
    await dele.goto(new URL(link).pathname);

    // Sem conta, a tela precisa oferecer um caminho que FUNCIONE.
    await dele.getByRole("link", { name: /ainda não tenho conta|criar conta|cadastr/i }).click();
    await dele.waitForURL("**/signup**", { timeout: HTTP_TIMEOUT });

    // O convite tem de ter sido reconhecido: o e-mail vem travado e a tela não
    // pergunta nome de empresa — perguntar significa criar organização separada.
    await expect(dele.locator("#email")).toHaveValue(email, { timeout: HTTP_TIMEOUT });
    await expect(dele.locator("#org_name")).toHaveCount(0);

    await dele.locator("#password").fill("SenhaForte!2026");
    await dele.locator("#password_confirm").fill("SenhaForte!2026");
    await dele.getByRole("button", { name: /criar conta/i }).click();

    // Não pode sobrar na tela de erro genérica do §B29.
    await expect(dele.getByText(/não foi possível criar a conta/i)).toHaveCount(0, { timeout: HTTP_TIMEOUT });

    await login(dele, email, "SenhaForte!2026");
    const orgs = await dele.request.get("/api/v1/auth/active-org", { timeout: HTTP_TIMEOUT });
    expect(orgs.status(), await orgs.text()).toBe(200);
    const corpo = (await orgs.json()) as { data: { organization_id: string } };
    expect(corpo.data.organization_id, "o convidado tem de cair na empresa que o convidou").toBe(fixture.orgs[lado]);

    await convidado.close();
  });
}

test("o painel do dono lista os convites da empresa, emite um novo e o link anterior morre", async ({ page, fixture }) => {
  await login(page, fixture.dono.email, fixture.password);
  const org = fixture.orgs.A;
  const email = `dono.convida.${fixture.suffix}@exemplo.test`;

  const primeiro = await page.request.post(`/api/v1/admin/tenants/${org}/invites`, {
    data: { email, role: "admin" },
    timeout: HTTP_TIMEOUT,
  });
  expect(primeiro.status(), await primeiro.text()).toBe(201);
  const linkAntigo = ((await primeiro.json()) as { data: { invite: { link: string } } }).data.invite.link;

  await page.goto(`/admin/tenants/${org}/convites`);
  await expect(page.getByTestId(`admin-convite-${email}`)).toBeVisible({ timeout: HTTP_TIMEOUT });

  // Reenviar: link novo, e o anterior deixa de valer na hora (D61 b).
  const segundo = await page.request.post(`/api/v1/admin/tenants/${org}/invites`, {
    data: { email, role: "admin" },
    timeout: HTTP_TIMEOUT,
  });
  expect(segundo.status()).toBe(201);
  const corpo = (await segundo.json()) as { data: { invite: { link: string }; revogados: number } };
  expect(corpo.data.invite.link).not.toBe(linkAntigo);
  expect(corpo.data.revogados).toBe(1);

  await page.goto(new URL(linkAntigo).pathname);
  await expect(page.getByRole("heading", { name: /cancelad/i })).toBeVisible({ timeout: HTTP_TIMEOUT });
});
