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
  expect(r.status(), await r.text()).toBe(200);
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
