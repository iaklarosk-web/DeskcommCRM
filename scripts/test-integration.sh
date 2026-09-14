#!/usr/bin/env bash
# test:integration (F01-T02) — testes de API/worker COM banco (tests/integration/**).
#
# Reusa scripts/test-db.sh inteiro: mesmo Postgres efêmero com o baseline
# aplicado (install + update, prova de idempotência), banco novo por arquivo,
# detector de árvore viva. Só trocam a pasta da suíte e a config do vitest —
# duplicar as ~370 linhas daquela máquina seria a segunda fila do agent-engine
# de novo. Argumentos extras vão ao vitest (ex.: -t tenant-context).
set -euo pipefail
cd "$(dirname "$0")/.."
TEST_DB_SUITE_DIR="$PWD/tests/integration" \
TEST_DB_VITEST_CONFIG="vitest.integration.config.ts" \
  exec bash scripts/test-db.sh "$@"
