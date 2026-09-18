#!/usr/bin/env bash
# F13-T01 (ADR-035 §4), G-38: o validador único de campos configuráveis tem de
# recusar campo `required` sem valor. A mutação faz `semValor` responder "tem
# valor" para tudo — um campo obrigatório vazio passaria a ser gravado; a unit
# "obrigatório sem valor é recusado" de tests/unit/f13-t01-campos-configuraveis
# tem de ficar vermelha. Mutação em MEMÓRIA (tests/mutants/f13-unit-mutante.mjs).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f13-unit-mutante.mjs \
  --arquivo "src/crm/campos/validar.ts" \
  --de 'return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);' \
  --para 'return false; /* MUTANTE: nada é "sem valor" */' \
  --suite "tests/unit/f13-t01-campos-configuraveis.test.ts" \
  --titulo "obrigatório sem valor é recusado" \
  --espera "required" \
  --nome "f13-campo-obrigatorio-ignorado"
