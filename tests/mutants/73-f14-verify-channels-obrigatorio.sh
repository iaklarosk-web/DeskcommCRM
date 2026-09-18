#!/usr/bin/env bash
# F14 (ADR-039), G-38: a linha `channels` é OBRIGATÓRIA a partir de F14. A
# mutação desliga `requiresChannels` no `report.mjs`; o caso "missing channels
# line makes otherwise green F14 fail" tem de ficar vermelho.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/verify-channels-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
node --input-type=module - "$scratch/report.mjs" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('scripts/verify/report.mjs', 'utf8');
const original = 'const requiresChannels = (phase) => closesAtOrAfter(phase, "F14"); // MUTANT: channels-required';
if (source.split(original).length - 1 !== 1) throw new Error('Mutant target missing');
writeFileSync(process.argv[2], source.replace(original, 'const requiresChannels = () => false; // MUTANTE: channels decorativo'));
JS
cp scripts/verify/f02-e2e.mjs "$scratch/f02-e2e.mjs"
if VERIFY_GATE_MODULE="$scratch/report.mjs" node --test --test-name-pattern='missing channels line' tests/verify/gate.cases.mjs >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: F14 ficou verde sem a linha channels medida' >&2
  exit 1
fi
if ! grep -qE '^not ok .*missing channels line makes otherwise green F14 fail' "$scratch/result.log" || ! grep -qE 'ERR_ASSERTION' "$scratch/result.log"; then
  cat "$scratch/result.log" >&2
  echo 'MUTANTE VIVO: falhou sem a asserção esperada' >&2
  exit 1
fi
echo 'mutants_killed=1/1 (f14-verify-channels-obrigatorio; asserção observada)'
