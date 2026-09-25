#!/usr/bin/env bash
# F19-T02 (ADR-043 §3), G-38: o webhook do Stripe só entra com HMAC que confere.
# A mutação faz a comparação em tempo constante devolver `true` para qualquer
# v1; a unit "assinatura válida dentro da tolerância confere; v1 errado, t
# vencido e segredo vazio não conferem" tem de ficar vermelha. Mutação em MEMÓRIA.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f13-unit-mutante.mjs \
  --arquivo "src/billing/gateway/stripe.ts" \
  --de "    return recebido.length === esperado.length && timingSafeEqual(recebido, esperado); // MUTANT: stripe-assinatura" \
  --para "    return true; /* MUTANTE: qualquer v1 confere */" \
  --suite "tests/unit/f19-t02-stripe-adapter.test.ts" \
  --titulo "assinatura válida dentro da tolerância confere; v1 errado, t vencido e segredo vazio não conferem" \
  --espera "assinatura de outro segredo conferiu" \
  --nome "f19-webhook-aceita-assinatura-invalida"
