/**
 * Gateway STRIPE (F19-T02, ADR-042 §2; D52 b, D57) — a parte PURA e o cliente
 * HTTP, separados de propósito: o que erra é a tradução (assinatura, livemode,
 * preço fora da lista, status do provedor → evento da F12), e ela precisa ser
 * exercitável sem rede. O I/O é um cliente mínimo por `fetch`, sem SDK, como o
 * módulo `billing/` do OS-Template (DF-33): quatro chamadas e `form-urlencoded`.
 *
 * Regras que vêm do kit e a F12 não tinha:
 *
 * 1. **Assinatura do webhook** (`Stripe-Signature: t=…,v1=…`): HMAC-SHA256 do
 *    `${t}.${corpo}` com o `whsec`, comparação em tempo constante, tolerância
 *    de 5 min no `t` (replay de evento velho é recusado mesmo com HMAC certo).
 * 2. **`livemode`** do evento tem de bater com `STRIPE_MODE`: evento live numa
 *    instalação de teste (ou o contrário) é 422 sem gravar.
 * 3. **Preço fora de `STRIPE_PRICE_IDS`** é 422 sem gravar: o Stripe reenvia
 *    por até 3 dias; corrige-se a lista ou a assinatura no Dashboard, e a
 *    conta fica como estava.
 * 4. **Estado buscado no provedor**: em `checkout.session.completed` e
 *    `customer.subscription.updated` o status vem de `GET /v1/subscriptions`,
 *    nunca do payload — fora de ordem entre eventos do Stripe não inventa
 *    estado.
 *
 * O que NÃO está aqui: o receptor (`src/billing/webhook-stripe.ts`), que acha a
 * organização e chama `aplicarEventoDoGateway`; e a tela.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { TipoDeEventoDoGateway } from "../estados";

export const GATEWAY_STRIPE = "stripe" as const;
export const CABECALHO_DA_ASSINATURA_STRIPE = "stripe-signature";
/** Tolerância do `t` da assinatura (segundos) — o padrão do SDK oficial. */
export const TOLERANCIA_DA_ASSINATURA_S = 300;

// ---------------------------------------------------------------------------
// 1 · Assinatura do webhook
// ---------------------------------------------------------------------------

/** Lê `t=<unix>,v1=<hex>[,v1=<hex>…]`. Cabeçalho fora da forma → null. */
export function lerCabecalhoDeAssinatura(header: string | null): { t: number; v1: readonly string[] } | null {
  if (header === null || header.length === 0) return null;
  let t: number | null = null;
  const v1: string[] = [];
  for (const parte of header.split(",")) {
    const [chave, valor] = parte.trim().split("=", 2);
    if (chave === "t" && valor !== undefined && /^\d+$/.test(valor)) t = Number(valor);
    else if (chave === "v1" && valor !== undefined && /^[0-9a-f]{64}$/.test(valor)) v1.push(valor);
  }
  if (t === null || v1.length === 0) return null;
  return { t, v1 };
}

export function assinarComoOStripe(corpo: string, secret: string, t: number): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${corpo}`, "utf8").digest("hex")}`;
}

/**
 * `true` só quando UM dos `v1` bate em tempo constante E o `t` está dentro da
 * tolerância. Segredo vazio nunca confere (fail closed — quem chama já
 * respondeu 503 antes, mas a função não pode depender disso).
 */
export function assinaturaDoStripeConfere(
  corpo: string,
  header: string | null,
  secret: string,
  agoraUnix: number,
  toleranciaS: number = TOLERANCIA_DA_ASSINATURA_S,
): boolean {
  if (secret.length === 0) return false;
  const lido = lerCabecalhoDeAssinatura(header);
  if (lido === null) return false;
  if (Math.abs(agoraUnix - lido.t) > toleranciaS) return false; // MUTANT: stripe-tolerancia
  const esperado = Buffer.from(createHmac("sha256", secret).update(`${lido.t}.${corpo}`, "utf8").digest("hex"), "utf8");
  return lido.v1.some((v) => {
    const recebido = Buffer.from(v, "utf8");
    return recebido.length === esperado.length && timingSafeEqual(recebido, esperado); // MUTANT: stripe-assinatura
  });
}

