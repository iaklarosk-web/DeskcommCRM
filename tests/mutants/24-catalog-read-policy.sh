#!/usr/bin/env bash
# F02: reintroduzir FOR ALL deve reprovar o plano de leitura, sem medir tempo.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mkdir -p "$PWD/.verify-logs"
scratch=$(mktemp -d "$PWD/.verify-logs/f02-catalog-read-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

cat >"$scratch/sabotagem.sql" <<'SQL'
create policy mutante_catalog_write_all on public.catalog_products
  for all using (
    public.fn_is_platform_admin() or (
      organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id,'manager')
    )
  ) with check (
    public.fn_is_platform_admin() or (
      organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id,'manager')
    )
  );
SQL

set +e
TEST_DB_POS_BASELINE_SQL="$scratch/sabotagem.sql" pnpm test:db \
  tests/invariants/f02-catalog-read-policy.test.ts \
  -t "SELECT do catálogo não executa verificação de papel de escrita por linha" \
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
const title = "SELECT do catálogo não executa verificação de papel de escrita por linha";
const target = report.testResults
  .flatMap((file) => file.assertionResults)
  .find((test) => test.title === title);
assert.equal(target?.status, "failed", "falha não atingiu a prova esperada");
assert.match(
  target.failureMessages.join("\n"),
  /SELECT do catálogo voltou a avaliar fn_role_at_least por linha|SELECT do catálogo recebeu novamente uma policy FOR ALL/,
  "a falha não observou a regressão nominal de SELECT/FOR ALL",
);
JS

echo "mutants_killed=1/1 (f02-catalog-read-policy; asserção observada)"
