#!/usr/bin/env bash
# F03-T01: sem o gatilho de projeção, escrita legada de status deixa de chegar
# ao saas_state — e a prova de projeção tem de ficar VERMELHA na asserção
# nominal, não em outra qualquer.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mkdir -p "$PWD/.verify-logs"
scratch=$(mktemp -d "$PWD/.verify-logs/f03-projecao-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

cat >"$scratch/sabotagem.sql" <<'SQL'
drop trigger trg_saas_state_project on public.conversations;
SQL

set +e
TEST_DB_POS_BASELINE_SQL="$scratch/sabotagem.sql" pnpm test:db \
  tests/invariants/f03-t01-conversa-estado.test.ts \
  -t "o gatilho projeta cada um dos sete status legados no estado D16 do mapa" \
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
const title = "o gatilho projeta cada um dos sete status legados no estado D16 do mapa";
const target = report.testResults
  .flatMap((file) => file.assertionResults)
  .find((test) => test.title === title);
assert.equal(target?.status, "failed", "falha não atingiu a prova esperada");
assert.match(
  target.failureMessages.join("\n"),
  /projeção do status legado não chegou ao saas_state esperado/,
  "a falha não observou a projeção ausente",
);
JS

echo "mutants_killed=1/1 (f03-projecao-de-estado; asserção observada)"
