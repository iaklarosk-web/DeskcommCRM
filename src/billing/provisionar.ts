/**
 * PROVISIONAMENTO no Stripe (F19-T04, ADR-042 §5; DF-33 do OS-Template): um
 * Product por plano (metadata `os` + `plan_code`), um Price recorrente por
 * Product e a configuração do Customer Portal que troca entre eles. É o
 * núcleo puro-de-rede do `scripts/stripe-provision.ts`: recebe o cliente e
 * devolve as duas linhas de env que a instalação precisa
 * (`STRIPE_PRICE_IDS`, `STRIPE_PORTAL_CONFIGURATION_ID`).
 *
 * Idempotente por metadata: Product que já existe para (os, plan_code) é
 * reaproveitado; Price ativo com o mesmo valor/moeda/intervalo também. Rodar
 * duas vezes cria zero coisas novas — a prova conta.
 *
 * Preços PLACEHOLDER (D57 d): R$ 10/20/30 por mês, rotulados "(placeholder)"
 * no nome do Product, em modo TEST. Nome e preço REAIS continuam D14 — este
 * módulo nunca decide um valor: quem chama passa a lista.
 */
import {
  buscarProdutosDoOs,
  criarConfiguracaoDoPortal,
  criarPreco,
  criarProduto,
  listarPrecosDoProduto,
  type ConfigDoCliente,
} from "./gateway/stripe";

export interface PlanoAProvisionar {
  readonly plan_code: string;
  readonly nome: string;
  readonly unit_amount: number;
  readonly currency: string;
  readonly interval: "month" | "year";
}

export interface ResultadoDoProvisionamento {
  readonly os: string;
  readonly produtos: ReadonlyArray<{ plan_code: string; product: string; price: string; criado_product: boolean; criado_price: boolean }>;
  readonly portal_configuration: string;
  readonly env: { STRIPE_PRICE_IDS: string; STRIPE_PORTAL_CONFIGURATION_ID: string };
  readonly criados: number;
  readonly reaproveitados: number;
}

/** Os três placeholders de D57 d, em centavos de BRL. */
export const PLANOS_PLACEHOLDER: readonly PlanoAProvisionar[] = [
  { plan_code: "PLAN_A", nome: "PLAN_A (placeholder)", unit_amount: 1000, currency: "brl", interval: "month" },
  { plan_code: "PLAN_B", nome: "PLAN_B (placeholder)", unit_amount: 2000, currency: "brl", interval: "month" },
  { plan_code: "PLAN_C", nome: "PLAN_C (placeholder)", unit_amount: 3000, currency: "brl", interval: "month" },
];

export async function provisionar(
  cfg: ConfigDoCliente,
  entrada: { os: string; headline: string; planos: readonly PlanoAProvisionar[]; portal_configuration?: string | null },
): Promise<ResultadoDoProvisionamento> {
  const existentes = await buscarProdutosDoOs(cfg, entrada.os);
  const produtos: Array<{ plan_code: string; product: string; price: string; criado_product: boolean; criado_price: boolean }> = [];
  let criados = 0;
  let reaproveitados = 0;
  for (const plano of entrada.planos) {
    let product = existentes.find((p) => p.metadata.plan_code === plano.plan_code) ?? null;
    let criadoProduct = false;
    if (product === null) {
      product = await criarProduto(cfg, { name: plano.nome, os: entrada.os, plan_code: plano.plan_code, description: `Plano ${plano.plan_code} do ${entrada.os} — placeholder até D14` });
      criadoProduct = true;
      criados++;
    } else reaproveitados++;
    const precos = await listarPrecosDoProduto(cfg, product.id);
    let price = precos.find((p) => p.unit_amount === plano.unit_amount && p.currency.toLowerCase() === plano.currency.toLowerCase()) ?? null;
    let criadoPrice = false;
    if (price === null) {
      price = await criarPreco(cfg, { product: product.id, unit_amount: plano.unit_amount, currency: plano.currency, interval: plano.interval, plan_code: plano.plan_code });
      criadoPrice = true;
      criados++;
    } else reaproveitados++;
    produtos.push({ plan_code: plano.plan_code, product: product.id, price: price.id, criado_product: criadoProduct, criado_price: criadoPrice });
  }
  let portal = entrada.portal_configuration ?? null;
  if (portal === null || portal.length === 0) {
    portal = (await criarConfiguracaoDoPortal(cfg, { headline: entrada.headline, produtos: produtos.map((p) => ({ product: p.product, prices: [p.price] })) })).id;
    criados++;
  } else reaproveitados++;
  return {
    os: entrada.os,
    produtos,
    portal_configuration: portal,
    env: {
      STRIPE_PRICE_IDS: produtos.map((p) => `${p.price}:${p.plan_code}`).join(","),
      STRIPE_PORTAL_CONFIGURATION_ID: portal,
    },
    criados,
    reaproveitados,
  };
}
