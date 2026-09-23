/**
 * scripts/prod/stripe-live.ts (F19-T06, ADR-044 §4; D58) — o Stripe LIVE na
 * produção, em dois modos, sempre chamado por `scripts/prod/stripe-live.sh`
 * (que lê `/srv/secrets/crm-prod.env` e grava o que este script devolve):
 *
 *   ligar   registra o endpoint de webhook LIVE pela API (idempotente por URL;
 *           o `whsec_` só sai na criação), provisiona Products/Prices/Portal
 *           com os planos do DONO (9034, `source='owner'`) e escreve as
 *           variáveis num arquivo temporário (`--out`) — NUNCA em stdout.
 *   provar  a linha `stripe_live:` FORA do bloco: tudo leitura ou catálogo,
 *           nenhum Checkout, nenhuma cobrança (`checkout_paid=0/0` declarado).
 *
 * Só imprime NOME e TAMANHO de segredo, nunca o valor. Recusa chave que não
 * seja `rk_live_`/`sk_live_` (a produção live não roda com chave de teste) e
 * planos que não sejam do dono (não cobra placeholder em live).
 */
import { writeFileSync } from "node:fs";

import pg from "pg";

import {
  buscarConfiguracaoDoPortal,
  buscarProdutosDoOs,
  lerListaDePrecos,
  listarEndpointsDeWebhook,
  listarPrecosDoProduto,
  registrarEndpointDeWebhook,
  StripeIndisponivel,
  TIPOS_TRATADOS,
} from "@/src/billing/gateway/stripe";
import { type LinhaDePlano, planosAProvisionar, provisionar } from "@/src/billing/provisionar";

const OS = process.env.STRIPE_OS ?? "crm-os";
const CHAVE = process.env.STRIPE_SECRET_KEY ?? "";
const BASE = process.env.STRIPE_API_BASE ?? "https://api.stripe.com";
const DB_URL = process.env.SUPABASE_DB_URL ?? "";
const APP_URL = (process.env.APP_URL ?? "").replace(/\/$/, "");
const WEBHOOK_URL = `${APP_URL}/api/v1/webhooks/stripe`;

function argumento(nome: string): string | null {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : null;
}
function falhar(msg: string): never {
  console.error(`stripe-live: ${msg}`);
  process.exit(2);
}

async function lerPlanos(): Promise<readonly LinhaDePlano[]> {
  const pool = new pg.Pool({ connectionString: DB_URL, max: 1 });
  try {
    const r = await pool.query<{ code: string; name: string; price_cents: string | number; currency: string; source: "placeholder" | "owner"; active: boolean }>(
      `select code, name, price_cents, currency, source, active from public.plans where code in ('PLAN_A','PLAN_B','PLAN_C') order by code`,
    );
    return r.rows.map((l) => ({ ...l, price_cents: Number(l.price_cents) }));
  } finally {
    await pool.end();
  }
}

function conferirEntrada(): void {
  if (CHAVE.length === 0) falhar("STRIPE_SECRET_KEY vazia (lib/env.ts:283)");
  if (!/^(rk|sk)_live_/.test(CHAVE)) falhar(`a chave não é live (prefixo ${CHAVE.slice(0, 8)}…) — a produção live não roda com chave de teste`);
  if (APP_URL.length === 0 || !APP_URL.startsWith("https://")) falhar(`APP_URL tem de ser https (NEXT_PUBLIC_APP_URL): "${APP_URL}"`);
  if (DB_URL.length === 0) falhar("SUPABASE_DB_URL vazia");
  console.info(`stripe-live: os=${OS} chave=STRIPE_SECRET_KEY(${CHAVE.length} chars, ${CHAVE.slice(0, 8)}…) webhook=${WEBHOOK_URL}`);
}

