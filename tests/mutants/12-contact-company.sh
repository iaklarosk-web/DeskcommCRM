#!/usr/bin/env bash
# Vite troca somente o módulo carregado pela suíte; a fonte permanece intacta.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const file = "app/api/v1/contacts/_handler.ts";
const from = "    if (!company) {";
const to = "    if (false) {";
const title = "empresa de outra organização vira 422 sem atualizar e sem revelar existência";
const scratch = mkdtempSync(path.join(os.tmpdir(), "contact-company-mutant-"));
try {
  assert.equal(readFileSync(path.join(root, file), "utf8").split(from).length, 2, "alvo único");
  const config = path.join(scratch, "vite-mutant.config.mjs");
  const output = path.join(scratch, "resultado.json");
  writeFileSync(config, `import base from ${JSON.stringify(path.join(root, "vitest.config.ts"))};
export default { ...base, plugins: [...(base.plugins ?? []), { name: "contact-company-mutant", enforce: "pre", transform(code, id) {
  if (id.split("?")[0] !== ${JSON.stringify(path.join(root, file))}) return;
  return { code: code.replace(${JSON.stringify(from)}, ${JSON.stringify(to)}), map: null };
}}] };`);
  const run = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "tests/unit/contact-commercial-link.test.tsx", "--config", config, "--maxWorkers=1", "--allowOnly=false", "--reporter=json", "--outputFile", output], { cwd: root, encoding: "utf8", timeout: 45000 });
  assert.equal(run.status, 1, `mutante não foi reprovado\n${run.stdout}\n${run.stderr}`);
  const result = JSON.parse(readFileSync(output, "utf8"));
  const target = result.testResults.flatMap((entry) => entry.assertionResults).find((test) => test.title === title);
  assert.equal(target?.status, "failed", "a prova de tenant não matou o mutante");
  const suite = readFileSync(path.join(root, "tests/unit/contact-commercial-link.test.tsx"), "utf8");
  assert.match(suite, /rejects\.toMatchObject\(\{ status: 422, code: "validation_failed" \}\)/, "a prova deve exigir 422 concreto");
  assert.ok(target.failureMessages.some((message) => /promise resolved.*instead of rejecting|AssertionError/i.test(message)), "falha não é a rejeição concreta da empresa fora do tenant");
  process.stdout.write("mutants_killed=1/1 (contact-company; tenant validation)\n");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
NODE
