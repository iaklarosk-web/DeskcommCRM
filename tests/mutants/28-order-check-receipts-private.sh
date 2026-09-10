#!/usr/bin/env bash
# F02-T12: expor chave/hash/replay de conferência precisa reprovar a ACL nominal.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mkdir -p "$PWD/.verify-logs"
scratch=$(mktemp -d "$PWD/.verify-logs/f02-order-check-receipt-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

cat >"$scratch/sabotagem.sql" <<'SQL'
grant select on public.crm_order_check_command_receipts to authenticated;
SQL

title="mantém recibos privados, eventos append-only e função security invoker"
set +e
TEST_DB_POS_BASELINE_SQL="$scratch/sabotagem.sql" pnpm test:db \
  tests/invariants/f02-t12-order-checks-schema.test.ts \
  -t "$title" \
  --reporter=json --outputFile="$scratch/result.json" \
  >"$scratch/result.log" 2>&1
status=$?
set -e

if [ "$status" -ne 1 ] || [ ! -s "$scratch/result.json" ]; then
  cat "$scratch/result.log" >&2
  echo "MUTANTE SEM VEREDITO: esperava exit 1 e relatório JSON" >&2
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
assert.match(
  targets[0].failureMessages.join("\n"),
  /ACL expôs recibo\/hash ou abriu escrita no journal/,
  "a falha não observou a exposição do recibo privado",
);
JS

echo "mutants_killed=1/1 (order-check-receipt-private; ACL observada)"