// ---------------------------------------------------------------------------
// 2 · Lista de preços — `price_x:PLAN_A,price_y:PLAN_B`
// ---------------------------------------------------------------------------

export function lerListaDePrecos(bruto: string): ReadonlyMap<string, string> {
  const mapa = new Map<string, string>();
  for (const par of bruto.split(",")) {
    const [preco, plano] = par.trim().split(":", 2);
    if (preco && plano && /^price_[A-Za-z0-9]+$/.test(preco) && /^[A-Z][A-Z0-9_]{1,31}$/.test(plano)) mapa.set(preco, plano);
  }
  return mapa;
}

/** O inverso: o `price_…` de um plano, ou null quando o plano não está provisionado. */
export function precoDoPlano(lista: ReadonlyMap<string, string>, planCode: string): string | null {
  for (const [preco, plano] of lista) if (plano === planCode) return preco;
  return null;
}

// ---------------------------------------------------------------------------
// 3 · O recorte do que o Stripe manda (allowlist — G-42)
// ---------------------------------------------------------------------------

/** Os tipos que o receptor trata; o resto é `ignored` (200). */
export const TIPOS_TRATADOS = [
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;
export type TipoTratado = (typeof TIPOS_TRATADOS)[number];

export interface EventoDoStripe {
  readonly id: string;
  readonly type: string;
  readonly created: number;
  readonly livemode: boolean;
  readonly objeto: Readonly<Record<string, unknown>>;
}

/** Lê só o que o receptor usa; forma fora do contrato → null (422). */
export function lerEventoDoStripe(bruto: unknown): EventoDoStripe | null {
  if (typeof bruto !== "object" || bruto === null) return null;
  const e = bruto as Record<string, unknown>;
  const data = e.data as Record<string, unknown> | undefined;
  const objeto = data?.object;
  if (
    typeof e.id !== "string" || !/^evt_[A-Za-z0-9]+$/.test(e.id) ||
    e.object !== "event" ||
    typeof e.type !== "string" ||
    typeof e.created !== "number" || !Number.isInteger(e.created) ||
    typeof e.livemode !== "boolean" ||
    typeof objeto !== "object" || objeto === null
  ) {
    return null;
  }
  return { id: e.id, type: e.type, created: e.created, livemode: e.livemode, objeto: objeto as Record<string, unknown> };
}

export function ehTipoTratado(tipo: string): tipo is TipoTratado {
  return (TIPOS_TRATADOS as readonly string[]).includes(tipo);
}

/** O recorte da subscription do Stripe que a tradução consome. */
export interface AssinaturaDoStripe {
  readonly id: string;
  readonly status: string;
  readonly customer: string | null;
  readonly price_id: string | null;
  readonly trial_end: number | null;
  readonly current_period_end: number | null;
  /** `in_…` da fatura do ciclo corrente — a referência ESTÁVEL da fatura no CRM. */
  readonly latest_invoice: string | null;
}

export function lerAssinaturaDoStripe(bruto: unknown): AssinaturaDoStripe | null {
  if (typeof bruto !== "object" || bruto === null) return null;
  const s = bruto as Record<string, unknown>;
  if (typeof s.id !== "string" || typeof s.status !== "string") return null;
  const items = s.items as { data?: Array<{ price?: { id?: unknown } }> } | undefined;
  const priceId = items?.data?.[0]?.price?.id;
  const customer = typeof s.customer === "string" ? s.customer : typeof (s.customer as { id?: unknown })?.id === "string" ? String((s.customer as { id: string }).id) : null;
  return {
    id: s.id,
    status: s.status,
    customer,
    price_id: typeof priceId === "string" ? priceId : null,
    trial_end: typeof s.trial_end === "number" ? s.trial_end : null,
    current_period_end: typeof s.current_period_end === "number" ? s.current_period_end : null,
    latest_invoice: typeof s.latest_invoice === "string" ? s.latest_invoice : typeof (s.latest_invoice as { id?: unknown })?.id === "string" ? String((s.latest_invoice as { id: string }).id) : null,
  };
}

// ---------------------------------------------------------------------------
// 4 · Tradução: status do provedor → evento da F12
// ---------------------------------------------------------------------------

/**
 * `trialing`/`active` pagam (D57 c: trial é acesso liberado com cartão no
 * arquivo); `past_due`/`unpaid` abrem a carência; `canceled` cancela;
 * `incomplete`/`incomplete_expired`/`paused` não movem nada (null).
 */
export function eventoPeloStatus(status: string): TipoDeEventoDoGateway | null {
  switch (status) {
    case "trialing":
    case "active":
      return "payment_confirmed";
    case "past_due":
    case "unpaid":
      return "payment_failed";
    case "canceled":
      return "cancelled";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 5 · Cliente HTTP mínimo (sem SDK)
// ---------------------------------------------------------------------------

export interface ConfigDoCliente {
  readonly base: string;
  readonly chave: string;
  readonly fetch?: typeof fetch;
}

export class StripeIndisponivel extends Error {
  constructor(
    public readonly status: number,
    public readonly detalhe: string,
  ) {
    super(`Stripe respondeu ${status}: ${detalhe}`);
    this.name = "StripeIndisponivel";
  }
}

function paraForm(params: Readonly<Record<string, string | number | boolean | undefined>>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) p.set(k, String(v));
  return p.toString();
}

async function chamar(cfg: ConfigDoCliente, metodo: "GET" | "POST", caminho: string, form?: string): Promise<unknown> {
  if (cfg.chave.length === 0) throw new StripeIndisponivel(503, "STRIPE_SECRET_KEY vazia");
  const f = cfg.fetch ?? fetch;
  const headers: Record<string, string> = { authorization: `Bearer ${cfg.chave}` };
  if (metodo === "POST") {
    headers["content-type"] = "application/x-www-form-urlencoded";
    headers["idempotency-key"] = randomUUID();
  }
  const resposta = await f(`${cfg.base.replace(/\/$/, "")}${caminho}`, { method: metodo, headers, body: form });
  const texto = await resposta.text();
  if (!resposta.ok) throw new StripeIndisponivel(resposta.status, texto.slice(0, 300));
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    throw new StripeIndisponivel(502, "resposta não é JSON");
  }
}

export interface SessaoDeCheckout {
  readonly id: string;
  readonly url: string;
}

export interface EntradaDoCheckout {
  readonly organization_id: string;
  readonly price_id: string;
  readonly trial_days: number;
  readonly success_url: string;
  readonly cancel_url: string;
  readonly customer_ref?: string | null;
  readonly customer_email?: string | null;
}

/** `POST /v1/checkout/sessions` — `client_reference_id` = organização (é por ele que o webhook a acha). */
export async function criarSessaoDeCheckout(cfg: ConfigDoCliente, entrada: EntradaDoCheckout): Promise<SessaoDeCheckout> {
  const form = paraForm({
    mode: "subscription",
    client_reference_id: entrada.organization_id,
    "line_items[0][price]": entrada.price_id,
    "line_items[0][quantity]": 1,
    success_url: entrada.success_url,
    cancel_url: entrada.cancel_url,
    // D57 c: cartão SEMPRE, com ou sem trial.
    payment_method_collection: "always",
    "subscription_data[trial_period_days]": entrada.trial_days > 0 ? entrada.trial_days : undefined,
    "subscription_data[metadata][organization_id]": entrada.organization_id,
    customer: entrada.customer_ref ?? undefined,
    customer_email: entrada.customer_ref ? undefined : (entrada.customer_email ?? undefined),
  });
  const r = (await chamar(cfg, "POST", "/v1/checkout/sessions", form)) as { id?: unknown; url?: unknown };
  if (typeof r.id !== "string" || typeof r.url !== "string") throw new StripeIndisponivel(502, "sessão de checkout sem id/url");
  return { id: r.id, url: r.url };
}

/** `GET /v1/subscriptions/{id}` — o ESTADO, sempre daqui (regra 4). */
export async function buscarAssinatura(cfg: ConfigDoCliente, id: string): Promise<AssinaturaDoStripe> {
  const r = lerAssinaturaDoStripe(await chamar(cfg, "GET", `/v1/subscriptions/${encodeURIComponent(id)}`));
  if (r === null) throw new StripeIndisponivel(502, "subscription fora da forma");
  return r;
}

/** `POST /v1/billing_portal/sessions` — troca de plano e cancelamento acontecem lá (D57 b). */
export async function criarSessaoDoPortal(
  cfg: ConfigDoCliente,
  entrada: { customer_ref: string; return_url: string; configuration?: string },
): Promise<{ url: string }> {
  const r = (await chamar(
    cfg,
    "POST",
    "/v1/billing_portal/sessions",
    paraForm({ customer: entrada.customer_ref, return_url: entrada.return_url, configuration: entrada.configuration || undefined }),
  )) as { url?: unknown };
  if (typeof r.url !== "string") throw new StripeIndisponivel(502, "sessão do portal sem url");
  return { url: r.url };
}

/** Padrão KN do /admin (ADR-042 §5): suspender = `pause_collection`, reativar = limpar. */
export async function pausarCobranca(cfg: ConfigDoCliente, subscriptionId: string, pausar: boolean): Promise<AssinaturaDoStripe> {
  const form = pausar ? "pause_collection[behavior]=void" : "pause_collection=";
  const r = lerAssinaturaDoStripe(await chamar(cfg, "POST", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, form));
  if (r === null) throw new StripeIndisponivel(502, "subscription fora da forma");
  return r;
}

/** Padrão KN do /admin: estender o trial até `trialEndUnix` (1..90 dias — quem chama limita). */
export async function estenderTrial(cfg: ConfigDoCliente, subscriptionId: string, trialEndUnix: number): Promise<AssinaturaDoStripe> {
  const r = lerAssinaturaDoStripe(
    await chamar(cfg, "POST", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, paraForm({ trial_end: trialEndUnix, proration_behavior: "none" })),
  );
  if (r === null) throw new StripeIndisponivel(502, "subscription fora da forma");
  return r;
}

/** Link "abrir no Stripe" (Dashboard), pelo modo — sem chamada. */
export function linkDoDashboard(modo: "test" | "live", subscriptionId: string): string {
  return `https://dashboard.stripe.com/${modo === "test" ? "test/" : ""}subscriptions/${encodeURIComponent(subscriptionId)}`;
}

// ---------------------------------------------------------------------------
// 6 · Provisionamento (scripts/stripe-provision.ts) — Products, Prices, Portal
// ---------------------------------------------------------------------------

export interface ProdutoDoStripe {
  readonly id: string;
  readonly name: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface PrecoDoStripe {
  readonly id: string;
  readonly product: string;
  readonly unit_amount: number | null;
  readonly currency: string;
  readonly active: boolean;
}

function lerProduto(bruto: unknown): ProdutoDoStripe | null {
  const p = bruto as { id?: unknown; name?: unknown; metadata?: unknown } | null;
  if (!p || typeof p.id !== "string" || typeof p.name !== "string") return null;
  return { id: p.id, name: p.name, metadata: (p.metadata as Record<string, string> | undefined) ?? {} };
}

function lerPreco(bruto: unknown): PrecoDoStripe | null {
  const p = bruto as { id?: unknown; product?: unknown; unit_amount?: unknown; currency?: unknown; active?: unknown } | null;
  if (!p || typeof p.id !== "string" || typeof p.product !== "string") return null;
  return { id: p.id, product: p.product, unit_amount: typeof p.unit_amount === "number" ? p.unit_amount : null, currency: String(p.currency ?? ""), active: p.active !== false };
}

/** `GET /v1/products/search?query=metadata['os']:'<os>'` — os Products deste OS (DF-33: um por plano). */
export async function buscarProdutosDoOs(cfg: ConfigDoCliente, os: string): Promise<ProdutoDoStripe[]> {
  const r = (await chamar(cfg, "GET", `/v1/products/search?query=${encodeURIComponent(`metadata['os']:'${os}' AND active:'true'`)}&limit=100`)) as { data?: unknown[] };
  return (r.data ?? []).map(lerProduto).filter((p): p is ProdutoDoStripe => p !== null);
}

export async function criarProduto(cfg: ConfigDoCliente, entrada: { name: string; os: string; plan_code: string; description?: string }): Promise<ProdutoDoStripe> {
  const r = lerProduto(
    await chamar(cfg, "POST", "/v1/products", paraForm({ name: entrada.name, description: entrada.description, "metadata[os]": entrada.os, "metadata[plan_code]": entrada.plan_code })),
  );
  if (r === null) throw new StripeIndisponivel(502, "product fora da forma");
  return r;
}

/** `GET /v1/prices?product=…&active=true` */
export async function listarPrecosDoProduto(cfg: ConfigDoCliente, productId: string): Promise<PrecoDoStripe[]> {
  const r = (await chamar(cfg, "GET", `/v1/prices?product=${encodeURIComponent(productId)}&active=true&limit=100`)) as { data?: unknown[] };
  return (r.data ?? []).map(lerPreco).filter((p): p is PrecoDoStripe => p !== null);
}

export async function criarPreco(cfg: ConfigDoCliente, entrada: { product: string; unit_amount: number; currency: string; interval: "month" | "year"; plan_code: string }): Promise<PrecoDoStripe> {
  const r = lerPreco(
    await chamar(
      cfg,
      "POST",
      "/v1/prices",
      paraForm({ product: entrada.product, unit_amount: entrada.unit_amount, currency: entrada.currency, "recurring[interval]": entrada.interval, "metadata[plan_code]": entrada.plan_code }),
    ),
  );
  if (r === null) throw new StripeIndisponivel(502, "price fora da forma");
  return r;
}

/**
 * `POST /v1/billing_portal/configurations` — o Portal que troca entre os
 * preços listados, cancela ao fim do período e atualiza o cartão (D57 b).
 */
export async function criarConfiguracaoDoPortal(cfg: ConfigDoCliente, entrada: { headline: string; produtos: ReadonlyArray<{ product: string; prices: readonly string[] }> }): Promise<{ id: string }> {
  const params: Record<string, string | number | boolean | undefined> = {
    "business_profile[headline]": entrada.headline,
    "features[payment_method_update][enabled]": true,
    "features[subscription_cancel][enabled]": true,
    "features[subscription_cancel][mode]": "at_period_end",
    "features[subscription_update][enabled]": true,
    "features[subscription_update][default_allowed_updates][0]": "price",
    "features[subscription_update][proration_behavior]": "none",
    "features[invoice_history][enabled]": true,
  };
  entrada.produtos.forEach((p, i) => {
    params[`features[subscription_update][products][${i}][product]`] = p.product;
    p.prices.forEach((preco, j) => {
      params[`features[subscription_update][products][${i}][prices][${j}]`] = preco;
    });
  });
  const r = (await chamar(cfg, "POST", "/v1/billing_portal/configurations", paraForm(params))) as { id?: unknown };
  if (typeof r.id !== "string") throw new StripeIndisponivel(502, "configuração do portal sem id");
  return { id: r.id };
}
