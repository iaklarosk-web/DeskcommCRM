import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const scratch = mkdtempSync(path.join(os.tmpdir(), "crm-company-mutant-"));
try {
  const sourcePath = path.join(root, "app/api/v1/companies/[id]/route.ts");
  const guard = '.eq("organization_id", authz.org.orgId)';
  assert.equal(readFileSync(sourcePath, "utf8").split(guard).length, 4, "GET/PATCH/DELETE devem ter escopo explícito");
  const config = path.join(scratch, "vitest.config.mjs");
  writeFileSync(config, `import base from ${JSON.stringify(path.join(root, "vitest.config.ts"))};
export default { ...base, plugins: [...(base.plugins ?? []), {
  name: "company-tenant-mutant", enforce: "pre",
  transform(code, id) {
    if (id.split("?")[0] !== ${JSON.stringify(sourcePath)}) return;
    return { code: code.replaceAll(${JSON.stringify(guard)}, ""), map: null };
  }
}] };`);
  const output = path.join(scratch, "result.json");
  const run = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run",
    "tests/unit/crm-empresas-api.test.ts", "--config", config, "--maxWorkers=1", "--allowOnly=false",
    "--reporter=json", "--outputFile", output], { cwd: root, encoding: "utf8", timeout: 45_000 });
  assert.equal(run.status, 1, `Mutante não reprovado por teste: ${run.stdout}\n${run.stderr}`);
  const report = JSON.parse(readFileSync(output, "utf8"));
  const target = report.testResults.flatMap((f) => f.assertionResults)
    .find((t) => t.title === "PATCH preserva omissão e usa escopo explícito de tenant e recurso");
  assert.equal(target?.status, "failed");
  assert.ok(target.failureMessages.some((m) => m.includes("AssertionError")), "erro de infraestrutura não mata mutante");
  process.stdout.write("mutants_killed=1/1 (crm-empresas-tenant; asserção observada)\n");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
