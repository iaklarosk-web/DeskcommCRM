#!/usr/bin/env bash
# F06 (ADR-028), G-38: as três métricas do hardening são OBRIGATÓRIAS a partir
# de F06 — `logs`, `rate-limit` e `lgpd`. A mutação desliga `requiresHardening`
# no `report.mjs`: sem as linhas o gate continuaria verde, e é isso que o caso
# "missing logs, rate-limit or lgpd line makes otherwise green F06 fail" tem de
# pegar. Mesma mecânica do mutante 48 (v1.3).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/verify-hardening-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
node --input-type=module - "$scratch/report.mjs" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('scripts/verify/report.mjs', 'utf8');
const original = 'const requiresHardening = (phase) => phaseNumber(phase) >= phaseNumber("F06");';
if (source.split(original).length - 1 !== 1) throw new Error('Mutant target missing');
writeFileSync(
  process.argv[2],
  source.replace(original, 'const requiresHardening = () => false; // MUTANTE: logs/rate-limit/lgpd decorativos'),
);
JS
cp scripts/verify/f02-e2e.mjs "$scratch/f02-e2e.mjs"
if VERIFY_GATE_MODULE="$scratch/report.mjs" node --test --test-name-pattern='missing logs, rate-limit or lgpd line' tests/verify/gate.cases.mjs >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: F06 ficou verde sem logs/rate-limit/lgpd medidos' >&2
  exit 1
fi
# `grep -qE`, não `rg`: ripgrep não é dependência deste repositório.
if ! grep -qE '^not ok .*missing logs, rate-limit or lgpd line makes otherwise green F06 fail' "$scratch/result.log" || ! grep -qE 'ERR_ASSERTION' "$scratch/result.log"; then
  cat "$scratch/result.log" >&2
  echo 'MUTANTE VIVO: falhou sem a asserção esperada' >&2
  exit 1
fi
echo 'mutants_killed=1/1 (f06-verify-hardening-obrigatorio; asserção observada)'
