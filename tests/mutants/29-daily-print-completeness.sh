#!/usr/bin/env bash
# Muta a paginação em memória; nenhuma fonte de produto é escrita.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const root = process.cwd(), file = "app/app/orders/daily/_client.tsx";
const from = "report.orders.map((order) =>";
const to = "report.orders.slice(0, 500).map((order) =>";
const title = "imprime as 501 linhas do DTO já carregado sem nova consulta";
const scratch = mkdtempSync(path.join(os.tmpdir(), "daily-print-mutant-"));
try {
  assert.equal(readFileSync(path.join(root, file), "utf8").split(from).length, 2, "alvo do mutante mudou");
  const config = path.join(scratch, "vite-mutant.config.mjs"), output = path.join(scratch, "result.json");
  writeFileSync(config, `import base from ${JSON.stringify(path.join(root, "vitest.config.ts"))}; export default {...base,plugins:[...(base.plugins??[]),{name:"daily-print-mutant",enforce:"pre",transform(code,id){if(id.split("?")[0]!==${JSON.stringify(path.join(root,file))})return;return {code:code.replace(${JSON.stringify(from)},${JSON.stringify(to)}),map:null}}}]}`);
  const run = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "tests/unit/daily-orders-ui.test.tsx", "--config", config, "--maxWorkers=1", "--allowOnly=false", "--reporter=json", "--outputFile", output], { cwd: root, encoding: "utf8", timeout: 45000 });
  assert.equal(run.status, 1, "mutante não foi reprovado");
  const target = JSON.parse(readFileSync(output, "utf8")).testResults.flatMap((entry) => entry.assertionResults).find((test) => test.title === title);
  assert.equal(target?.status, "failed", "a prova não detectou o truncamento de impressão");
  process.stdout.write("mutants_killed=1/1 (daily-print; 501 linhas não podem truncar)\\n");
} finally { rmSync(scratch, { recursive: true, force: true }); }
NODE
