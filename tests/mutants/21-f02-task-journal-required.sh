#!/usr/bin/env bash
# F02-T03: omitir o journal atômico deve reprovar o caso nominal do serviço.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mkdir -p "$PWD/.verify-logs"
scratch=$(mktemp -d "$PWD/.verify-logs/f02-task-journal-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

cat >"$scratch/vitest.integration.mutant.config.mjs" <<'EOF'
import { readFileSync } from "node:fs";

const root = process.cwd();
const target = `${root}/src/crm/work/service.ts`;
const code = readFileSync(target, "utf8");
const from = code.match(/      await writeTaskReceiptAndEvent\(\n[\s\S]*?\n      \);\n/)?.[0];
if (!from) throw new Error("alvo único da escrita de journal não encontrado");

export default {
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    setupFiles: ["./tests/db/banco-limpo-por-arquivo.ts"],
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY:
        "test-service-role-key-not-a-placeholder-1234567890-1234567890",
    },
  },
  resolve: { alias: { "@": root } },
  plugins: [
    {
      name: "crm-task-journal-required-mutant",
      enforce: "pre",
      transform(source, id) {
        if (id.split("?")[0] !== target) return;
        const hits = source.split(from).length - 1;
        if (hits !== 1) throw new Error(`alvo da mutação apareceu ${hits} vezes`);
        return {
          code: source.replace(from, "      // MUTANT: receipt/event omitidos.\n"),
          map: null,
        };
      },
    },
  ],
};
EOF

set +e
TEST_DB_SUITE_DIR="$PWD/tests/integration" \
TEST_DB_VITEST_CONFIG="${scratch#"$PWD"/}/vitest.integration.mutant.config.mjs" \
  pnpm exec bash scripts/test-db.sh tests/integration/crm-work.test.ts \
  -t "grava tarefa, receipt, evento sem PII e audit no mesmo TenantDb" \
  --reporter=json --outputFile="$scratch/result.json" \
  >"$scratch/result.log" 2>&1
status=$?
set -e

if [ "$status" -ne 1 ] || [ ! -s "$scratch/result.json" ]; then
  cat "$scratch/result.log" >&2
  echo "MUTANTE SEM VEREDITO: esperava exit 1 e relatório JSON" >&2
  exit 1
fi

node --input-type=module - "$scratch/result.json" <<'JS'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
const title = "grava tarefa, receipt, evento sem PII e audit no mesmo TenantDb";
const target = report.testResults
  .flatMap((file) => file.assertionResults)
  .find((test) => test.title === title);
assert.equal(target?.status, "failed", "falha não atingiu a prova esperada");
assert.match(
  target.failureMessages.join("\n"),
  /journal atômico da tarefa ausente/,
  "a falha não observou a ausência nominal do journal",
);
JS

echo "mutants_killed=1/1 (f02-task-journal-required; asserção observada)"
