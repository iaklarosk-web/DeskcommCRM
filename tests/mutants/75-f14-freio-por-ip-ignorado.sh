#!/usr/bin/env bash
# F14-T01 (ADR-039 §3; ADR-038 §6 objeção 2), G-38: o freio por IP é o que
# separa "endpoint público com IA 24 h" de "torneira aberta". A mutação faz o
# freio por sessões do IP nunca bater; a unit "freio por ip bate" de
# tests/unit/f14-t01-webchat-freios tem de ficar vermelha. Mutação em MEMÓRIA.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f13-unit-mutante.mjs \
  --arquivo "src/webchat/freios.ts" \
  --de '  if (contagens.sessoes_do_ip_na_hora >= limites.sessoes_por_ip_hora) return "ip_sessions";' \
  --para '  /* MUTANTE: freio por IP desligado */' \
  --suite "tests/unit/f14-t01-webchat-freios.test.ts" \
  --titulo "freio por ip bate" \
  --espera "30 sessões na hora do mesmo IP passaram" \
  --nome "f14-freio-por-ip-ignorado"
