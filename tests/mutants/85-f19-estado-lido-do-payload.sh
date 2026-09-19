#!/usr/bin/env bash
# F19-T02 (ADR-042 §2 regra 4; ADR-043 §3), G-38: o ESTADO da assinatura vem do
# provedor (`GET /v1/subscriptions`), nunca do payload do webhook. A mutação
# faz o receptor confiar no `status` do payload; o caso de integração
# "customer.subscription.updated: o payload diz active, o provedor diz
# past_due — o CRM grava past_due" tem de ficar vermelho. Mutação em MEMÓRIA.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f04-turno-mutante.mjs \
  --arquivo "src/billing/webhook-stripe.ts" \
  --de '      noProvedor = await buscarAssinatura(cfg.cliente, alvo.subscription_id!); // MUTANT: stripe-estado-do-provedor' \
  --para '      noProvedor = { ...(await buscarAssinatura(cfg.cliente, alvo.subscription_id!)), status: String(evento.objeto.status) }; /* MUTANTE: estado do payload */' \
  --suite "tests/integration/f19-cobranca-stripe.test.ts" \
  --titulo "estado do provedor: o payload diz active, o provedor diz past_due, o CRM grava past_due" \
  --espera "o estado veio do payload, não do provedor" \
  --nome "f19-estado-lido-do-payload"
