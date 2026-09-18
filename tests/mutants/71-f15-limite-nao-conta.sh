#!/usr/bin/env bash
# F15-T02 (ADR-037 §3), G-38: o limite diário tem de CONTAR os turnos do dia.
# A mutação faz `turnosDoDia` devolver sempre 0 — nenhuma organização bateria
# o teto e o provedor seria chamado depois do limite; a unit "ao bater o limite
# não chama o provedor" de tests/unit/f15-t02-limite-diario tem de ficar
# vermelha. Mutação em MEMÓRIA (tests/mutants/f13-unit-mutante.mjs).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f13-unit-mutante.mjs \
  --arquivo "src/ai/limite.ts" \
  --de '  return Number(rows[0]?.n ?? 0);' \
  --para '  void rows; return 0; /* MUTANTE: o dia nunca tem turno */' \
  --suite "tests/unit/f15-t02-limite-diario.test.ts" \
  --titulo "ao bater o limite não chama o provedor" \
  --espera "daily_limit_reached" \
  --nome "f15-limite-nao-conta"
