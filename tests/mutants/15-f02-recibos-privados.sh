#!/usr/bin/env bash
# F02-T02, G-38: servir recibos de idempotência ao JWT deve reprovar a
# asserção nominal de ACL/RLS. A sabotagem só existe no banco descartável.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

scratch=$(mktemp -d "${TMPDIR:-/tmp}/f02-order-receipt-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

cat >"$scratch/sabotagem.sql" <<'SQL'
grant select on public.crm_order_command_receipts to authenticated;
create policy mutante_recibos_expostos on public.crm_order_command_receipts
  for select to authenticated using (true);
SQL

set +e
TEST_DB_POS_BASELINE_SQL="$scratch/sabotagem.sql" pnpm test:db \
  tests/invariants/f02-t02-order-schema.test.ts \
  -t "mantém domínio read-only, recibo privado e journal append-only por ACL" \
  --reporter=json --outputFile="$scratch/result.json" \
  >"$scratch/result.log" 2>&1
status=$?
set -e

if [ "$status" -ne 1 ]; then
  cat "$scratch/result.log" >&2
  echo "MUTANTE VIVO: saída $status; esperava falha de asserção (1)" >&2
  exit 1
fi

node --input-type=module - "$scratch/result.json" <<'JS'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
const target = report.testResults
  .flatMap((file) => file.assertionResults)
  .find((test) => test.title === "mantém domínio read-only, recibo privado e journal append-only por ACL");
assert.equal(target?.status, "failed", "falha não atingiu a prova esperada");
assert.ok(
  target.failureMessages.some((message) => /ACL\/RLS dos pedidos deixou uma porta direta inesperada/.test(message)),
  "a falha não foi a exposição nominal do recibo",
);
JS

echo "mutants_killed=1/1 (f02-recibos-privados; asserção observada)"
