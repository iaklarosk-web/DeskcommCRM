#!/usr/bin/env bash
# F12-T06, G-38 (D44): a assinatura BLOQUEADA por atraso lê mas não escreve. A
# mutação faz `blocked` valer `full` na tabela estado → acesso: o guarda de rota,
# o layout e o entitlement deixariam a organização inadimplente operar. Tem de
# deixar "bloqueada por atraso é read_only: escrita negada, leitura e cobrança
# permitidas, capability negada sem provedor" vermelho em
# tests/integration/f12-eventos-e-bloqueio.test.ts (caso AUTOCONTIDO: o `-t`
# do vitest roda só ele). Mutação em MEMÓRIA.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f04-turno-mutante.mjs \
  --arquivo "src/billing/estados.ts" \
  --de '  blocked: "read_only",' \
  --para '  blocked: "full", /* MUTANTE: inadimplente opera */' \
  --suite "tests/integration/f12-eventos-e-bloqueio.test.ts" \
  --titulo "bloqueada por atraso é read_only: escrita negada, leitura e cobrança permitidas, capability negada sem provedor" \
  --espera "read_only" \
  --nome "f12-bloqueada-escreve"
