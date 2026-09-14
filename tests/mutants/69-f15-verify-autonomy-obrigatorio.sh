#!/usr/bin/env bash
# F15 (ADR-037), G-38: a linha `autonomy` é OBRIGATÓRIA a partir de F15. A
# mutação desliga `requiresAutonomy` no `report.mjs`; o caso "missing autonomy
# line makes otherwise green F15 fail" tem de ficar vermelho.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/verify-autonomy-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
node --input-type=module - "$scratch/report.mjs" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('scripts/verify/report.mjs', 'utf8');
const original = 'const requiresAutonomy = (phase) => closesAtOrAfter(phase, "F15"); // MUTANT: autonomy-required';
if (source.split(original).length - 1 !== 1) throw new Error('Mutant target missing');
writeFileSync(process.argv[2], source.replace(original, 'const requiresAutonomy = () => false; // MUTANTE: autonomy decorativo'));
JS
cp scripts/verify/f02-e2e.mjs "$scratch/f02-e2e.mjs"
if VERIFY_GATE_MODULE="$scratch/report.mjs" node --test --test-name-pattern='missing autonomy line' tests/verify/gate.cases.mjs >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: F15 ficou verde sem a linha autonomy medida' >&2
  exit 1
fi
if ! grep -qE '^not ok .*missing autonomy line makes otherwise green F15 fail' "$scratch/result.log" || ! grep -qE 'ERR_ASSERTION' "$scratch/result.log"; then
  cat "$scratch/result.log" >&2
  echo 'MUTANTE VIVO: falhou sem a asserção esperada' >&2
  exit 1
fi
echo 'mutants_killed=1/1 (f15-verify-autonomy-obrigatorio; asserção observada)'
