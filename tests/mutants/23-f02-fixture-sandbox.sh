#!/usr/bin/env bash
# A escrita fictícia sem o guard de sandbox deve reprovar no banco real descartável.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "scripts/f02-fixture-writer.ts");
const before = readFileSync(source, "utf8");
const needle = "  await requireSandboxMarker(db, options.sandboxMarker);";
assert.equal(before.split(needle).length, 2, "a chamada do guard precisa ser única");
mkdirSync(path.join(root, ".verify-logs"), { recursive: true });
const scratch = mkdtempSync(path.join(root, ".verify-logs/f02-fixture-mutant-"));
try {
  const config = path.join(scratch, "vitest.config.mjs");
  const reportPath = path.join(scratch, "result.json");
  writeFileSync(config, `import base from ${JSON.stringify(path.join(root, "vitest.integration.config.ts"))};
export default {...base,plugins:[...(base.plugins??[]),{name:"f02-fixture-sandbox-mutant",enforce:"pre",transform(code,id){
if(id.split("?")[0]!==${JSON.stringify(source)})return;
return {code:code.replace(${JSON.stringify(needle)},"  void options.sandboxMarker; // MUTANT: guard omitido"),map:null};
}}]};\n`);
  const run = spawnSync("pnpm", [
    "exec", "bash", "scripts/test-db.sh", "tests/integration/create-tenant-f02-seed.test.ts",
    "-t", "recusa marcador ausente ou diferente antes de inserir domínio",
    "--reporter=json", "--outputFile=" + reportPath,
  ], {
    cwd: root,
    env: {
      ...process.env,
      TEST_DB_SUITE_DIR: path.join(root, "tests/integration"),
      TEST_DB_VITEST_CONFIG: path.relative(root, config),
    },
    encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  });
  if (run.status !== 1) process.stderr.write((run.stdout + run.stderr).slice(-6000));
  assert.equal(run.status, 1, "o mutante precisa ser recusado pela asserção, não por timeout");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const target = report.testResults.flatMap((file) => file.assertionResults)
    .find((test) => test.title === "recusa marcador ausente ou diferente antes de inserir domínio");
  assert.equal(target?.status, "failed", "falha não atingiu a prova de sandbox");
  assert.match(target.failureMessages.join("\n"), /promise resolved.*instead of rejecting/s,
    "a falha precisa observar escrita admitida sem o marcador");
  assert.equal(readFileSync(source, "utf8"), before, "a mutação não pode alterar o produto");
  process.stdout.write("mutants_killed=1/1 (f02-fixture-sandbox; escrita sem marcador observada)\n");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
NODE
