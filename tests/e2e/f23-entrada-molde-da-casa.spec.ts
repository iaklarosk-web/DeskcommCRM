/**
 * F23 · A TELA DE ENTRAR NO MOLDE DOS OS DA KN.
 *
 * O que esta spec mede: a forma da casca pública (formulário à esquerda,
 * apresentação à direita SÓ em tela larga), a marca da fachada e o caminho de
 * quem ainda não tem conta. O que ela NÃO mede: entrar de fato (auth.spec.ts),
 * a recuperação de senha (password-recovery.spec.ts) e o cruzamento do nome com
 * o título da aba (icone-da-marca.spec.ts) — cada uma continua dona do seu
 * pedaço.
 */
import { expect, test } from "@playwright/test";

test.describe("F23 · tela de entrar no molde da casa", () => {
  test("tela larga: formulário à esquerda e apresentação à direita; celular: só o formulário", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");

    const painel = page.getByRole("complementary", { name: /apresentação/i });
    await expect(painel).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/entre na sua conta/i);
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();

    // Esquerda/direita é geometria, não classe CSS: o campo termina antes de o
    // painel começar.
    const [campo, quadro] = await Promise.all([
      page.locator("#email").boundingBox(),
      painel.boundingBox(),
    ]);
    expect(campo, "campo de e-mail sem caixa").not.toBeNull();
    expect(quadro, "painel sem caixa").not.toBeNull();
    expect(campo!.x + campo!.width).toBeLessThanOrEqual(quadro!.x);

    // O painel é um argumento de venda com os quatro destaques do produto.
    await expect(painel.getByRole("listitem")).toHaveCount(4);
    await expect(painel.getByRole("link", { name: /conhecer os planos/i })).toHaveAttribute(
      "href",
      "/signup",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(painel).toBeHidden();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.getByRole("link", { name: "Criar conta" })).toBeVisible();
  });

  test("a fachada mostra o nome da instalação e leva quem não tem conta ao cadastro", async ({
    page,
  }) => {
    await page.goto("/login");

    // O nome vem do título da aba (`Entrar · <marca>`), não de literal aqui: a
    // spec vale para qualquer instalação, não só para a da KN.
    const casou = /^Entrar · (.+)$/.exec(await page.title());
    expect(casou, "título fora do formato 'Entrar · <marca>'").not.toBeNull();
    const marca = casou![1]!;
    await expect(page.getByTestId("marca-da-fachada")).toContainText(marca);

    await expect(page.getByRole("link", { name: "Esqueci minha senha" })).toHaveAttribute(
      "href",
      "/login/forgot",
    );
    await expect(page.getByRole("link", { name: "Termos" })).toHaveAttribute(
      "href",
      "/legal/terms",
    );
    await expect(page.getByRole("link", { name: "Privacidade" })).toHaveAttribute(
      "href",
      "/legal/privacy",
    );

    await page.getByRole("link", { name: "Criar conta" }).click();
    await expect(page).toHaveURL(/\/signup/);
    // A casca é a mesma: a marca continua no alto da tela de cadastro.
    await expect(page.getByTestId("marca-da-fachada")).toContainText(marca);
  });
  test("'Lembrar meu e-mail' guarda SÓ o e-mail neste aparelho, e some ao desmarcar", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.locator("#email").fill("lembrado@exemplo.test");
    await page.locator("#password").fill("senha-errada-de-proposito");
    await page.getByLabel(/lembrar meu e-mail/i).check();
    await page.getByRole("button", { name: /entrar/i }).click();
    // A senha está errada de propósito: o que se mede é o que sobrevive à recarga.
    await expect(page.getByRole("alert")).toBeVisible();

    await page.reload();
    await expect(page.locator("#email")).toHaveValue("lembrado@exemplo.test");
    await expect(page.getByLabel(/lembrar meu e-mail/i)).toBeChecked();
    await expect(page.locator("#password")).toHaveValue("");
    // Uma chave só, e ela é o e-mail: senha nunca vai para o storage.
    const guardado = await page.evaluate(() =>
      Object.entries(localStorage).filter(([k]) => k.includes("lembrar")),
    );
    expect(guardado).toEqual([["deskcomm-lembrar-email", "lembrado@exemplo.test"]]);

    await page.getByLabel(/lembrar meu e-mail/i).uncheck();
    await page.locator("#password").fill("senha-errada-de-proposito");
    await page.getByRole("button", { name: /entrar/i }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.reload();
    await expect(page.locator("#email")).toHaveValue("");
    await expect(page.getByLabel(/lembrar meu e-mail/i)).not.toBeChecked();
  });
});
