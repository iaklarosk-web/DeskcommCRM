/**
 * A ABA EQUIPE DO /admin (F21, ADR-048) — em navegador.
 *
 * A fase nasceu de um caso real. Em 24/09/2026 o proprietário abriu o /admin e
 * perguntou por que as abas Equipe e Uso não abriam: estavam `disabled: true`,
 * sem rota e sem registro em documento nenhum. Horas depois, fechado o D60, ele
 * precisou sair do tenant do cliente — e NÃO HAVIA TELA. A remoção saiu por
 * `DELETE` em psql, sem linha em `api_audit_log`, com a regra do último admin
 * conferida na mão, por atenção humana.
 *
 * O que estas jornadas guardam é justamente o que a atenção humana garantiu
 * naquele dia e o código não garantia.
 */
import { test as base, expect, type Page } from "@playwright/test";

import { cleanupF11F12, seedF11F12, type F11F12Fixture } from "./utils/f11-f12-fixture";
import { f02E2eSandbox } from "./utils/f02-crm-cadastros";

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

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL("**/app/**", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });
}

/** Segundo admin, para haver o que remover sem esbarrar na regra. */
async function segundoAdmin(orgId: string, userId: string) {
  const r = await f02E2eSandbox()
    .from("user_organizations" as never)
    .insert({ organization_id: orgId, user_id: userId, role: "admin", accepted_at: new Date().toISOString() } as never);
  if (r.error) throw r.error;
}

test("o dono vê a equipe da empresa e remove quem sobra — mas a tela RECUSA deixar a empresa sem admin", async ({
  page,
  fixture,
}) => {
  const org = fixture.orgs.A;
  await segundoAdmin(org, fixture.dono.id);
  await login(page, fixture.dono.email, fixture.password);

  await page.goto(`/admin/tenants/${org}/team`);
  await expect(page.getByTestId("admin-equipe")).toBeVisible({ timeout: HTTP_TIMEOUT });
  await expect(page.getByTestId(`membro-${fixture.admin.email}`)).toBeVisible({ timeout: HTTP_TIMEOUT });
  await expect(page.getByTestId(`membro-${fixture.dono.email}`)).toBeVisible({ timeout: HTTP_TIMEOUT });

  // Com DOIS admins, sair é permitido — foi o caso real de 25/09.
  await page.getByTestId(`membro-remover-${fixture.dono.email}`).click();
  await expect(page.getByTestId(`membro-${fixture.dono.email}`)).toHaveCount(0, { timeout: HTTP_TIMEOUT });

  // Agora sobra UM admin. A tela tem de recusar, e DIZER POR QUÊ — não um erro
  // genérico: é a mensagem que diz à pessoa o que fazer a seguir.
  await page.getByTestId(`membro-remover-${fixture.admin.email}`).click();
  const erro = page.getByTestId("admin-equipe-erro");
  await expect(erro).toBeVisible({ timeout: HTTP_TIMEOUT });
  await expect(erro).toContainText(/último|ultima|última pessoa com papel de administrador/i);
  // E o membro continua lá: recusar significa não ter feito.
  await expect(page.getByTestId(`membro-${fixture.admin.email}`)).toBeVisible();
});

test("rebaixar o último admin é recusado pela MESMA regra — a órfã por outra porta", async ({ page, fixture }) => {
  const org = fixture.orgs.B;
  await login(page, fixture.dono.email, fixture.password);

  // Pela API, que é o que um script futuro usaria: a regra não pode morar só na tela.
  const r = await page.request.patch(`/api/v1/admin/tenants/${org}/team/${fixture.admin.id}`, {
    data: { role: "manager" },
    timeout: HTTP_TIMEOUT,
  });
  expect(r.status(), await r.text()).toBe(409);
  const corpo = (await r.json()) as { error: { code: string; message: string } };
  expect(corpo.error.code).toBe("ultimo_admin");
  expect(corpo.error.message).toMatch(/administrador/i);
});

test("a aba Equipe existe na barra do tenant e abre — não é mais vitrine", async ({ page, fixture }) => {
  await login(page, fixture.dono.email, fixture.password);
  await page.goto(`/admin/tenants/${fixture.orgs.A}`);

  const aba = page.getByRole("link", { name: /equipe/i });
  await expect(aba).toBeVisible({ timeout: HTTP_TIMEOUT });
  await aba.click();
  await expect(page.getByTestId("admin-equipe")).toBeVisible({ timeout: HTTP_TIMEOUT });
});
