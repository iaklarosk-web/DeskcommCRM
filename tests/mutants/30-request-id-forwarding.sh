#!/usr/bin/env bash
# F02-T04, G-38: remover o encaminhamento do request id precisa quebrar a
# correlação nominal entre resposta, rota e auditoria. O fonte muda só em memória.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const file = "proxy.ts";
const from = 'requestHeaders.set("x-request-id", requestId);';
const title = "encaminha o mesmo UUID para resposta e rota sem expor cookies";
const scratch = mkdtempSync(path.join(os.tmpdir(), "request-id-forwarding-mutant-"));

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
       name:"request-id-forwarding-mutant",enforce:"pre",
       transform(code,id){
         if(path.resolve(id.split("?")[0])!==path.resolve(target)) return;
         const hits=code.split(from).length-1;
         if(hits!==1) throw new Error("alvo da mutação apareceu " + hits + " vezes");
         return {code:code.replace(from,"/* MUTANTE: request id não chega à rota */"),map:null};
       }
     }]};`,
  );

  const run = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules/vitest/vitest.mjs"),
      "run",
      "tests/unit/request-id-correlation.test.ts",
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
    { cwd: root, encoding: "utf8", timeout: 45_000 },
  );

  assert.equal(run.status, 1, "mutante não foi reprovado");
  const report = JSON.parse(readFileSync(output, "utf8"));
  const target = report.testResults
    .flatMap((entry) => entry.assertionResults)
    .find((test) => test.title === title);
  assert.equal(target?.status, "failed", "a prova não detectou a perda de correlação");
  assert.match(
    target.failureMessages.join("\n"),
    /proxy não encaminhou x-request-id à rota/,
    "a falha não foi a ausência nominal do header encaminhado",
  );
  process.stdout.write("mutants_killed=1/1 (request-id-forwarding; correlação observada)\n");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
NODE
