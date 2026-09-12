#!/usr/bin/env bash
# ADR-007: deleting the required-metric refusal must fail its named assertion.
# No DB, provider, network or repository mutation: only a temporary module copy.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/verify-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
node --input-type=module - "$scratch/report.mjs" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('scripts/verify/report.mjs', 'utf8');
const original = 'errors.push(`Métrica obrigatória ausente: ${name}`); // MUTANT: required-metric';
if (!source.includes(original)) throw new Error('Mutant target missing');
writeFileSync(process.argv[2], source.replace(original, '// MUTANT: missing metric is accepted'));
JS
cp scripts/verify/f02-e2e.mjs "$scratch/f02-e2e.mjs"
if VERIFY_GATE_MODULE="$scratch/report.mjs" node --test --test-name-pattern='missing mandatory metric' tests/verify/gate.cases.mjs >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: métrica ausente deixou o gate verde' >&2
  exit 1
fi
# `grep -qE`, não `rg`: ripgrep não é dependência deste repositório. Sob o
# shell que vendoriza rg o mutante passava; sob um shell sem ele, `rg` some,
# o `if !` vira verdadeiro e o mutante se declarava VIVO por ausência de
# ferramenta — um gate que só fecha numa máquina não é gate.
if ! grep -qE '^not ok .*missing mandatory metric makes otherwise green F01 fail' "$scratch/result.log" || ! grep -qE 'ERR_ASSERTION' "$scratch/result.log"; then
  cat "$scratch/result.log" >&2
  echo 'MUTANTE VIVO: falhou sem a asserção esperada' >&2
  exit 1
fi
echo 'mutants_killed=1/1 (verify-metrica-ausente; asserção observada)'
