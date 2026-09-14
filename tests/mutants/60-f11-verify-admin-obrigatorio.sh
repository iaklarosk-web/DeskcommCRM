#!/usr/bin/env bash
# F11 (ADR-031), G-38: a linha `admin` é OBRIGATÓRIA a partir de F11. A mutação
# desliga `requiresAdmin` no `report.mjs`: sem a linha o gate continuaria
# verde, e é isso que o caso "missing admin line makes otherwise green F11
# fail" tem de pegar. Mesma mecânica dos mutantes 48/57/59.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/verify-admin-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
node --input-type=module - "$scratch/report.mjs" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('scripts/verify/report.mjs', 'utf8');
const original = 'const requiresAdmin = (phase) => closesAtOrAfter(phase, "F11"); // MUTANT: admin-required';
if (source.split(original).length - 1 !== 1) throw new Error('Mutant target missing');
writeFileSync(process.argv[2], source.replace(original, 'const requiresAdmin = () => false; // MUTANTE: admin decorativo'));
JS
cp scripts/verify/f02-e2e.mjs "$scratch/f02-e2e.mjs"
if VERIFY_GATE_MODULE="$scratch/report.mjs" node --test --test-name-pattern='missing admin line' tests/verify/gate.cases.mjs >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: F11 ficou verde sem a linha admin medida' >&2
  exit 1
fi
if ! grep -qE '^not ok .*missing admin line makes otherwise green F11 fail' "$scratch/result.log" || ! grep -qE 'ERR_ASSERTION' "$scratch/result.log"; then
  cat "$scratch/result.log" >&2
  echo 'MUTANTE VIVO: falhou sem a asserção esperada' >&2
  exit 1
fi
echo 'mutants_killed=1/1 (f11-verify-admin-obrigatorio; asserção observada)'
