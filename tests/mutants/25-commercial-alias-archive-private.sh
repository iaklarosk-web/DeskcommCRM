#!/usr/bin/env bash
# F02-T08: expor o arquivo bruto de aliases deve reprovar a ACL nominal.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mkdir -p "$PWD/.verify-logs"
scratch=$(mktemp -d "$PWD/.verify-logs/f02-commercial-archive-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

cat >"$scratch/sabotagem.sql" <<'SQL'
grant select on private.tenant_setting_alias_archive to authenticated;
SQL

set +e
TEST_DB_POS_BASELINE_SQL="$scratch/sabotagem.sql" pnpm test:db \
  tests/invariants/f02-t08-commercial-schema.test.ts \
  -t "nenhum papel cliente nem service_role lê/escreve/apaga o arquivo" \
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
const title = "nenhum papel cliente nem service_role lê/escreve/apaga o arquivo";
const target = report.testResults
  .flatMap((file) => file.assertionResults)
  .find((test) => test.title === title);
assert.equal(target?.status, "failed", "falha não atingiu a prova de ACL");
assert.match(
  target.failureMessages.join("\n"),
  /arquivo privado exposto: authenticated pode select/,
  "a falha não observou a exposição nominal do arquivo",
);
JS

echo "mutants_killed=1/1 (commercial-alias-archive-private; ACL observada)"
