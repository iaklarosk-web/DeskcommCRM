/**
 * O STRIPE FALSO da bancada (F19, ADR-042 §7; ADR-043 §4).
 *
 * Um servidor HTTP mínimo que responde às chamadas que o adapter faz
 * (`src/billing/gateway/stripe.ts`) e — quando ligado com `app` — serve uma
 * página de checkout com "Pagar" que ENTREGA ao app os webhooks assinados
 * (`checkout.session.completed` + `invoice.paid`, como o Stripe faz), e
 * redireciona ao `success_url`. É `.mjs` porque o Playwright o sobe como
 * segundo `webServer` (processo próprio) e a suíte de integração o importa em
 * processo — um código só para os dois usos.
 *
 * O que ele NÃO é: um emulador. Guarda o que recebeu (`chamadas`) e devolve o
 * que a bancada mandou devolver (`assinaturas`) — a verdade do teste está no
 * teste, não numa simulação.
 */
import { createHmac, randomBytes } from "node:crypto";
import http from "node:http";

const FIXTURE_TRIALING = {
  id: "sub_1F19Fixture00000001",
  object: "subscription",
  status: "trialing",
  customer: "cus_F19Fixture000001",
  trial_end: 1758895100,
  current_period_end: 1760882300,
  items: { object: "list", data: [{ id: "si_F19Fixture0001", object: "subscription_item", price: { id: "price_1F19FixturePlanA", object: "price" }, quantity: 1 }] },
  metadata: {},
  pause_collection: null,
};

export function assinarComoOStripe(corpo, secret, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${corpo}`, "utf8").digest("hex")}`;
}

function lerForm(texto) {
  return Object.fromEntries(new URLSearchParams(texto));
}

/**
 * @param {object} opts
 * @param {string} opts.chave — a chave que o adapter tem de mandar em `Authorization: Bearer`
 * @param {string} [opts.webhookSecret] — o `whsec` com que a página de checkout assina o que entrega
 * @param {string} [opts.app] — base do app (ex.: http://localhost:3202) para entregar webhooks
 * @param {number} [opts.porta] — 0 = efêmera
 */