async function ligar(): Promise<void> {
  conferirEntrada();
  const out = argumento("out") ?? falhar("--out <arquivo> obrigatório (o .sh grava no env)");
  const cfg = { base: BASE, chave: CHAVE };
  const linhas: string[] = [];

  /**
   * 1 · Os planos do DONO vêm ANTES de qualquer chamada ao Stripe.
   *
   * Aprendido em 23/09/2026, na primeira execução real: o script registrava o
   * endpoint de webhook primeiro e só depois lia o banco. Com a 9034 ainda não
   * aplicada na produção (ela entra pelo `up.sh`, junto do baseline), a
   * conferência dos planos abortou DEPOIS de o endpoint já existir no Stripe —
   * e o `whsec_` só sai na criação, então o segredo se perdeu e foi preciso
   * apagar o endpoint no provedor para poder repetir. Ordem correta: o que é
   * local e reversível primeiro; efeito externo por último.
   */
  const { origem, planos } = planosAProvisionar(await lerPlanos());
  if (origem !== "owner") {
    falhar(
      "os planos do banco não são do dono (9034 aplicada?) — não provisiono placeholder em live. " +
        "Na produção a 9034 entra pelo baseline pelo `bash scripts/prod/up.sh`; rode-o antes deste script.",
    );
  }

  // 2 · Products/Prices/Portal com os planos do dono
  const r = await provisionar(cfg, { os: OS, headline: "CRM OS — assinatura", planos, origem, portal_configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID_EXISTENTE || null });
  for (const p of r.produtos) {
    console.info(`  ${p.plan_code}: product=${p.product}${p.criado_product ? " (criado)" : " (reaproveitado)"} price=${p.price}${p.criado_price ? " (criado)" : " (reaproveitado)"} legado=${p.precos_legado.length}`);
  }
  console.info(`  portal_configuration=${r.portal_configuration} criados=${r.criados} reaproveitados=${r.reaproveitados}`);

  // 3 · endpoint de webhook LIVE — por último: é o único passo cujo segredo não
  //     se recupera (o `whsec_` só sai na criação).
  let registro: Awaited<ReturnType<typeof registrarEndpointDeWebhook>>;
  try {
    registro = await registrarEndpointDeWebhook(cfg, { url: WEBHOOK_URL, eventos: TIPOS_TRATADOS, descricao: `${OS} — produção` });
  } catch (erro) {
    if (erro instanceof StripeIndisponivel && (erro.status === 401 || erro.status === 403)) {
      falhar(`a chave não pode registrar endpoints (Stripe ${erro.status}) — registre no Dashboard e grave STRIPE_WEBHOOK_SECRET com \`segredo crm-prod.env STRIPE_WEBHOOK_SECRET\` (docs/ops/prod.md)`);
    }
    throw erro;
  }
  const secretExistente = process.env.STRIPE_WEBHOOK_SECRET_EXISTENTE ?? "";
  if (registro.criado) {
    if (registro.endpoint.secret === null) falhar("o Stripe criou o endpoint sem devolver o segredo");
    linhas.push(`STRIPE_WEBHOOK_SECRET=${registro.endpoint.secret}`);
    console.info(`  webhook_endpoint: ${registro.endpoint.id} (criado, livemode=${registro.endpoint.livemode}, eventos=${registro.endpoint.enabled_events.length}/${TIPOS_TRATADOS.length}) STRIPE_WEBHOOK_SECRET(${registro.endpoint.secret.length} chars) → env`);
  } else if (secretExistente.length > 0) {
    console.info(`  webhook_endpoint: ${registro.endpoint.id} (já existia; STRIPE_WEBHOOK_SECRET do env mantida, ${secretExistente.length} chars)`);
  } else {
    falhar(`o endpoint ${registro.endpoint.id} já existe em ${WEBHOOK_URL} e o env não tem STRIPE_WEBHOOK_SECRET — o segredo só sai na criação: apague-o no Dashboard e rode de novo, ou grave o segredo dele com \`segredo\``);
  }

  linhas.push(`STRIPE_PRICE_IDS=${r.env.STRIPE_PRICE_IDS}`, `STRIPE_PORTAL_CONFIGURATION_ID=${r.env.STRIPE_PORTAL_CONFIGURATION_ID}`, "STRIPE_MODE=live", "BILLING_GATEWAY=stripe");
  writeFileSync(out, `${linhas.join("\n")}\n`, { mode: 0o600 });
  console.info(`stripe-live: ${linhas.length} variáveis escritas em ${out} (${linhas.map((l) => l.split("=")[0]).join(", ")})`);
}

