#!/usr/bin/env bash
# ADR-024, G-38: `handoff` e `reminder` são obrigatórios a partir de F05 (§8.3).
# Apagar a exigência devolve os dois campos ao estado decorativo — a fase
# fecharia verde sem nenhum handoff ter acontecido e sem o lembrete ter rodado
# duas vezes no mesmo período. Tem de deixar a asserção nominal VERMELHA.
# Sem banco, provedor, rede ou mutação do repositório: só uma cópia temporária.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/verify-handoff-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
node --input-type=module - "$scratch/report.mjs" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('scripts/verify/report.mjs', 'utf8');
const original = 'const requiresHandoff = (phase) => phaseNumber(phase) >= phaseNumber("F05");';
if (source.split(original).length - 1 !== 1) throw new Error('Mutant target missing');
writeFileSync(
  process.argv[2],
  source.replace(original, 'const requiresHandoff = () => false; // MUTANTE: handoff/reminder decorativos'),
);
JS
cp scripts/verify/f02-e2e.mjs "$scratch/f02-e2e.mjs"
if VERIFY_GATE_MODULE="$scratch/report.mjs" node --test --test-name-pattern='missing handoff or reminder line' tests/verify/gate.cases.mjs >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: F05 ficou verde sem handoff/reminder medidos' >&2
  exit 1
fi
# `grep -qE`, não `rg`: ripgrep não é dependência deste repositório.
if ! grep -qE '^not ok .*missing handoff or reminder line makes otherwise green F05 fail' "$scratch/result.log" || ! grep -qE 'ERR_ASSERTION' "$scratch/result.log"; then
  cat "$scratch/result.log" >&2
  echo 'MUTANTE VIVO: falhou sem a asserção esperada' >&2
  exit 1
fi
echo 'mutants_killed=1/1 (f05-verify-handoff-obrigatorio; asserção observada)'
