#!/usr/bin/env bash
# F19 (ADR-043), G-38: a linha `stripe` é OBRIGATÓRIA a partir de F19. A
# mutação desliga `requiresStripe` no `report.mjs`; o caso "missing stripe
# line makes otherwise green F19 fail" tem de ficar vermelho.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/verify-stripe-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
node --input-type=module - "$scratch/report.mjs" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('scripts/verify/report.mjs', 'utf8');
const original = 'const requiresStripe = (phase) => closesAtOrAfter(phase, "F19"); // MUTANT: stripe-required';
if (source.split(original).length - 1 !== 1) throw new Error('Mutant target missing');
writeFileSync(process.argv[2], source.replace(original, 'const requiresStripe = () => false; // MUTANTE: stripe decorativa'));
JS
cp scripts/verify/f02-e2e.mjs "$scratch/f02-e2e.mjs"
if VERIFY_GATE_MODULE="$scratch/report.mjs" node --test --test-name-pattern='missing stripe line' tests/verify/gate.cases.mjs >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: F19 ficou verde sem a linha stripe medida' >&2
  exit 1
fi
if ! grep -qE '^not ok .*missing stripe line makes otherwise green F19 fail' "$scratch/result.log" || ! grep -qE 'ERR_ASSERTION' "$scratch/result.log"; then
  cat "$scratch/result.log" >&2
  echo 'MUTANTE VIVO: falhou sem a asserção esperada' >&2
  exit 1
fi
echo 'mutants_killed=1/1 (f19-verify-stripe-obrigatorio; asserção observada)'
