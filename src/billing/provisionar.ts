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
 * no nome do Product, em modo TEST. Nome e preço REAIS são D14 — decididos
 * em D58 b (20/09/2026) e gravados em `plans` pela 9034 (`source='owner'`):
 * `planosAProvisionar` lê ESSAS linhas e só cai nos placeholders quando falta
 * decisão. Este módulo continua sem decidir valor: quem chama passa a lista.
 *
 * Preço antigo (F19-T06, objeção 2 do contraponto): Price no Stripe é
 * imutável — mudar o valor cria um Price novo, e o antigo continua ativo
 * nas assinaturas que nasceram nele. `STRIPE_PRICE_IDS` lista o vigente e,
 * DEPOIS dele, os antigos do mesmo Product (`montarListaDePrecos`): o
 * webhook aceita os dois (`lerListaDePrecos`), o Checkout e o Portal oferecem
 * só o vigente (`precoDoPlano` devolve o primeiro).
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

/** Uma linha de `public.plans` (F12: 9023; F19-T06: 9034) como o script a lê do banco. */
export interface LinhaDePlano {
  readonly code: string;
  readonly name: string;
  readonly price_cents: number;
  readonly currency: string;
  readonly source: "placeholder" | "owner";
  readonly active: boolean;
}

export interface ProdutoProvisionado {
  readonly plan_code: string;
  readonly product: string;
  readonly price: string;
  readonly precos_legado: readonly string[];
  readonly criado_product: boolean;
  readonly criado_price: boolean;
}

export interface ResultadoDoProvisionamento {
  readonly os: string;
  readonly origem: "owner" | "placeholder";
  readonly produtos: ReadonlyArray<ProdutoProvisionado>;
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

/**
 * Os planos a provisionar a partir das linhas de `plans`: os três códigos dos
 * placeholders têm de existir, ativos, com `source='owner'` e preço > 0 —
 * então o Product leva o nome real e o Price o `price_cents` do banco. Falta
 * um → a lista INTEIRA é placeholder (nunca mistura: um catálogo meio decidido
 * cobraria R$ 10 num plano e R$ 597 no outro).
 */
export function planosAProvisionar(linhas: readonly LinhaDePlano[]): { origem: "owner" | "placeholder"; planos: readonly PlanoAProvisionar[] } {
  const doDono: PlanoAProvisionar[] = [];
  for (const placeholder of PLANOS_PLACEHOLDER) {
    const linha = linhas.find((l) => l.code === placeholder.plan_code) ?? null;
    if (linha === null || linha.source !== "owner" || !linha.active || !(linha.price_cents > 0)) {
      return { origem: "placeholder", planos: PLANOS_PLACEHOLDER }; // MUTANT: planos-do-dono
    }
    doDono.push({ plan_code: linha.code, nome: linha.name, unit_amount: linha.price_cents, currency: linha.currency.toLowerCase(), interval: "month" });
  }
  return { origem: "owner", planos: doDono };
}

/** `STRIPE_PRICE_IDS`: os vigentes primeiro (um por plano), depois os antigos — `precoDoPlano` pega o primeiro. */
export function montarListaDePrecos(produtos: ReadonlyArray<Pick<ProdutoProvisionado, "plan_code" | "price" | "precos_legado">>): string {
  const vigentes = produtos.map((p) => `${p.price}:${p.plan_code}`);
  const legado = produtos.flatMap((p) => p.precos_legado.map((l) => `${l}:${p.plan_code}`));
  return [...vigentes, ...legado].join(",");
}

export async function provisionar(
  cfg: ConfigDoCliente,
  entrada: { os: string; headline: string; planos: readonly PlanoAProvisionar[]; origem?: "owner" | "placeholder"; portal_configuration?: string | null },
): Promise<ResultadoDoProvisionamento> {
  const origem = entrada.origem ?? "placeholder";
  const existentes = await buscarProdutosDoOs(cfg, entrada.os);
  const produtos: ProdutoProvisionado[] = [];
  let criados = 0;
  let reaproveitados = 0;
  for (const plano of entrada.planos) {
    let product = existentes.find((p) => p.metadata.plan_code === plano.plan_code) ?? null;
    let criadoProduct = false;
    if (product === null) {
      product = await criarProduto(cfg, {
        name: plano.nome,
        os: entrada.os,
        plan_code: plano.plan_code,
        description: origem === "owner" ? `Plano ${plano.nome} do ${entrada.os}` : `Plano ${plano.plan_code} do ${entrada.os} — placeholder até D14`,
      });
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
    // Preços antigos do mesmo Product, ativos e na mesma moeda: continuam aceitos pelo webhook.
    const vigente = price;
    const legado = precos.filter((p) => p.id !== vigente.id && p.active && p.currency.toLowerCase() === plano.currency.toLowerCase()).map((p) => p.id);
    produtos.push({ plan_code: plano.plan_code, product: product.id, price: price.id, precos_legado: legado, criado_product: criadoProduct, criado_price: criadoPrice });
  }
  let portal = entrada.portal_configuration ?? null;
  if (portal === null || portal.length === 0) {
    portal = (await criarConfiguracaoDoPortal(cfg, { headline: entrada.headline, produtos: produtos.map((p) => ({ product: p.product, prices: [p.price] })) })).id;
    criados++;
  } else reaproveitados++;
  return {
    os: entrada.os,
    origem,
    produtos,
    portal_configuration: portal,
    env: {
      STRIPE_PRICE_IDS: montarListaDePrecos(produtos),
      STRIPE_PORTAL_CONFIGURATION_ID: portal,
    },
    criados,
    reaproveitados,
  };
}
