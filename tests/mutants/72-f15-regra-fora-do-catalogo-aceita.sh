#!/usr/bin/env bash
# F15-T04 (ADR-037 §3), G-38: uma regra só pode ter ações do catálogo (D17,
# "nenhum side effect fora dele"). A mutação faz o validador aceitar qualquer
# `actions[].type` — `call_webhook`, `send_whatsapp_message`… voltariam a ser
# gravados pela rota; a unit "ação fora do catálogo é recusada" de
# tests/unit/f15-t04-regras-sobre-o-catalogo tem de ficar vermelha. Mutação em
# MEMÓRIA (tests/mutants/f13-unit-mutante.mjs).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f13-unit-mutante.mjs \
  --arquivo "src/automation/regras.ts" \
  --de '    if (!ehAcaoDeRegra(tipo)) return `ação ${i + 1} fora do catálogo: ${String(tipo)}`;' \
  --para '    if (!ehAcaoDeRegra(tipo)) continue; /* MUTANTE: qualquer tipo passa */' \
  --suite "tests/unit/f15-t04-regras-sobre-o-catalogo.test.ts" \
  --titulo "ação fora do catálogo é recusada" \
  --espera "fora do catálogo" \
  --nome "f15-regra-fora-do-catalogo-aceita"