async function provar(): Promise<void> {
  conferirEntrada();
  const cfg = { base: BASE, chave: CHAVE };
  const token = process.env.ADMIN_SUMMARY_TOKEN ?? "";
  const listaBruta = process.env.STRIPE_PRICE_IDS ?? "";
  const portalId = process.env.STRIPE_PORTAL_CONFIGURATION_ID ?? "";
  const m: Record<string, string> = {};
  const marca = (nome: string, ok: boolean, den = 1) => {
    m[nome] = `${ok ? den : 0}/${den}`;
    console.info(`  ${ok ? "✓" : "✗"} ${nome}`);
  };

  // 1 · a chave responde e os 3 Products do OS existem, ativos
  let produtos: Awaited<ReturnType<typeof buscarProdutosDoOs>> = [];
  try {
    produtos = await buscarProdutosDoOs(cfg, OS);
    m.key_ok = "1/1";
  } catch (erro) {
    m.key_ok = "0/1";
    console.error(`  ✗ key_ok: ${erro instanceof Error ? erro.message : String(erro)}`);
  }
  const codigos = ["PLAN_A", "PLAN_B", "PLAN_C"];
  const porPlano = codigos.filter((c) => produtos.some((p) => p.metadata.plan_code === c));
  m.products = `${porPlano.length}/3`;

  // 2 · cada plano tem o Price vigente da lista do env, ativo, com o preço do banco
  const lista = lerListaDePrecos(listaBruta);
  const planos = await lerPlanos();
  let precosOk = 0;
  for (const c of codigos) {
    const produto = produtos.find((p) => p.metadata.plan_code === c);
    const precoVigente = [...lista].find(([, plano]) => plano === c)?.[0] ?? null;
    const linha = planos.find((l) => l.code === c) ?? null;
    if (!produto || !precoVigente || !linha) continue;
    const precos = await listarPrecosDoProduto(cfg, produto.id);
    const p = precos.find((x) => x.id === precoVigente) ?? null;
    if (p && p.active && p.unit_amount === linha.price_cents && p.currency.toLowerCase() === linha.currency.toLowerCase()) precosOk++;
    else console.error(`  ✗ price de ${c}: ${precoVigente} ${p ? `unit_amount=${p.unit_amount} (banco ${linha.price_cents})` : "não existe/inativo"}`);
  }
  m.prices = `${precosOk}/3`;

  // 3 · Portal
  const portal = portalId.length > 0 ? await buscarConfiguracaoDoPortal(cfg, portalId) : null;
  marca("portal", portal !== null && portal.active);

  // 4 · endpoint LIVE habilitado nesta URL com os 7 tipos
  const endpoints = await listarEndpointsDeWebhook(cfg);
  const ep = endpoints.find((e) => e.url === WEBHOOK_URL && e.status === "enabled") ?? null;
  const cobre = ep !== null && TIPOS_TRATADOS.every((t) => ep.enabled_events.includes(t) || ep.enabled_events.includes("*"));
  marca("webhook_endpoint", ep !== null && ep.livemode && cobre);

  // 5 · o domínio recusa webhook sem assinatura (401 com gateway stripe)
  const semAssinatura = await fetch(WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  marca("unsigned_rejected", semAssinatura.status === 401);
  console.info(`    status=${semAssinatura.status}`);

  // 6 · cockpit: gateway stripe/live com ok=true
  let summaryOk = false;
  if (token.length > 0) {
    const r = await fetch(`${APP_URL}/api/admin/summary`, { headers: { authorization: `Bearer ${token}` } });
    if (r.status === 200) {
      const corpo = (await r.json()) as { data?: { items?: Array<{ nome: string; ok: boolean; valor: unknown }> } };
      const gateway = corpo.data?.items?.find((i) => i.nome === "gateway") ?? null;
      summaryOk = gateway !== null && gateway.ok === true && gateway.valor === "stripe/live";
      console.info(`    gateway=${gateway ? `${String(gateway.valor)} ok=${gateway.ok}` : "ausente"}`);
    } else console.error(`    summary status=${r.status}`);
  }
  marca("summary_ok", summaryOk);

  const linha = `stripe_live: key_ok=${m.key_ok} products=${m.products} prices=${m.prices} portal=${m.portal} webhook_endpoint=${m.webhook_endpoint} unsigned_rejected=${m.unsigned_rejected} summary_ok=${m.summary_ok} checkout_paid=0/0 mode=live cost_cents=0 at=${new Date().toISOString()}`;
  console.info(linha);
  const falhou = Object.values(m).some((v) => v.startsWith("0/") && !v.startsWith("0/0"));
  if (falhou) process.exit(1);
}

const modo = process.argv[2];
(modo === "ligar" ? ligar() : modo === "provar" ? provar() : Promise.reject(new Error("uso: stripe-live.ts ligar --out <arquivo> | provar"))).catch((erro: unknown) => {
  console.error("stripe-live falhou:", erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro));
  process.exit(1);
});
