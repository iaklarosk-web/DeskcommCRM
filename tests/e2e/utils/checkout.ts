/**
 * Pagar no checkout do GATEWAY CONFIGURADO (F19-T05, ADR-042 §4; ADR-043 §4).
 *
 * As specs herdadas da F11/F12 percorriam a página `mock-checkout` por URL e
 * testid. Com o gate rodando `BILLING_GATEWAY=stripe` contra o Stripe falso,
 * o botão "Contratar" leva a OUTRO site (a página de checkout do falso). Este
 * helper aceita os dois e DECLARA no log qual exercitou — a suíte herdada
 * mede o gateway que está de pé, não um fixo (RETOMADA regra 4).
 *
 * Nos dois caminhos quem ativa é o WEBHOOK (D38): o navegador só volta para
 * `/app/billing`; quem afirma "ativou" consulta o banco depois.
 */
import { expect, type Page } from "@playwright/test";

export type GatewayExercitado = "mock" | "stripe";

const HTTP_TIMEOUT = 30_000;

/** Clica em "Contratar/Pagar agora" do plano e paga na página do gateway que abrir. */
export async function pagarNoCheckout(page: Page, planCode: string, desfecho: "paid" | "failed" = "paid"): Promise<GatewayExercitado> {
  await Promise.all([
    page.waitForURL((url) => /\/app\/billing\/mock-checkout\//.test(url.pathname) || /\/checkout\//.test(url.pathname), { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" }),
    page.getByTestId(`billing-checkout-${planCode}`).click(),
  ]);
  const url = new URL(page.url());
  if (/\/app\/billing\/mock-checkout\//.test(url.pathname)) {
    await expect(page.getByTestId("mock-checkout")).toBeVisible();
    expect(await page.getByTestId("mock-checkout-status").textContent()).toBe("open");
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/billing/mock-checkout", { timeout: HTTP_TIMEOUT }),
      page.getByTestId(desfecho === "paid" ? "mock-checkout-pagar" : "mock-checkout-falhar").click(),
    ]);
    await page.waitForURL("**/app/billing**", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" });
    console.info(`checkout: gateway=mock desfecho=${desfecho}`);
    return "mock";
  }
  // O Stripe falso: outro site, página com "Pagar"; o POST entrega os webhooks e volta ao success_url.
  await expect(page.getByTestId("stripe-falso-checkout")).toBeVisible();
  expect(await page.getByTestId("stripe-falso-status").textContent()).toBe("open");
  await Promise.all([
    page.waitForURL("**/app/billing**", { timeout: HTTP_TIMEOUT, waitUntil: "domcontentloaded" }),
    page.getByTestId(desfecho === "paid" ? "stripe-falso-pagar" : "stripe-falso-falhar").click(),
  ]);
  console.info(`checkout: gateway=stripe desfecho=${desfecho}`);
  return "stripe";
}
