#!/usr/bin/env bash
# F07 (ADR-029), G-38: `replicability` é OBRIGATÓRIA a partir de F07 — as duas
# execuções do navegador (deka, demo2) com src_diff_lines=0. A mutação desliga
# `requiresReplicability` no `report.mjs`: sem a evidência o gate continuaria
# verde e imprimiria o rótulo sem a medida, e é isso que o caso "missing
# replicability evidence makes otherwise green F07 fail" tem de pegar. Mesma
# mecânica dos mutantes 48 (v1.3) e 57 (v1.4).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/verify-replicability-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
node --input-type=module - "$scratch/report.mjs" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('scripts/verify/report.mjs', 'utf8');
const original = 'const requiresReplicability = (phase) => phaseNumber(phase) >= phaseNumber("F07"); // MUTANT: replicability-required';
if (source.split(original).length - 1 !== 1) throw new Error('Mutant target missing');
writeFileSync(
  process.argv[2],
  source.replace(original, 'const requiresReplicability = () => false; // MUTANTE: replicabilidade decorativa'),
);
JS
cp scripts/verify/f02-e2e.mjs "$scratch/f02-e2e.mjs"
if VERIFY_GATE_MODULE="$scratch/report.mjs" node --test --test-name-pattern='missing replicability evidence' tests/verify/gate.cases.mjs >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: F07 ficou verde sem as duas execuções por tenant' >&2
  exit 1
fi
# `grep -qE`, não `rg`: ripgrep não é dependência deste repositório.
if ! grep -qE '^not ok .*missing replicability evidence makes otherwise green F07 fail' "$scratch/result.log" || ! grep -qE 'ERR_ASSERTION' "$scratch/result.log"; then
  cat "$scratch/result.log" >&2
  echo 'MUTANTE VIVO: falhou sem a asserção esperada' >&2
  exit 1
fi
echo 'mutants_killed=1/1 (f07-verify-replicabilidade-obrigatoria; asserção observada)'
