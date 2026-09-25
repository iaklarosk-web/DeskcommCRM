#!/usr/bin/env node
/**
 * RÉGUA — staging e produção não podem discordar em silêncio.
 *
 * Em 23/09/2026 um convidado real não conseguiu criar a conta: a produção
 * respondeu 422 `signup_disabled` porque `GOTRUE_DISABLE_SIGNUP=true` lá e
 * `false` no staging. O gate inteiro é verde no staging, então o caminho que
 * a produção realmente percorre nunca foi exercitado (ADR-047).
 *
 * Esta régua NÃO exige que os ambientes sejam iguais — exige que a diferença
 * seja DECLARADA com o fluxo que ela muda e com o teste que cobre o valor de
 * produção. Ela mede; quem conserta é outro arquivo (G-45).
 */
import { readFileSync, existsSync } from "node:fs";

const STAGING = "compose.staging.yml";
const PROD = "compose.prod.yml";
const DECLARACAO = "docs/ops/divergencias-de-ambiente.json";

/** Flags do GoTrue que porteiam um fluxo que uma PESSOA percorre. */
const FLAGS_QUE_PORTEIAM_FLUXO = [
  "GOTRUE_DISABLE_SIGNUP",
  "GOTRUE_MAILER_AUTOCONFIRM",
  "GOTRUE_EXTERNAL_EMAIL_ENABLED",
  "GOTRUE_DISABLE_SIGNUP_EMAIL",
];

function lerFlags(arquivo) {
  const texto = readFileSync(arquivo, "utf8");
  const achados = {};
  for (const flag of FLAGS_QUE_PORTEIAM_FLUXO) {
    const m = new RegExp(`^\\s*${flag}:\\s*"?([^"\\n]*)"?\\s*$`, "m").exec(texto);
    if (m) achados[flag] = m[1].trim();
  }
  return achados;
}

const problemas = [];

const staging = lerFlags(STAGING);
const prod = lerFlags(PROD);

const declaradas = existsSync(DECLARACAO)
  ? JSON.parse(readFileSync(DECLARACAO, "utf8")).divergencias ?? []
  : [];
const porFlag = new Map(declaradas.map((d) => [d.flag, d]));

for (const flag of FLAGS_QUE_PORTEIAM_FLUXO) {
  const a = staging[flag];
  const b = prod[flag];
  if (a === undefined && b === undefined) continue;
  if (a === b) {
    if (porFlag.has(flag)) problemas.push(`${flag}: declarada como divergente, mas os dois valem "${a}" — declaração morta engana quem lê`);
    continue;
  }

  const d = porFlag.get(flag);
  if (!d) {
    problemas.push(`${flag}: staging="${a}" produção="${b}" — divergência NÃO declarada em ${DECLARACAO}`);
    continue;
  }
  if (d.staging !== a || d.producao !== b) {
    problemas.push(`${flag}: declaração desatualizada (diz staging="${d.staging}" produção="${d.producao}"; o compose diz "${a}" e "${b}")`);
    continue;
  }
  const teste = d.teste_do_valor_de_producao;
  if (!teste || !existsSync(teste)) {
    problemas.push(`${flag}: declarada, mas o teste do valor de PRODUÇÃO não existe (${teste ?? "campo ausente"}) — é assim que o defeito de 23/09 passou`);
  }
  if (!d.fluxo_afetado || !d.porque) {
    problemas.push(`${flag}: declaração sem "fluxo_afetado" ou "porque" — não diz o que quebra`);
  }
}

const resultado = {
  ok: problemas.length === 0,
  flags_conferidas: FLAGS_QUE_PORTEIAM_FLUXO.length,
  divergencias_declaradas: declaradas.length,
  problemas,
};
console.info(JSON.stringify(resultado, null, 2));
if (problemas.length > 0) {
  for (const p of problemas) console.error(`[verify] divergência de ambiente: ${p}`);
  process.exit(1);
}
