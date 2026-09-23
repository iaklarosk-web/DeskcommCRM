#!/usr/bin/env bash
# F20 (ADR-046 §2), G-38: a linha `invites` é OBRIGATÓRIA a partir da F20. A
# mutação desliga `requiresInvites` no `report.mjs`; o caso "missing invites
# line makes otherwise green F20 fail" tem de ficar vermelho — senão a métrica
# seria decorativa e o gate mentiria a favor (lição da F18).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/verify-invites-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
node --input-type=module - "$scratch/report.mjs" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('scripts/verify/report.mjs', 'utf8');
const original = 'const requiresInvites = (phase) => closesAtOrAfter(phase, "F20"); // MUTANT: invites-required';
if (source.split(original).length - 1 !== 1) throw new Error('Mutant target missing');
writeFileSync(process.argv[2], source.replace(original, 'const requiresInvites = () => false; // MUTANTE: invites decorativa'));
JS
cp scripts/verify/f02-e2e.mjs "$scratch/f02-e2e.mjs"
if VERIFY_GATE_MODULE="$scratch/report.mjs" node --test --test-name-pattern='missing invites line' tests/verify/gate.cases.mjs >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: F20 ficou verde sem a linha invites medida' >&2
  exit 1
fi
if ! grep -qE '^not ok .*missing invites line makes otherwise green F20 fail' "$scratch/result.log" || ! grep -qE 'ERR_ASSERTION' "$scratch/result.log"; then
  cat "$scratch/result.log" >&2
  echo 'MUTANTE VIVO: falhou sem a asserção esperada' >&2
  exit 1
fi
echo 'mutants_killed=1/1 (f20-verify-invites-obrigatorio; asserção observada)'
