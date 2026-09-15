#!/usr/bin/env bash
# F13-T03 (ADR-035 §4), G-38: a fila de oportunidades distribui por RODÍZIO.
# A mutação faz a distribuição escolher sempre o primeiro elegível (a fila
# inteira cai numa pessoa só); a unit "rodízio equilibra" de
# tests/unit/f13-t03-fila-de-oportunidades tem de ficar vermelha com
# `balanced=0`. Mutação em MEMÓRIA (tests/mutants/f13-unit-mutante.mjs).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f13-unit-mutante.mjs \
  --arquivo "src/crm/oportunidades/distribuicao.ts" \
  --de 'const escolhido = selectRoundRobin(estado);' \
  --para 'const escolhido = estado[0]?.userId ?? null; /* MUTANTE: sempre o primeiro */' \
  --suite "tests/unit/f13-t03-fila-de-oportunidades.test.ts" \
  --titulo "rodízio equilibra" \
  --espera "balanced=0" \
  --nome "f13-rodizio-sempre-o-primeiro"
