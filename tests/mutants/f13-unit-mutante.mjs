#!/usr/bin/env node
/**
 * F13 (ADR-035 §4) — mutante de UNIDADE por transformação em memória.
 *
 * Irmão de `f04-turno-mutante.mjs` (que serve à suíte de integração, com o
 * Postgres descartável): aqui a suíte é `tests/unit`, a config base é
 * `vitest.config.ts`, e a sabotagem entra por um plugin de `transform` que
 * troca UM trecho de UM arquivo de src — nenhum arquivo do repositório é
 * tocado. O veredito é o mesmo: o caso alvo tem de rodar, ficar vermelho e a
 * falha tem de mencionar o invariante sabotado.
 *
 *   node tests/mutants/f13-unit-mutante.mjs --arquivo <src/...> --de <trecho> \
 *     --para <trecho sabotado> --suite <tests/unit/...test.ts> --titulo <caso> \
 *     --espera <trecho da mensagem de falha> --nome <rotulo>
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
function argumento(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  if (i === -1 || i + 1 >= process.argv.length) throw new Error(`falta --${nome}`);
  return process.argv[i + 1];
}
const arquivo = argumento("arquivo");
const de = argumento("de");
const para = argumento("para");
const suite = argumento("suite");
const titulo = argumento("titulo");
const espera = argumento("espera");
const nome = argumento("nome");

const fonte = readFileSync(path.join(raiz, arquivo), "utf8");
if (fonte.split(de).length - 1 !== 1) {
  throw new Error(`alvo do mutante mudou: o trecho aparece ${fonte.split(de).length - 1} vezes em ${arquivo}`);
}

const scratch = mkdtempSync(path.join(os.tmpdir(), `${nome}-`));
try {
  const config = path.join(scratch, "vitest.mutant.config.mjs");
  const saida = path.join(scratch, "result.json");
  writeFileSync(
    config,
    `import base from ${JSON.stringify(path.join(raiz, "vitest.config.ts"))};
     import path from "node:path";
     const target=${JSON.stringify(path.join(raiz, arquivo))};
     const from=${JSON.stringify(de)};
     const to=${JSON.stringify(para)};
     export default {...base,plugins:[...(base.plugins??[]),{
       name:${JSON.stringify(`${nome}-mutant`)},enforce:"pre",
       transform(code,id){
         if(path.resolve(id.split("?")[0])!==path.resolve(target)) return;
         const hits=code.split(from).length-1;
         if(hits!==1) throw new Error("alvo da mutação apareceu " + hits + " vezes");
         return {code:code.replace(from,to),map:null};
       }
     }]};`,
  );
  const corrida = spawnSync(
    "node",
    [path.join(raiz, "node_modules/vitest/vitest.mjs"), "run", suite, "-t", titulo, "--config", config,
      "--maxWorkers=1", "--allowOnly=false", "--reporter=json", "--outputFile", saida],
    { cwd: raiz, encoding: "utf8", timeout: 600_000, env: { ...process.env, CI: "1" } },
  );
  if (corrida.status !== 1) {
    process.stderr.write(`${corrida.stdout ?? ""}\n${corrida.stderr ?? ""}\n`);
    throw new Error(`MUTANTE SEM VEREDITO: esperava exit 1, veio ${corrida.status}`);
  }
  const relatorio = JSON.parse(readFileSync(saida, "utf8"));
  const casos = relatorio.testResults.flatMap((t) => t.assertionResults).filter((c) => c.title === titulo);
  assert.equal(casos.length, 1, `o caso alvo não rodou (${casos.length} encontrados)`);
  assert.equal(casos[0].status, "failed", "a prova não ficou vermelha com a sabotagem");
  // O relatório JSON traz a mensagem com cores ANSI; a comparação é sem elas.
  const mensagem = casos[0].failureMessages.join("\n").replace(/\u001b\[[0-9;]*m/g, "");
  assert.ok(mensagem.includes(espera), `a falha não observou o invariante sabotado (esperava conter: ${espera}); veio: ${mensagem.slice(0, 400)}`);
  process.stdout.write(`mutants_killed=1/1 (${nome}; asserção observada)\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
