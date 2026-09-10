#!/usr/bin/env bash
# F03-T01, G-38: a guarda `ai_available` de §5.6 tem DUAS metades
# (`ai.enabled` e `entitlement(ai.reply).allowed`). Na Fase 1 o entitlement
# libera tudo, então a metade do entitlement é invisível no valor observado —
# apagá-la não muda nenhum resultado de produção. Este mutante existe para que
# apagá-la fique VERMELHO mesmo assim. O fonte muda só em memória.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const file = "src/conversation/guards.ts";
const from = 'return (deps.entitlementResolver ?? entitlement)(ctx, "ai.reply").allowed;';
const title = "com o dublê negando ai.reply, só a guarda de entrada vira falsa";
const scratch = mkdtempSync(path.join(os.tmpdir(), "f03-guarda-entitlement-mutant-"));

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
     export default {...base,plugins:[...(base.plugins??[]),{
       name:"f03-guarda-entitlement-mutant",enforce:"pre",
       transform(code,id){
         if(path.resolve(id.split("?")[0])!==path.resolve(target)) return;
         const hits=code.split(from).length-1;
         if(hits!==1) throw new Error("alvo da mutação apareceu " + hits + " vezes");
         return {code:code.replace(from,"return true; /* MUTANTE: entitlement não é consultado */"),map:null};
       }
     }]};`,
  );

  const run = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules/vitest/vitest.mjs"),
      "run",
      "tests/unit/f03-t01-guardas-ia.test.ts",
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
    { cwd: root, encoding: "utf8", timeout: 60_000 },
  );

  assert.equal(run.status, 1, "mutante não foi reprovado");
  const report = JSON.parse(readFileSync(output, "utf8"));
  const alvo = report.testResults
    .flatMap((entry) => entry.assertionResults)
    .find((test) => test.title === title);
  assert.equal(alvo?.status, "failed", "a prova não detectou a perda da consulta ao entitlement");
  assert.match(
    alvo.failureMessages.join("\n"),
    /ai_available ignorou entitlement\(ai\.reply\)/,
    "a falha não foi a metade ausente da guarda",
  );
  process.stdout.write("mutants_killed=1/1 (f03-guarda-entitlement; asserção observada)\n");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
NODE
