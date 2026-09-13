#!/usr/bin/env bash
# F02-T02, G-38: retirar o escopo de contato dos snapshots de recibos precisa
# reprovar a prova nominal de exportação LGPD. O fonte real não é alterado.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

scratch=$(mktemp -d "${TMPDIR:-/tmp}/orders-export-scope-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

cat >"$scratch/vitest.integration.mutant.config.mjs" <<'EOF'
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const target = path.resolve(root, "src/crm/orders/export.ts");
const setupFile = path.resolve(root, "tests/db/banco-limpo-por-arquivo.ts");
const from =
  "          and r.completed_at is not null and r.response_body->>'contact_id'=$2::text\n";
const to = "          and r.completed_at is not null\n";

const source = readFileSync(target, "utf8");
const sourceHits = source.split(from).length - 1;
if (sourceHits !== 1) {
  throw new Error(`alvo único do escopo de snapshot apareceu ${sourceHits} vezes`);
}

export default {
  test: {
    environment: "node",
    include: [path.resolve(root, "tests/integration/**/*.test.ts")],
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    setupFiles: [setupFile],
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
      name: "orders-export-scope-mutant",
      enforce: "pre",
      transform(code, id) {
        if (path.resolve(id.split("?")[0]) !== target) return;
        const hits = code.split(from).length - 1;
        if (hits !== 1) throw new Error(`alvo da mutação apareceu ${hits} vezes`);
        return {
          code: code.replace(from, to),
          map: null,
        };
      },
    },
  ],
};
EOF

title="exporta histórico real do titular sem carregar estado do outro contato ou tenant"
set +e
TEST_DB_SUITE_DIR="$PWD/tests/integration" \
TEST_DB_VITEST_CONFIG="$scratch/vitest.integration.mutant.config.mjs" \
  pnpm exec bash scripts/test-db.sh tests/integration/crm-orders.test.ts \
  -t "$title" \
  --reporter=json --outputFile="$scratch/result.json" \
  >"$scratch/result.log" 2>&1
status=$?
set -e

if [ "$status" -ne 1 ]; then
  cat "$scratch/result.log" >&2
  echo "MUTANTE VIVO: saída $status; esperava falha de asserção (1)" >&2
  exit 1
fi

if [ ! -s "$scratch/result.json" ]; then
  cat "$scratch/result.log" >&2
  echo "MUTANTE SEM VEREDITO: vitest saiu 1 sem relatório JSON" >&2
  exit 1
fi

node --input-type=module - "$scratch/result.json" "$title" <<'JS'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
const title = process.argv[3];
const targets = report.testResults
  .flatMap((file) => file.assertionResults)
  .filter((test) => test.title === title);
assert.equal(targets.length, 1, "o relatório não contém exatamente a prova nominal");
assert.equal(targets[0].status, "failed", "falha não atingiu a prova esperada");
const failureText = targets[0].failureMessages.join("\n");
assert.match(failureText, /AssertionError/i, "erro de infraestrutura não mata o mutante");
assert.match(
  failureText,
  /expected .* to have a length of 3 but got 4/is,
  `a falha não foi o snapshot do outro contato incluído no export:\n${failureText}`,
);
JS

echo "mutants_killed=1/1 (orders-export-scope; saved_snapshots esperado=3 observado=4)"
