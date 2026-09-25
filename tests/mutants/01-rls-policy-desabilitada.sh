#!/usr/bin/env bash
# Mutante 01 (F01-T11, G-38): policy sabotada TEM de deixar a prova de
# isolamento vermelha. Sabota o molde com uma policy `using (true)` FOR ALL em
# contacts e uma tabela-prova sem constraints comerciais. As guardas atuais de
# contacts podem impedir escritas mesmo com RLS aberta; a tabela-prova garante
# que a régua continue detectando as 4 ops × 2 direções, sem remover essas guardas.
# Um controle com policy de tenant deve passar antes da sabotagem. Morto = exit 0.
#
# ⚠️ Vermelho POR VAZAMENTO, não por quebra (corolário do G-04: a primeira
# versão deste script "matava" o mutante com um `vitest: command not found` —
# exit 127 também é ≠ 0). Por isso: (a) roda via pnpm (PATH do .bin), e
# (b) exige os 8 casos distintos no JSON, todos com vazamento da tabela-prova.
# Contar linhas do terminal duplicava nomes e não comprovava oito asserções.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

TASK_TMP=$(mktemp -d "${TMPDIR:-/tmp}/mutante-rls.XXXXXXXX")
trap 'rm -rf -- "$TASK_TMP"' EXIT
cat > "$TASK_TMP/control.sql" <<'SQL'
create table public._mutant_rls_probe (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
);
alter table public._mutant_rls_probe enable row level security;
create policy mutant_probe_tenant on public._mutant_rls_probe
  for all to authenticated
  using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));
grant select, insert, update, delete on public._mutant_rls_probe to authenticated;
SQL
cp "$TASK_TMP/control.sql" "$TASK_TMP/mutant.sql"
cat >> "$TASK_TMP/mutant.sql" <<'SQL'
-- MUTANTE: abre contacts para qualquer authenticated, cross-org.
create policy mutante_contacts_aberta on public.contacts
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.contacts to authenticated;
drop policy mutant_probe_tenant on public._mutant_rls_probe;
create policy mutant_probe_aberta on public._mutant_rls_probe
  for all to authenticated using (true) with check (true);
SQL

if ! TEST_DB_POS_BASELINE_SQL="$TASK_TMP/control.sql" pnpm test:db tests/invariants/isolation-varredura.test.ts \
  --reporter=default --reporter=json --outputFile="$TASK_TMP/control.json" > "$TASK_TMP/control.log" 2>&1; then
  tail -30 "$TASK_TMP/control.log" >&2
  echo "MUTANTE VIVO: controle com policy de tenant falhou" >&2
  exit 1
fi
if TEST_DB_POS_BASELINE_SQL="$TASK_TMP/mutant.sql" pnpm test:db tests/invariants/isolation-varredura.test.ts \
  --reporter=default --reporter=json --outputFile="$TASK_TMP/mutant.json" > "$TASK_TMP/mutant.log" 2>&1; then
  echo "MUTANTE VIVO: a prova de isolamento passou com policy using(true) em contacts" >&2
  exit 1
fi

if ! node --input-type=module - "$TASK_TMP/control.json" "$TASK_TMP/mutant.json" <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const [control, mutant] = process.argv.slice(2).map(p => JSON.parse(readFileSync(p, 'utf8')));
assert.equal(control.numTotalTests, 9);
assert.equal(control.numPassedTests, 9);
assert.equal(control.numPendingTests, 0);
assert.equal(mutant.numTotalTests, 9);
assert.equal(mutant.numFailedTests, 8);
assert.equal(mutant.numPassedTests, 1);
assert.equal(mutant.numPendingTests, 0);
const cases = mutant.testResults.flatMap(suite => suite.assertionResults);
for (const direction of ['A→B', 'B→A']) {
  for (const op of ['select', 'insert', 'update', 'delete']) {
    const matches = cases.filter(test => test.title.startsWith(`${direction}: ${op} cross-org afeta 0 linhas`));
    assert.equal(matches.length, 1, `${direction}/${op}: identidade única`);
    assert.equal(matches[0].status, 'failed');
    assert.match(matches[0].failureMessages.join('\n'), /_mutant_rls_probe=\d+/);
  }
}
JS
then
  echo "MUTANTE VIVO: faltam oito asserções distintas de vazamento; falha de infraestrutura não conta" >&2
  tail -30 "$TASK_TMP/mutant.log" >&2
  exit 1
fi
echo "mutants_killed=1/1 (rls; controle=9/9; vazamentos detectados=8/8, quatro operações em duas direções)"
exit 0
