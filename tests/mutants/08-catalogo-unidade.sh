#!/usr/bin/env bash
# O Vite transforma a cópia carregada pelo teste; o fonte nunca é alterado.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const sourceFile = "lib/schemas/produtos.ts";
const from = "sale_unit: z.string().trim().min(1).max(32).nullable().optional(),";
const to = "sale_unit: z.string().trim().min(1).max(320).nullable().optional(),";
const title = "recusa unidade vazia ou acima de 32 caracteres; não converte nomes em regra comercial";
const scratch = mkdtempSync(path.join(os.tmpdir(), "catalogo-unidade-mutant-"));
try {
  const source = readFileSync(path.join(root, sourceFile), "utf8");
  assert.equal(source.split(from).length, 2, "alvo do mutante deve ser único");
  const config = path.join(scratch, "vite-mutant.config.mjs");
  const output = path.join(scratch, "resultado.json");
  writeFileSync(config, `import base from ${JSON.stringify(path.join(root, "vitest.config.ts"))};
export default { ...base, plugins: [...(base.plugins ?? []), {
  name: "catalogo-unidade-mutant", enforce: "pre",
  transform(code, id) {
    if (id.split("?")[0] !== ${JSON.stringify(path.join(root, sourceFile))}) return;
    return { code: code.replace(${JSON.stringify(from)}, ${JSON.stringify(to)}), map: null };
  }
}] };`);
  const run = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "tests/unit/catalogo-unidade-venda.test.ts", "--config", config, "--maxWorkers=1", "--allowOnly=false", "--reporter=json", "--outputFile", output], { cwd: root, encoding: "utf8", timeout: 45000 });
  assert.equal(run.status, 1, `mutante não foi reprovado\n${run.stdout}\n${run.stderr}`);
  const result = JSON.parse(readFileSync(output, "utf8"));
  const target = result.testResults.flatMap((file) => file.assertionResults).find((test) => test.title === title);
  assert.equal(target?.status, "failed", "falha não ocorreu na asserção esperada");
  assert.ok(target.failureMessages.some((message) => /AssertionError/.test(message)), "erro de infraestrutura não mata mutante");
  process.stdout.write("mutants_killed=1/1 (catalogo-unidade; asserção observada)\n");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
NODE
