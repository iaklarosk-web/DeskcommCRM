#!/usr/bin/env bash
# F03-T02, G-38/G-42: o parser de entrada grava SÓ a allowlist do `InboundEvent`.
# Copiar o payload inteiro não quebra nada visível — o evento continua tendo os
# dez campos certos, com os valores certos — e mesmo assim é o defeito: todo
# consumidor (fila, log, prompt de IA) passaria a herdar dado de cliente que
# ninguém pediu. Este mutante existe para que essa cópia fique VERMELHA.
# O fonte muda só em memória.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const file = "src/channels/inbound-parse.ts";
const from = "const evento_de_entrada: InboundEvent = {";
const to = "const evento_de_entrada: InboundEvent = { ...(p as unknown as Record<string, unknown>),";
const title = "parseInbound grava só a allowlist e conta o campo desconhecido";
const scratch = mkdtempSync(path.join(os.tmpdir(), "f03-adapter-allowlist-mutant-"));

try {
  const source = readFileSync(path.join(root, file), "utf8");
  assert.equal(source.split(from).length - 1, 1, "alvo do mutante mudou");

  const config = path.join(scratch, "vite-mutant.config.mjs");
  const output = path.join(scratch, "result.json");
  writeFileSync(
    config,
    `import base from ${JSON.stringify(path.join(root, "vitest.config.ts"))};
     import path from "node:path";
     const target=${JSON.stringify(path.join(root, file))};
     const from=${JSON.stringify(from)};
     const to=${JSON.stringify(to)};
     export default {...base,plugins:[...(base.plugins??[]),{
       name:"f03-adapter-allowlist-mutant",enforce:"pre",
       transform(code,id){
         if(path.resolve(id.split("?")[0])!==path.resolve(target)) return;
         const hits=code.split(from).length-1;
         if(hits!==1) throw new Error("alvo da mutação apareceu " + hits + " vezes");
         return {code:code.replace(from,to),map:null};
       }
     }]};`,
  );

  const run = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules/vitest/vitest.mjs"),
      "run",
      "tests/unit/f03-t02-channel-adapter-contract.test.ts",
      "-t",
      title,
      "--config",
      config,
      "--maxWorkers=1",
      "--allowOnly=false",
      "--reporter=json",
      "--outputFile",
      output,
    ],
    { cwd: root, encoding: "utf8", timeout: 120_000 },
  );

  assert.equal(run.status, 1, "mutante não foi reprovado");
  const report = JSON.parse(readFileSync(output, "utf8"));
  const alvos = report.testResults
    .flatMap((entry) => entry.assertionResults)
    .filter((test) => test.title === title);
  // O caso roda nos DOIS adapters (eles compartilham este parser), então a
  // sabotagem tem de derrubar os dois. Um só vermelho significaria que um dos
  // adapters não passa por aqui — e aí a prova de paridade era ilusão.
  assert.equal(alvos.length, 2, "o caso 5 não rodou nos dois adapters");
  for (const alvo of alvos) {
    assert.equal(alvo.status, "failed", "a prova não detectou a cópia do payload inteiro");
    assert.match(
      alvo.failureMessages.join("\n"),
      /parseInbound copiou campo fora da allowlist do InboundEvent/,
      "a falha não foi a allowlist rompida",
    );
  }
  process.stdout.write("mutants_killed=1/1 (f03-adapter-allowlist; asserção observada nos 2 adapters)\n");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
NODE
