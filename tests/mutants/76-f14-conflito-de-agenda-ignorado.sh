#!/usr/bin/env bash
# F14-T03 (ADR-039 §3), G-38: dois compromissos vivos do mesmo responsável não
# se sobrepõem — "disponibilidade e conflitos" (§7.9). A mutação faz o
# detector nunca achar conflito; a unit "conflito recusa" de
# tests/unit/f14-t03-agenda-conflito tem de ficar vermelha. Mutação em MEMÓRIA.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f13-unit-mutante.mjs \
  --arquivo "src/agenda/marcar.ts" \
  --de '    if (inicio.getTime() < cf && fim.getTime() > ci) return c;' \
  --para '    /* MUTANTE: nunca há conflito */' \
  --suite "tests/unit/f14-t03-agenda-conflito.test.ts" \
  --titulo "conflito recusa" \
  --espera "sobreposição passou" \
  --nome "f14-conflito-de-agenda-ignorado"
