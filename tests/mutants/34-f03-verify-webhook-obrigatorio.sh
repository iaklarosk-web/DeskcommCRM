#!/usr/bin/env bash
# ADR-018, G-38: `webhook` é obrigatório a partir de F03 (§8.3). Apagar essa
# exigência devolve o campo ao estado decorativo que a ADR veio matar — e tem
# de deixar a asserção nominal do gate VERMELHA.
# Sem banco, provedor, rede ou mutação do repositório: só uma cópia temporária.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/verify-webhook-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
node --input-type=module - "$scratch/report.mjs" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('scripts/verify/report.mjs', 'utf8');
const original = 'const requiresWebhook = (phase) => phaseNumber(phase) >= phaseNumber("F03");';
if (source.split(original).length - 1 !== 1) throw new Error('Mutant target missing');
writeFileSync(
  process.argv[2],
  source.replace(original, 'const requiresWebhook = () => false; // MUTANT: webhook volta a ser decorativo'),
);
JS
cp scripts/verify/f02-e2e.mjs "$scratch/f02-e2e.mjs"
if VERIFY_GATE_MODULE="$scratch/report.mjs" node --test --test-name-pattern='missing webhook line' tests/verify/gate.cases.mjs >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: F03 ficou verde sem a linha webhook medida' >&2
  exit 1
fi
# `grep -qE`, não `rg`: ripgrep não é dependência deste repositório. Sob o
# shell que vendoriza rg o mutante passava; sob um shell sem ele, `rg` some,
# o `if !` vira verdadeiro e o mutante se declarava VIVO por ausência de
# ferramenta — um gate que só fecha numa máquina não é gate.
if ! grep -qE '^not ok .*missing webhook line makes otherwise green F03 fail' "$scratch/result.log" || ! grep -qE 'ERR_ASSERTION' "$scratch/result.log"; then
  cat "$scratch/result.log" >&2
  echo 'MUTANTE VIVO: falhou sem a asserção esperada' >&2
  exit 1
fi
echo 'mutants_killed=1/1 (f03-verify-webhook-obrigatorio; asserção observada)'
