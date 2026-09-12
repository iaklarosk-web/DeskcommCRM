#!/usr/bin/env bash
# ADR-022, G-38: `ai_eval` é obrigatório a partir de F04 (§8.3). Apagar essa
# exigência devolve o campo ao estado decorativo — a fase fecharia verde sem
# nenhum caso de avaliação ter rodado. Tem de deixar a asserção nominal do gate
# VERMELHA.
# Sem banco, provedor, rede ou mutação do repositório: só uma cópia temporária.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/verify-ai-eval-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
node --input-type=module - "$scratch/report.mjs" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('scripts/verify/report.mjs', 'utf8');
const original = 'const requiresAiEval = (phase) => phaseNumber(phase) >= phaseNumber("F04");';
if (source.split(original).length - 1 !== 1) throw new Error('Mutant target missing');
writeFileSync(
  process.argv[2],
  source.replace(original, 'const requiresAiEval = () => false; // MUTANTE: ai_eval volta a ser decorativo'),
);
JS
cp scripts/verify/f02-e2e.mjs "$scratch/f02-e2e.mjs"
if VERIFY_GATE_MODULE="$scratch/report.mjs" node --test --test-name-pattern='missing ai_eval line' tests/verify/gate.cases.mjs >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: F04 ficou verde sem a linha ai_eval medida' >&2
  exit 1
fi
# `grep -qE`, não `rg`: ripgrep não é dependência deste repositório.
if ! grep -qE '^not ok .*missing ai_eval line makes otherwise green F04 fail' "$scratch/result.log" || ! grep -qE 'ERR_ASSERTION' "$scratch/result.log"; then
  cat "$scratch/result.log" >&2
  echo 'MUTANTE VIVO: falhou sem a asserção esperada' >&2
  exit 1
fi
echo 'mutants_killed=1/1 (f04-verify-ai-eval-obrigatorio; asserção observada)'
