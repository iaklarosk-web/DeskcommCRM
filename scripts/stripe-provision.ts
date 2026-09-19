/**
 * `pnpm stripe:provision` (F19-T04, ADR-042 §5; DF-33) — cria no Stripe, em
 * modo TEST, um Product por plano (PLAN_A/B/C placeholder, R$ 10/20/30 — D57 d)
 * com um Price mensal cada, e a configuração do Customer Portal; imprime as
 * duas linhas de env que a instalação precisa. Idempotente: rodar de novo
 * reaproveita o que existe (metadata `os` + `plan_code`).
 *
 * Nunca decide preço ou nome REAL (D14): os placeholders estão em
 * `src/billing/provisionar.ts` e o nome do Product leva "(placeholder)".
 *
 *   STRIPE_SECRET_KEY=rk_test_… STRIPE_MODE=test tsx scripts/stripe-provision.ts [--os crm-os]
 *
 * Só imprime o NOME e o TAMANHO da chave, nunca o valor. Recusa `live` sem
 * `--live` explícito: provisionar em produção é ação do proprietário.
 */
import { PLANOS_PLACEHOLDER, provisionar } from "@/src/billing/provisionar";

function argumento(nome: string, padrao: string): string {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : padrao;
}

async function main(): Promise<void> {
  const chave = process.env.STRIPE_SECRET_KEY ?? "";
  const modo = process.env.STRIPE_MODE ?? "test";
  const base = process.env.STRIPE_API_BASE ?? "https://api.stripe.com";
  const os = argumento("os", "crm-os");
  const headline = argumento("headline", "CRM OS — assinatura");
  if (chave.length === 0) {
    console.error("STRIPE_SECRET_KEY vazia (lib/env.ts:283). Nada feito.");
    process.exit(2);
  }
  if (modo === "live" && !process.argv.includes("--live")) {
    console.error("STRIPE_MODE=live exige --live explícito (provisionar em produção é do proprietário). Nada feito.");
    process.exit(2);
  }
  console.info(`stripe-provision: os=${os} modo=${modo} base=${base} chave=STRIPE_SECRET_KEY(${chave.length} chars, prefixo ${chave.slice(0, 8)}…)`);
  const r = await provisionar({ base, chave }, { os, headline, planos: PLANOS_PLACEHOLDER, portal_configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID ?? null });
  for (const p of r.produtos) {
    console.info(`  ${p.plan_code}: product=${p.product}${p.criado_product ? " (criado)" : " (reaproveitado)"} price=${p.price}${p.criado_price ? " (criado)" : " (reaproveitado)"}`);
  }
  console.info(`  portal_configuration=${r.portal_configuration}`);
  console.info(`stripe-provision: criados=${r.criados} reaproveitados=${r.reaproveitados}`);
  console.info("");
  console.info("# grave com `segredo <env> <NOME>` (nomes de lib/env.ts:285-286):");
  console.info(`STRIPE_PRICE_IDS=${r.env.STRIPE_PRICE_IDS}`);
  console.info(`STRIPE_PORTAL_CONFIGURATION_ID=${r.env.STRIPE_PORTAL_CONFIGURATION_ID}`);
}

main().catch((erro: unknown) => {
  console.error("stripe-provision falhou:", erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro));
  process.exit(1);
});
