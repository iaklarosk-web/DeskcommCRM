#!/usr/bin/env bash
# F19-T06 (ADR-044 §3; D58 b), G-38: com os três planos `owner` no banco, o
# provisionamento tem de levar ao Stripe o nome e o preço REAIS. A mutação faz
# `planosAProvisionar` devolver sempre os placeholders (R$ 10/20/30 —
# cobraria R$ 10 LIVE de quem escolheu o Essencial); a unit "planos do dono
# viram os Products com nome e preço reais — nunca placeholder" tem de ficar
# vermelha. Mutação em MEMÓRIA.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f13-unit-mutante.mjs \
  --arquivo "src/billing/provisionar.ts" \
  --de "    if (linha === null || linha.source !== \"owner\" || !linha.active || !(linha.price_cents > 0)) {" \
  --para "    if (true) { /* MUTANTE: ignora o dono, cobra placeholder */" \
  --suite "tests/unit/f19-t06-planos-do-dono-no-provisionamento.test.ts" \
  --titulo "planos do dono viram os Products com nome e preço reais — nunca placeholder" \
  --espera "expected 'placeholder' to be 'owner'" \
  --nome "f19-provision-ignora-o-dono"
