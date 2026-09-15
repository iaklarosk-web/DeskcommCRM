#!/usr/bin/env bash
# F12 (ADR-031), G-38: a linha `billing` é OBRIGATÓRIA a partir de F12. A
# mutação desliga `requiresBilling` no `report.mjs`; o caso "missing billing
# line makes otherwise green F12 fail" tem de ficar vermelho.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/verify-billing-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
node --input-type=module - "$scratch/report.mjs" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('scripts/verify/report.mjs', 'utf8');
const original = 'const requiresBilling = (phase) => closesAtOrAfter(phase, "F12"); // MUTANT: billing-required';
if (source.split(original).length - 1 !== 1) throw new Error('Mutant target missing');
writeFileSync(process.argv[2], source.replace(original, 'const requiresBilling = () => false; // MUTANTE: billing decorativo'));
JS
cp scripts/verify/f02-e2e.mjs "$scratch/f02-e2e.mjs"
if VERIFY_GATE_MODULE="$scratch/report.mjs" node --test --test-name-pattern='missing billing line' tests/verify/gate.cases.mjs >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: F12 ficou verde sem a linha billing medida' >&2
  exit 1
fi
if ! grep -qE '^not ok .*missing billing line makes otherwise green F12 fail' "$scratch/result.log" || ! grep -qE 'ERR_ASSERTION' "$scratch/result.log"; then
  cat "$scratch/result.log" >&2
  echo 'MUTANTE VIVO: falhou sem a asserção esperada' >&2
  exit 1
fi
echo 'mutants_killed=1/1 (f12-verify-billing-obrigatorio; asserção observada)'
