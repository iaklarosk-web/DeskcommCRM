#!/usr/bin/env bash
# F04-T08, G-38: `chamarModelo` devolve `{ result }` ao `withEntitlement` e NUNCA
# `usage` — quem grava o consumo é `runModelCall`, na mesma transação do
# `llm_calls` (ADR-021 decisão 3). Devolver o usage aqui é a coisa mais natural
# do mundo: o campo existe na assinatura, o código compila, o agente responde
# igual, nenhuma tela muda. A única consequência é a organização aparecer
# consumindo o DOBRO do que consumiu — e aparecer isso na fatura, não no teste.
#
# Este mutante existe para que essa dobra fique VERMELHA. O fonte muda só em
# memória (mecânica de 33-f03-adapter-allowlist.sh).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const file = "src/ai/chamada.ts";
const from = "return { result: saida };";
const to =
  "return { result: saida, usage: { model: saida.model, operation: 'chat', " +
  "prompt_tokens: saida.usage.inputTokens, completion_tokens: saida.usage.outputTokens } };";
const title = "a chamada grava llm_calls e ai_usage_events no MESMO statement";
const scratch = mkdtempSync(path.join(os.tmpdir(), "f04-consumo-em-dobro-mutant-"));

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
       name:"f04-consumo-em-dobro-mutant",enforce:"pre",
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
      "tests/unit/f04-t08-um-registro-de-consumo.test.ts",
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
  const alvo = report.testResults
    .flatMap((entry) => entry.assertionResults)
    .find((test) => test.title === title);
  assert.equal(alvo?.status, "failed", "a prova não detectou a dupla contagem");
  assert.match(
    alvo.failureMessages.join("\n"),
    /o consumo da chamada foi gravado mais de uma vez \(dupla contagem\)/,
    "a falha não foi a dobra do registro de consumo",
  );
  process.stdout.write("mutants_killed=1/1 (f04-consumo-em-dobro; asserção observada)\n");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
NODE
