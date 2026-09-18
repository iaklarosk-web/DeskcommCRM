#!/usr/bin/env bash
# F14-T01 (ADR-039 §3), G-38: `webchat.enabled=false` (default declarado) tem
# de RECUSAR sessão antes de qualquer freio. A mutação ignora o desligado — toda
# organização passaria a ter chat público sem ter ligado; a unit "desligado
# recusa sessão" de tests/unit/f14-t01-webchat-sessao tem de ficar vermelha.
# Mutação em MEMÓRIA (tests/mutants/f13-unit-mutante.mjs).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f13-unit-mutante.mjs \
  --arquivo "src/webchat/sessao.ts" \
  --de '  if (!entrada.ligado) return "webchat_disabled";' \
  --para '  /* MUTANTE: desligado abre sessão */' \
  --suite "tests/unit/f14-t01-webchat-sessao.test.ts" \
  --titulo "desligado recusa sessão" \
  --espera "chat desligado abriu sessão" \
  --nome "f14-webchat-desligado-aceita-sessao"
