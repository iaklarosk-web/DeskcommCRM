#!/usr/bin/env bash
# F19-T02 (ADR-043 §3), G-38: evento `live` numa instalação `test` (e vice-versa)
# é 422 sem gravar. A mutação desliga a comparação de `livemode` no receptor; o
# caso de integração "evento live numa instalação test → 422 livemode_mismatch"
# tem de ficar vermelho. Mutação em MEMÓRIA, com o Postgres efêmero.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f04-turno-mutante.mjs \
  --arquivo "src/billing/webhook-stripe.ts" \
  --de '  if (evento.livemode !== (cfg.modo === "live")) { // MUTANT: stripe-livemode' \
  --para '  if (false) { /* MUTANTE: livemode ignorado */' \
  --suite "tests/integration/f19-cobranca-stripe.test.ts" \
  --titulo "livemode: evento live numa instalação test é 422 e não grava" \
  --espera "evento live entrou numa instalação test" \
  --nome "f19-webhook-ignora-livemode"
