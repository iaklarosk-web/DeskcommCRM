#!/usr/bin/env bash
# F06-T02, G-38: o teto do webhook SaaS (§5.18, §7.7).
#
# ─── O que este mutante sabota ───────────────────────────────────────────────
#
# A rota consulta `limitarWebhook` e, se `allowed=false`, responde 429 ANTES
# de ler o corpo. A mutação mantém a consulta e ignora o veredicto — o
# contador sobe, o log não sai, e todo mundo passa. É a forma provável de a
# regra morrer: alguém "simplifica" o `if` e nada quebra à vista, porque o
# limite só se manifesta sob abuso.
#
# Tem de deixar "101 requisições → status_429 ≥ 1" vermelho em
# tests/unit/f06-t02-schema-e-rate-limit.test.ts.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const file = "app/api/v1/webhooks/saas/[provider]/route.ts";
const from = "    if (!limite.allowed) {";
const to = "    if (false && !limite.allowed) { /* MUTANTE: teto decorativo */";
const title = "webhook SaaS: 101 requisições do mesmo IP com teto 100 → status_429 ≥ 1, e nenhuma toca o banco";
// `-t` é regex: os parênteses do título não podem entrar no filtro.
const filtro = "101 requisições do mesmo IP com teto 100";
const scratch = mkdtempSync(path.join(os.tmpdir(), "f06-webhook-sem-teto-mutant-"));

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
       name:"f06-webhook-sem-teto-mutant",enforce:"pre",
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
      "tests/unit/f06-t02-schema-e-rate-limit.test.ts",
      "-t",
      filtro,
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
  assert.equal(alvo?.status, "failed", "a prova não detectou o teto decorativo");
  assert.match(
    alvo.failureMessages.join("\n"),
    /nenhuma 429 em 101 requisições/,
    "a falha não foi a ausência do 429",
  );
  process.stdout.write("mutants_killed=1/1 (f06-webhook-sem-teto; asserção observada)\n");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
NODE
