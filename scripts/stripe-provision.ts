/**
 * `pnpm stripe:provision` (F19-T04, ADR-042 §5; DF-33) — cria no Stripe um
 * Product por plano com um Price mensal cada, e a configuração do Customer
 * Portal; imprime as duas linhas de env que a instalação precisa. Idempotente:
 * rodar de novo reaproveita o que existe (metadata `os` + `plan_code`).
 *
 * De onde vêm nome e preço (F19-T06, ADR-044 §3): de `public.plans` quando o
 * dono decidiu (9034: `source='owner'`, lidos por `SUPABASE_DB_URL`); sem
 * banco no ambiente, ou com algum plano ainda placeholder, valem os
 * placeholders de D57 d (R$ 10/20/30, "(placeholder)" no nome). O script
 * imprime a ORIGEM que usou. Preços antigos do mesmo Product entram em
 * `STRIPE_PRICE_IDS` depois do vigente (objeção 2).
 *
 *   SUPABASE_DB_URL=postgresql://… STRIPE_SECRET_KEY=rk_… STRIPE_MODE=test|live tsx scripts/stripe-provision.ts [--os crm-os] [--live]
 *
 * Só imprime o NOME e o TAMANHO da chave, nunca o valor. Recusa `live` sem
 * `--live` explícito: provisionar em produção é ação do proprietário (D58).
 */
import pg from "pg";

import { type LinhaDePlano, planosAProvisionar, provisionar } from "@/src/billing/provisionar";

/** As linhas de `plans` pelo pool de serviço (a tabela é service_only, D35). */
async function lerPlanosDoBanco(url: string): Promise<readonly LinhaDePlano[]> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const r = await pool.query<{ code: string; name: string; price_cents: string | number; currency: string; source: "placeholder" | "owner"; active: boolean }>(
      `select code, name, price_cents, currency, source, active from public.plans where code in ('PLAN_A','PLAN_B','PLAN_C') order by code`,
    );
    return r.rows.map((l) => ({ code: l.code, name: l.name, price_cents: Number(l.price_cents), currency: l.currency, source: l.source, active: l.active }));
  } finally {
    await pool.end();
  }
}

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
  const dbUrl = process.env.SUPABASE_DB_URL ?? "";
  const linhas = dbUrl.length > 0 ? await lerPlanosDoBanco(dbUrl) : [];
  const { origem, planos } = planosAProvisionar(linhas);
  if (modo === "live" && origem !== "owner") {
    console.error(`stripe-provision: modo live exige os planos do DONO no banco (9034, source=owner) — achou origem=${origem} (linhas lidas=${linhas.length}/3${dbUrl.length === 0 ? ", SUPABASE_DB_URL vazia" : ""}). Nada feito.`);
    process.exit(2);
  }
  console.info(`stripe-provision: origem=${origem} planos=${planos.map((p) => `${p.plan_code}=${p.nome}@${p.unit_amount}${p.currency}`).join(" ")}`);
  const r = await provisionar({ base, chave }, { os, headline, planos, origem, portal_configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID ?? null });
  for (const p of r.produtos) {
    console.info(`  ${p.plan_code}: product=${p.product}${p.criado_product ? " (criado)" : " (reaproveitado)"} price=${p.price}${p.criado_price ? " (criado)" : " (reaproveitado)"} legado=${p.precos_legado.length}`);
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
