#!/usr/bin/env bash
# F02-T02, G-38: remover a guarda de contato imutável precisa reprovar o caso
# nominal que exige contact_change_not_allowed. O fonte real não é alterado.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

scratch=$(mktemp -d "${TMPDIR:-/tmp}/orders-contact-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

cat >"$scratch/vitest.integration.mutant.config.mjs" <<'EOF'
import { readFileSync } from "node:fs";

const root = process.cwd();
const target = `${root}/src/crm/orders/service.ts`;
const from = readFileSync(target, "utf8").match(
  /        if \(\n          command\.command === "edit_order"[\s\S]*?throw new OrderServiceError\("contact_change_not_allowed", 422\);\n/,
)?.[0];
if (!from) throw new Error("alvo único da guarda de contato não encontrado");

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
      name: "orders-contact-immutability-mutant",
      enforce: "pre",
      transform(code, id) {
        if (id.split("?")[0] !== target) return;
        const hits = code.split(from).length - 1;
        if (hits !== 1) throw new Error(`alvo da mutação apareceu ${hits} vezes`);
        return { code: code.replace(from, "        // MUTANT: troca de contato aceita.\n"), map: null };
      },
    },
  ],
};
EOF

set +e
TEST_DB_SUITE_DIR="$PWD/tests/integration" \
TEST_DB_VITEST_CONFIG="$scratch/vitest.integration.mutant.config.mjs" \
  pnpm exec bash scripts/test-db.sh tests/integration/crm-orders.test.ts \
  -t "nega IDs cruzados de contato, empresa, produto e pedido sem efeitos" \
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

node --input-type=module - "$scratch/result.json" <<'JS'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
const title = "nega IDs cruzados de contato, empresa, produto e pedido sem efeitos";
const target = report.testResults
  .flatMap((file) => file.assertionResults)
  .find((test) => test.title === title);
assert.equal(target?.status, "failed", "falha não atingiu a prova esperada");
const failureText = target.failureMessages.join("\n");
const source = readFileSync("tests/integration/crm-orders.test.ts", "utf8");
const start = source.indexOf(`it("${title}"`);
const end = source.indexOf("\n  it(", start + 1);
const focusedCase = source.slice(start, end < 0 ? undefined : end);
assert.ok(start >= 0 && /contact_change_not_allowed/.test(focusedCase), "denominador nominal ausente");
assert.ok(
  /contact_unavailable/.test(failureText),
  `a falha não observou a validação posterior à guarda removida:\n${failureText}`,
);
JS

echo "mutants_killed=1/1 (orders-contact-immutability; asserção observada)"
