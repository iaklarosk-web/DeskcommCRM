#!/usr/bin/env bash
# F02-T01, G-38: abrir a leitura de empresas entre tenants deve reprovar a
# prova nominal. A sabotagem entra só depois do baseline efêmero.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

scratch=$(mktemp -d "${TMPDIR:-/tmp}/f02-company-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

cat >"$scratch/sabotagem.sql" <<'SQL'
create policy mutante_crm_companies_aberta on public.crm_companies
  for select to authenticated using (true);
SQL

set +e
TEST_DB_POS_BASELINE_SQL="$scratch/sabotagem.sql" pnpm test:db \
  tests/invariants/f02-t01-crm-schema.test.ts \
  -t "viewer lê sem escrever" --reporter=json --outputFile="$scratch/result.json" \
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
  .find((test) => test.title === "viewer lê sem escrever; agent escreve somente no próprio tenant");
assert.equal(target?.status, "failed", "falha não atingiu a prova esperada");
assert.ok(
  target.failureMessages.some((message) => /viewer não leu A/.test(message)),
  "a falha não foi o vazamento cross-tenant esperado",
);
JS

echo "mutants_killed=1/1 (f02-empresa-tenant; asserção observada)"
