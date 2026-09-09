#!/usr/bin/env bash
# Muta somente o módulo carregado pelo Vite; nenhuma fonte do produto é escrita.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const file = "app/app/orders/[id]/_client.tsx";
const from = "disabled={saving || needsReload || order.pending.length > 0}";
const to = "disabled={saving || needsReload}";
const title = "não confirma pedido com pendência humana";
const scratch = mkdtempSync(path.join(os.tmpdir(), "orders-ui-mutant-"));
try {
  assert.equal(readFileSync(path.join(root, file), "utf8").split(from).length, 2, "alvo do mutante mudou");
  const config = path.join(scratch, "vite-mutant.config.mjs");
  const output = path.join(scratch, "resultado.json");
  writeFileSync(config, `import base from ${JSON.stringify(path.join(root, "vitest.config.ts"))}; export default { ...base, plugins: [...(base.plugins ?? []), { name: "orders-ui-mutant", enforce: "pre", transform(code, id) { if (id.split("?")[0] !== ${JSON.stringify(path.join(root, file))}) return; return { code: code.replace(${JSON.stringify(from)}, ${JSON.stringify(to)}), map: null }; } }] };`);
  const run = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "tests/unit/orders-ui.test.tsx", "--config", config, "--maxWorkers=1", "--allowOnly=false", "--reporter=json", "--outputFile", output], { cwd: root, encoding: "utf8", timeout: 45000 });
  assert.equal(run.status, 1, `mutante não foi reprovado\n${run.stdout}\n${run.stderr}`);
  const result = JSON.parse(readFileSync(output, "utf8"));
  const target = result.testResults.flatMap((entry) => entry.assertionResults).find((test) => test.title === title);
  assert.equal(target?.status, "failed", "a prova de pendência não matou o mutante");
  assert.ok(target.failureMessages.some((message) => message.includes("toBeDisabled")), "falha de infraestrutura não conta");
  process.stdout.write("mutants_killed=1/1 (orders-ui; pendência bloqueia confirmação)\n");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
NODE
