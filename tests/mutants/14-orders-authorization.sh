#!/usr/bin/env bash
# Mutação Vite somente em memória: recusar viewer é uma propriedade observada.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const root = process.cwd(), file = "src/rbac/matrix.ts";
const from = "    // viewer: descartado na Fase 1 — nenhum papel, nenhuma permissão.\n    default:\n      return null;";
const to = "    // MUTANT: viewer promovido indevidamente.\n    default:\n      return \"attendant\";";
const title = "nega viewer";
const scratch = mkdtempSync(path.join(os.tmpdir(), "orders-auth-mutant-"));
try {
  assert.equal(readFileSync(path.join(root, file), "utf8").split(from).length, 2, "alvo único");
  const config = path.join(scratch, "vite-mutant.config.mjs"), output = path.join(scratch, "result.json");
  writeFileSync(config, `import base from ${JSON.stringify(path.join(root, "vitest.config.ts"))}; export default {...base,plugins:[...(base.plugins??[]),{name:"orders-auth-mutant",enforce:"pre",transform(code,id){if(id.split("?")[0]!==${JSON.stringify(path.join(root,file))})return;return {code:code.replace(${JSON.stringify(from)},${JSON.stringify(to)}),map:null}}}]}`);
  const run = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "tests/unit/orders-authorization.test.ts", "--config", config, "--maxWorkers=1", "--reporter=json", "--outputFile", output], { cwd: root, encoding: "utf8", timeout: 45000 });
  assert.equal(run.status, 1, "mutante não foi reprovado");
  const result = JSON.parse(readFileSync(output, "utf8"));
  const target = result.testResults.flatMap((entry) => entry.assertionResults).find((test) => test.title === title);
  assert.equal(target?.status, "failed", "negação de viewer não matou mutante");
  const suite = readFileSync(path.join(root, "tests/unit/orders-authorization.test.ts"), "utf8");
  assert.match(suite, /rejects\.toMatchObject\(\{ status: 403 \}\)/, "a prova deve exigir 403 concreto");
  assert.ok(target.failureMessages.some((message) => /promise resolved.*instead of rejecting|AssertionError/i.test(message)), "falha não é a negação concreta do viewer");
  process.stdout.write("mutants_killed=1/1 (orders-authorization; viewer)\n");
} finally { rmSync(scratch, { recursive: true, force: true }); }
NODE
