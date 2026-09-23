#!/usr/bin/env bash
# F19-T00 (ADR-042 §1; VARREDURA §B23 b), G-38: `claude-sonnet-5` — o modelo
# padrão da organização — tem de ter preço na tabela do motor. A mutação apaga
# a linha dele (volta ao estado que gravava custo ZERO em produção); a unit
# "claude-sonnet-5 é cotado a 2/10 USD por milhão — nunca zero" tem de ficar
# vermelha. Mutação em MEMÓRIA.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f13-unit-mutante.mjs \
  --arquivo "lib/agent-engine/edge/llm/pricing.ts" \
  --de "  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite1h: 4 }, // MUTANT: preco-sonnet-5" \
  --para "  /* MUTANTE: sonnet-5 sem preço — custo zero de novo */" \
  --suite "tests/unit/f19-t00-preco-da-geracao-5.test.ts" \
  --titulo "claude-sonnet-5 é cotado a 2/10 USD por milhão — nunca zero" \
  --espera "expected 0 to be greater than 0" \
  --nome "f19-sonnet-5-sem-preco"
