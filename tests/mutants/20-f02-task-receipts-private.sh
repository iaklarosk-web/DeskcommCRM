#!/usr/bin/env bash
# F02-T03: expor o hash/receipt ao JWT precisa falhar na asserção nominal de ACL.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mkdir -p "$PWD/.verify-logs"
scratch=$(mktemp -d "$PWD/.verify-logs/f02-task-receipt-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

cat >"$scratch/sabotagem.sql" <<'SQL'
grant select on public.crm_task_command_receipts to authenticated;
create policy mutante_task_receipts_expostos on public.crm_task_command_receipts
  for select to authenticated using (true);
SQL

set +e
TEST_DB_POS_BASELINE_SQL="$scratch/sabotagem.sql" pnpm test:db \
  tests/invariants/f02-t03-work-schema.test.ts \
  -t "mantém notas/eventos append-only e receipts privados por ACL" \
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
const title = "mantém notas/eventos append-only e receipts privados por ACL";
const target = report.testResults
  .flatMap((file) => file.assertionResults)
  .find((test) => test.title === title);
assert.equal(target?.status, "failed", "falha não atingiu a prova esperada");
assert.match(
  target.failureMessages.join("\n"),
  /ACL T03 expôs receipt privado ou abriu escrita no domínio append-only/,
  "a falha não observou a exposição nominal do receipt",
);
JS

echo "mutants_killed=1/1 (f02-task-receipts-private; asserção observada)"
