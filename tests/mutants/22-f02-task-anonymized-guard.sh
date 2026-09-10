#!/usr/bin/env bash
# F02-T03: remover o guard deve deixar PII tardia e reprovar a asserção nominal.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mkdir -p "$PWD/.verify-logs"
scratch=$(mktemp -d "$PWD/.verify-logs/f02-task-anonymized-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

cat >"$scratch/sabotagem.sql" <<'SQL'
drop trigger trg_crm_tasks_guard_anonymized_contact on public.crm_tasks;
SQL

set +e
TEST_DB_POS_BASELINE_SQL="$scratch/sabotagem.sql" pnpm test:db \
  tests/invariants/f02-t03-work-schema.test.ts \
  -t "redige INSERT e UPDATE tardios sem alterar tarefa de contato ativo" \
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
const title = "redige INSERT e UPDATE tardios sem alterar tarefa de contato ativo";
const target = report.testResults
  .flatMap((file) => file.assertionResults)
  .find((test) => test.title === title);
assert.equal(target?.status, "failed", "falha não atingiu a prova esperada");
assert.match(
  target.failureMessages.join("\n"),
  /guard deixou PII tardia ligada ao contato anonimizado/,
  "a falha não observou PII tardia sem o guard",
);
JS

echo "mutants_killed=1/1 (f02-task-anonymized-guard; asserção observada)"
