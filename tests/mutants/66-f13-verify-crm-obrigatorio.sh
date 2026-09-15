#!/usr/bin/env bash
# F13 (ADR-035), G-38: a linha `crm` é OBRIGATÓRIA a partir de F13. A
# mutação desliga `requiresCrm` no `report.mjs`; o caso "missing crm
# line makes otherwise green F13 fail" tem de ficar vermelho.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/verify-crm-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
node --input-type=module - "$scratch/report.mjs" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('scripts/verify/report.mjs', 'utf8');
const original = 'const requiresCrm = (phase) => closesAtOrAfter(phase, "F13"); // MUTANT: crm-required';
if (source.split(original).length - 1 !== 1) throw new Error('Mutant target missing');
writeFileSync(process.argv[2], source.replace(original, 'const requiresCrm = () => false; // MUTANTE: crm decorativo'));
JS
cp scripts/verify/f02-e2e.mjs "$scratch/f02-e2e.mjs"
if VERIFY_GATE_MODULE="$scratch/report.mjs" node --test --test-name-pattern='missing crm line' tests/verify/gate.cases.mjs >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: F13 ficou verde sem a linha crm medida' >&2
  exit 1
fi
if ! grep -qE '^not ok .*missing crm line makes otherwise green F13 fail' "$scratch/result.log" || ! grep -qE 'ERR_ASSERTION' "$scratch/result.log"; then
  cat "$scratch/result.log" >&2
  echo 'MUTANTE VIVO: falhou sem a asserção esperada' >&2
  exit 1
fi
echo 'mutants_killed=1/1 (f13-verify-crm-obrigatorio; asserção observada)'
