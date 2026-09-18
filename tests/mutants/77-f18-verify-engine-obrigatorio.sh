#!/usr/bin/env bash
# F18 (ADR-041), G-38: a linha `engine` é OBRIGATÓRIA a partir de F18. A
# mutação desliga `requiresEngine` no `report.mjs`; o caso "missing engine
# line makes otherwise green F18 fail" tem de ficar vermelho.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/verify-engine-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
node --input-type=module - "$scratch/report.mjs" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('scripts/verify/report.mjs', 'utf8');
const original = 'const requiresEngine = (phase) => closesAtOrAfter(phase, "F18"); // MUTANT: engine-required';
if (source.split(original).length - 1 !== 1) throw new Error('Mutant target missing');
writeFileSync(process.argv[2], source.replace(original, 'const requiresEngine = () => false; // MUTANTE: engine decorativo'));
JS
cp scripts/verify/f02-e2e.mjs "$scratch/f02-e2e.mjs"
if VERIFY_GATE_MODULE="$scratch/report.mjs" node --test --test-name-pattern='missing engine line' tests/verify/gate.cases.mjs >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: F18 ficou verde sem a linha engine medida' >&2
  exit 1
fi
if ! grep -qE '^not ok .*missing engine line makes otherwise green F18 fail' "$scratch/result.log" || ! grep -qE 'ERR_ASSERTION' "$scratch/result.log"; then
  cat "$scratch/result.log" >&2
  echo 'MUTANTE VIVO: falhou sem a asserção esperada' >&2
  exit 1
fi
echo 'mutants_killed=1/1 (f18-verify-engine-obrigatorio; asserção observada)'
