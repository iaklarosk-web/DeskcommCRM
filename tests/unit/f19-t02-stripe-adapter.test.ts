/**
 * F19-T02 — a parte PURA do gateway Stripe (ADR-042 §2), sem rede e sem banco:
 * a assinatura do webhook (HMAC + tolerância), a lista de preços, a allowlist
 * do evento, a tradução status → evento da F12 e a FORMA da chamada de
 * checkout (cartão sempre, trial de D57 c, `client_reference_id` =
 * organização). O que exige banco ou o provedor está em
 * `tests/integration/f19-cobranca-stripe.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  assinarComoOStripe,
  assinaturaDoStripeConfere,
  criarSessaoDeCheckout,
  eventoPeloStatus,
  lerAssinaturaDoStripe,
  lerCabecalhoDeAssinatura,
  lerEventoDoStripe,
  lerListaDePrecos,
  linkDoDashboard,
  precoDoPlano,
  StripeIndisponivel,
} from "@/src/billing/gateway/stripe";
import checkoutCompleted from "@/tests/fixtures/stripe/checkout.session.completed.json";
import subscriptionTrialing from "@/tests/fixtures/stripe/subscription.trialing.json";

const SECRET = "whsec_teste_nao_e_segredo_de_lugar_nenhum";
const CORPO = JSON.stringify(checkoutCompleted);
const AGORA = 1758290400;

describe("F19-T02: assinatura do webhook", () => {
  it("assinatura válida dentro da tolerância confere; v1 errado, t vencido e segredo vazio não conferem", () => {
    // Arrange
    const valida = assinarComoOStripe(CORPO, SECRET, AGORA);
    const outroSegredo = assinarComoOStripe(CORPO, "whsec_outro", AGORA);
    const vencida = assinarComoOStripe(CORPO, SECRET, AGORA - 301);
    const noLimite = assinarComoOStripe(CORPO, SECRET, AGORA - 300);

    // Act + Assert
    expect(assinaturaDoStripeConfere(CORPO, valida, SECRET, AGORA)).toBe(true);
    expect(assinaturaDoStripeConfere(CORPO, noLimite, SECRET, AGORA)).toBe(true);
    expect(assinaturaDoStripeConfere(CORPO, outroSegredo, SECRET, AGORA), "assinatura de outro segredo conferiu").toBe(false);
    expect(assinaturaDoStripeConfere(CORPO, vencida, SECRET, AGORA), "t vencido conferiu").toBe(false);
    expect(assinaturaDoStripeConfere(CORPO, valida, "", AGORA), "segredo vazio conferiu").toBe(false);
    expect(assinaturaDoStripeConfere(CORPO, null, SECRET, AGORA)).toBe(false);
    expect(assinaturaDoStripeConfere(`${CORPO} `, valida, SECRET, AGORA), "corpo alterado conferiu").toBe(false);
    console.info("f19-t02-assinatura: confere=2/2 nao_confere=5/5");
  });

  it("o cabeçalho aceita vários v1 (rotação de segredo) e recusa forma fora do padrão", () => {
    const v1Certo = assinarComoOStripe(CORPO, SECRET, AGORA).split("v1=")[1]!;
    const header = `t=${AGORA},v1=${"0".repeat(64)},v1=${v1Certo}`;
    expect(lerCabecalhoDeAssinatura(header)?.v1).toHaveLength(2);
    expect(assinaturaDoStripeConfere(CORPO, header, SECRET, AGORA)).toBe(true);
    expect(lerCabecalhoDeAssinatura("t=abc,v1=zz")).toBeNull();
    expect(lerCabecalhoDeAssinatura("")).toBeNull();
    expect(lerCabecalhoDeAssinatura(`v1=${v1Certo}`)).toBeNull();
  });
});

describe("F19-T02: lista de preços e allowlist do evento", () => {
  it("STRIPE_PRICE_IDS vira mapa price → plano; entrada malformada é ignorada; o inverso acha o price do plano", () => {
    const lista = lerListaDePrecos("price_1A:PLAN_A, price_1B:PLAN_B,lixo,price_x:plano minusculo,price_1C:PLAN_C");
    expect([...lista.entries()]).toEqual([["price_1A", "PLAN_A"], ["price_1B", "PLAN_B"], ["price_1C", "PLAN_C"]]);
    expect(precoDoPlano(lista, "PLAN_B")).toBe("price_1B");
    expect(precoDoPlano(lista, "PLAN_Z")).toBeNull();
    expect(lerListaDePrecos("").size).toBe(0);
  });

  it("lerEventoDoStripe lê só id/type/created/livemode/data.object e recusa forma fora do contrato", () => {
    const lido = lerEventoDoStripe(checkoutCompleted);
    expect(lido).toMatchObject({ id: "evt_1F19Fixture000000000001", type: "checkout.session.completed", created: 1758290400, livemode: false });
    expect(lido?.objeto.client_reference_id).toBe("f1900002-0000-4000-8000-000000000001");
    expect(lerEventoDoStripe({ ...checkoutCompleted, id: "not-an-event" })).toBeNull();
    expect(lerEventoDoStripe({ ...checkoutCompleted, livemode: "false" })).toBeNull();
    expect(lerEventoDoStripe({ ...checkoutCompleted, data: {} })).toBeNull();
    expect(lerEventoDoStripe("texto")).toBeNull();
    expect(lerEventoDoStripe(null)).toBeNull();
  });

  it("lerAssinaturaDoStripe pega status, customer, price e trial_end; customer expandido também", () => {
    const s = lerAssinaturaDoStripe(subscriptionTrialing);
    expect(s).toEqual({ id: "sub_1F19Fixture00000001", status: "trialing", customer: "cus_F19Fixture000001", price_id: "price_1F19FixturePlanA", trial_end: 1758895100, current_period_end: 1760882300 });
    expect(lerAssinaturaDoStripe({ ...subscriptionTrialing, customer: { id: "cus_exp", object: "customer" } })?.customer).toBe("cus_exp");
    expect(lerAssinaturaDoStripe({ id: "sub_x" })).toBeNull();
  });

  it("status do provedor → evento da F12: trialing/active pagam, past_due/unpaid falham, canceled cancela, o resto não move", () => {
    const mapa = Object.fromEntries(["trialing", "active", "past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused"].map((s) => [s, eventoPeloStatus(s)]));
    expect(mapa).toEqual({
      trialing: "payment_confirmed",
      active: "payment_confirmed",
      past_due: "payment_failed",
      unpaid: "payment_failed",
      canceled: "cancelled",
      incomplete: null,
      incomplete_expired: null,
      paused: null,
    });
    console.info("f19-t02-status: mapeados=8/8");
  });
});

describe("F19-T02: a chamada de checkout", () => {
  it("manda client_reference_id = organização, cartão sempre, trial de 7 dias, um line_item com o price, e devolve id+url", async () => {
    // Arrange — um fetch que guarda a requisição e responde como o Stripe
    const recebidas: Array<{ url: string; init: RequestInit }> = [];
    const fetchFalso: typeof fetch = async (url, init) => {
      recebidas.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ id: "cs_test_x", url: "https://checkout.stripe.com/c/pay/cs_test_x" }), { status: 200 });
    };

    // Act
    const sessao = await criarSessaoDeCheckout(
      { base: "https://api.stripe.com/", chave: "rk_test_falsa", fetch: fetchFalso },
      { organization_id: "f1900002-0000-4000-8000-000000000001", price_id: "price_1A", trial_days: 7, success_url: "http://app/ok", cancel_url: "http://app/nao", customer_email: "dono@f19.invalid" },
    );

    // Assert
    expect(sessao).toEqual({ id: "cs_test_x", url: "https://checkout.stripe.com/c/pay/cs_test_x" });
    expect(recebidas).toHaveLength(1);
    expect(recebidas[0]!.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    const headers = recebidas[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer rk_test_falsa");
    expect(headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    const form = Object.fromEntries(new URLSearchParams(String(recebidas[0]!.init.body)));
    expect(form).toMatchObject({
      mode: "subscription",
      client_reference_id: "f1900002-0000-4000-8000-000000000001",
      "line_items[0][price]": "price_1A",
      "line_items[0][quantity]": "1",
      payment_method_collection: "always",
      "subscription_data[trial_period_days]": "7",
      "subscription_data[metadata][organization_id]": "f1900002-0000-4000-8000-000000000001",
      customer_email: "dono@f19.invalid",
      success_url: "http://app/ok",
      cancel_url: "http://app/nao",
    });
    console.info("f19-t02-checkout: campos=10/10 cartao_sempre=1/1 trial_dias=7");
  });

  it("sem trial não manda trial_period_days; com customer_ref não manda customer_email; chave vazia é 503 sem chamar", async () => {
    const recebidas: string[] = [];
    const fetchFalso: typeof fetch = async (_url, init) => {
      recebidas.push(String(init?.body));
      return new Response(JSON.stringify({ id: "cs_1", url: "https://x" }), { status: 200 });
    };
    await criarSessaoDeCheckout(
      { base: "http://falso", chave: "k", fetch: fetchFalso },
      { organization_id: "f1900002-0000-4000-8000-000000000001", price_id: "price_1A", trial_days: 0, success_url: "a", cancel_url: "b", customer_ref: "cus_1", customer_email: "x@y" },
    );
    const form = Object.fromEntries(new URLSearchParams(recebidas[0]!));
    expect(form["subscription_data[trial_period_days]"]).toBeUndefined();
    expect(form.customer).toBe("cus_1");
    expect(form.customer_email).toBeUndefined();
    await expect(
      criarSessaoDeCheckout({ base: "http://falso", chave: "", fetch: fetchFalso }, { organization_id: "x", price_id: "price_1A", trial_days: 7, success_url: "a", cancel_url: "b" }),
    ).rejects.toBeInstanceOf(StripeIndisponivel);
    expect(recebidas).toHaveLength(1);
  });

  it("resposta não-2xx vira StripeIndisponivel com o status; o link do Dashboard segue o modo", async () => {
    const fetch401: typeof fetch = async () => new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), { status: 401 });
    await expect(
      criarSessaoDeCheckout({ base: "http://falso", chave: "k", fetch: fetch401 }, { organization_id: "x", price_id: "price_1A", trial_days: 7, success_url: "a", cancel_url: "b" }),
    ).rejects.toMatchObject({ name: "StripeIndisponivel", status: 401 });
    expect(linkDoDashboard("test", "sub_1")).toBe("https://dashboard.stripe.com/test/subscriptions/sub_1");
    expect(linkDoDashboard("live", "sub_1")).toBe("https://dashboard.stripe.com/subscriptions/sub_1");
  });
});