export async function subirStripeFalso(opts) {
  /** @type {Array<{metodo: string, caminho: string, form: Record<string,string>|null, auth: string|null}>} */
  const chamadas = [];
  /** @type {Map<string, any>} id → objeto subscription devolvido em GET/POST */
  const assinaturas = new Map();
  /** @type {Map<string, {organization_id: string, price: string, trial_days: number, success_url: string, cancel_url: string, customer: string|null, subscription: string}>} */
  const sessoes = new Map();
  /** @type {Map<string, any>} Products e Prices do provisionamento */
  const produtos = new Map();
  const precos = new Map();
  let seq = 0;

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://falso");
    let corpo = "";
    for await (const parte of req) corpo += parte;
    const responder = (status, obj, tipo = "application/json") => {
      res.writeHead(status, { "content-type": tipo });
      res.end(typeof obj === "string" ? obj : JSON.stringify(obj));
    };
    if (url.pathname === "/health") return responder(200, { ok: true });

    // Página de checkout servida ao NAVEGADOR (e2e): "Pagar" entrega os webhooks.
    if (url.pathname.startsWith("/checkout/")) {
      const id = url.pathname.slice("/checkout/".length);
      const sessao = sessoes.get(id);
      if (!sessao) return responder(404, "sessão desconhecida", "text/plain");
      if (req.method === "POST" && opts.app && opts.webhookSecret) {
        const form = lerForm(corpo);
        const desfecho = form.outcome ?? "paid";
        const sub = assinaturas.get(sessao.subscription);
        const t = Math.floor(Date.now() / 1000);
        const eventos =
          desfecho === "paid"
            ? [
                evento(`evt_falso_${id}_1`, "checkout.session.completed", { id, object: "checkout.session", mode: "subscription", client_reference_id: sessao.organization_id, customer: sub.customer, subscription: sessao.subscription, status: "complete" }, t),
                evento(`evt_falso_${id}_2`, "invoice.paid", { id: `in_falso_${id}`, object: "invoice", subscription: sessao.subscription, customer: sub.customer, amount_paid: 0, status: "paid" }, t + 1),
              ]
            : [evento(`evt_falso_${id}_3`, "invoice.payment_failed", { id: `in_falso_${id}`, object: "invoice", subscription: sessao.subscription, customer: sub.customer, amount_paid: 0, status: "open" }, t)];
        const entregues = [];
        for (const ev of eventos) {
          const texto = JSON.stringify(ev);
          const r = await fetch(`${opts.app}/api/v1/webhooks/stripe`, {
            method: "POST",
            headers: { "content-type": "application/json", "stripe-signature": assinarComoOStripe(texto, opts.webhookSecret, ev.created) },
            body: texto,
          });
          entregues.push({ type: ev.type, status: r.status });
        }
        chamadas.push({ metodo: "WEBHOOKS", caminho: url.pathname, form: { entregues: JSON.stringify(entregues) }, auth: null });
        res.writeHead(303, { location: desfecho === "paid" ? sessao.success_url : sessao.cancel_url });
        return res.end();
      }
      return responder(
        200,
        `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Stripe falso — checkout</title></head><body>
<main data-testid="stripe-falso-checkout" data-session="${id}" data-organization="${sessao.organization_id}" data-price="${sessao.price}" data-trial-days="${sessao.trial_days}">
<h1>Checkout (Stripe FALSO da bancada)</h1>
<p data-testid="stripe-falso-status">open</p>
<form method="post"><input type="hidden" name="outcome" value="paid"><button type="submit" data-testid="stripe-falso-pagar">Pagar</button></form>
<form method="post"><input type="hidden" name="outcome" value="failed"><button type="submit" data-testid="stripe-falso-falhar">Falhar o pagamento</button></form>
</main></body></html>`,
        "text/html; charset=utf-8",
      );
    }

    // A API — tudo abaixo exige a chave.
    const auth = req.headers.authorization ?? null;
    const form = req.method === "POST" ? lerForm(corpo) : null;
    chamadas.push({ metodo: req.method ?? "?", caminho: url.pathname, form, auth });
    if (auth !== `Bearer ${opts.chave}`) return responder(401, { error: { type: "invalid_request_error", message: "Invalid API Key provided" } });

    if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
      seq += 1;
      const id = `cs_test_falso${String(seq).padStart(4, "0")}${randomBytes(6).toString("hex")}`;
      const subscription = `sub_falso${String(seq).padStart(4, "0")}`;
      const price = form["line_items[0][price]"];
      const organization_id = form.client_reference_id;
      const trial_days = Number(form["subscription_data[trial_period_days]"] ?? 0);
      const customer = form.customer ?? `cus_falso${String(seq).padStart(4, "0")}`;
      sessoes.set(id, { organization_id, price, trial_days, success_url: form.success_url, cancel_url: form.cancel_url, customer, subscription });
      const agora = Math.floor(Date.now() / 1000);
      assinaturas.set(subscription, {
        ...FIXTURE_TRIALING,
        id: subscription,
        customer,
        status: trial_days > 0 ? "trialing" : "active",
        trial_end: trial_days > 0 ? agora + trial_days * 86_400 : null,
        current_period_end: agora + 30 * 86_400,
        items: { object: "list", data: [{ id: `si_${subscription}`, object: "subscription_item", price: { id: price, object: "price" }, quantity: 1 }] },
        metadata: { organization_id },
      });
      const base = opts.app ? `http://127.0.0.1:${servidor.address().port}` : `http://127.0.0.1:${servidor.address().port}`;
      return responder(200, { id, object: "checkout.session", url: `${base}/checkout/${id}`, client_reference_id: organization_id, mode: "subscription", subscription });
    }
    const m = /^\/v1\/subscriptions\/([^/]+)$/.exec(url.pathname);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const sub = assinaturas.get(id);
      if (!sub) return responder(404, { error: { type: "invalid_request_error", message: `No such subscription: '${id}'` } });
      if (req.method === "POST") {
        if ("pause_collection[behavior]" in form) sub.pause_collection = { behavior: form["pause_collection[behavior]"] };
        if ("pause_collection" in form && form.pause_collection === "") sub.pause_collection = null;
        if ("trial_end" in form) {
          sub.trial_end = Number(form.trial_end);
          sub.status = "trialing";
        }
        assinaturas.set(id, sub);
      }
      return responder(200, sub);
    }
    // Provisionamento (scripts/stripe-provision.ts): Products por metadata, Prices, configuração do Portal.
    if (req.method === "GET" && url.pathname === "/v1/products/search") {
      const q = url.searchParams.get("query") ?? "";
      const os = /metadata\['os'\]:'([^']+)'/.exec(q)?.[1] ?? null;
      return responder(200, { object: "search_result", data: [...produtos.values()].filter((p) => os === null || p.metadata.os === os) });
    }
    if (req.method === "POST" && url.pathname === "/v1/products") {
      seq += 1;
      const produto = { id: `prod_falso${String(seq).padStart(4, "0")}`, object: "product", name: form.name, active: true, metadata: { os: form["metadata[os]"], plan_code: form["metadata[plan_code]"] } };
      produtos.set(produto.id, produto);
      return responder(200, produto);
    }
    if (req.method === "GET" && url.pathname === "/v1/prices") {
      const product = url.searchParams.get("product");
      return responder(200, { object: "list", data: [...precos.values()].filter((p) => p.product === product && p.active) });
    }
    if (req.method === "POST" && url.pathname === "/v1/prices") {
      seq += 1;
      const preco = { id: `price_falso${String(seq).padStart(4, "0")}`, object: "price", product: form.product, unit_amount: Number(form.unit_amount), currency: form.currency, active: true, recurring: { interval: form["recurring[interval]"] }, metadata: { plan_code: form["metadata[plan_code]"] } };
      precos.set(preco.id, preco);
      return responder(200, preco);
    }
    if (req.method === "POST" && url.pathname === "/v1/billing_portal/configurations") {
      seq += 1;
      return responder(200, { id: `bpc_falso${String(seq).padStart(4, "0")}`, object: "billing_portal.configuration", active: true });
    }
    if (req.method === "POST" && url.pathname === "/v1/billing_portal/sessions") {
      if (!form.customer) return responder(400, { error: { type: "invalid_request_error", message: "Missing required param: customer." } });
      return responder(200, { id: `bps_falso${randomBytes(4).toString("hex")}`, object: "billing_portal.session", customer: form.customer, url: `http://127.0.0.1:${servidor.address().port}/portal/${form.customer}`, return_url: form.return_url });
    }
    return responder(404, { error: { type: "invalid_request_error", message: `Unrecognized request URL (${req.method}: ${url.pathname}).` } });
  });

  await new Promise((resolve) => servidor.listen(opts.porta ?? 0, "127.0.0.1", resolve));
  const porta = servidor.address().port;
  return {
    base: `http://127.0.0.1:${porta}`,
    porta,
    chamadas,
    assinaturas,
    sessoes,
    produtos,
    precos,
    /** Muda o que o provedor responde para uma subscription (é assim que se mede `state_from_provider`). */
    definirAssinatura(id, obj) {
      assinaturas.set(id, { ...FIXTURE_TRIALING, ...obj, id });
    },
    parar: () => new Promise((resolve) => servidor.close(() => resolve())),
  };
}

function evento(id, type, objeto, created) {
  return { id, object: "event", api_version: "2025-08-27.basil", created, data: { object: objeto }, livemode: false, pending_webhooks: 1, request: { id: null, idempotency_key: null }, type };
}

// Processo próprio (Playwright `webServer`): STRIPE_FALSO_PORTA, STRIPE_FALSO_CHAVE,
// STRIPE_WEBHOOK_SECRET e STRIPE_FALSO_APP vêm do ambiente.
if (process.argv[1] && process.argv[1].endsWith("stripe-falso.mjs") && process.env.STRIPE_FALSO_PORTA) {
  const falso = await subirStripeFalso({
    porta: Number(process.env.STRIPE_FALSO_PORTA),
    chave: process.env.STRIPE_FALSO_CHAVE ?? "sk_test_falso",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    app: process.env.STRIPE_FALSO_APP ?? "",
  });
  console.info(`[stripe-falso] de pé em ${falso.base}; entrega webhooks em ${process.env.STRIPE_FALSO_APP ?? "(ninguém)"}`);
}
