#!/usr/bin/env bash
# F12-T03, G-38 (G-57): a segunda entrega do MESMO evento não pode ativar de
# novo. A mutação troca o `on conflict do nothing` por um upsert que devolve a
# linha existente — o receptor passaria a tratar a duplicata como evento novo e
# a aplicaria outra vez. Tem de deixar "a segunda entrega do mesmo evento é
# duplicate: nada ativa de novo, um evento gravado, uma fatura paga" vermelho em
# tests/integration/f12-eventos-e-bloqueio.test.ts (caso AUTOCONTIDO: o `-t`
# do vitest roda só ele). Mutação em MEMÓRIA.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f04-turno-mutante.mjs \
  --arquivo "src/billing/assinatura.ts" \
  --de 'on conflict (gateway, event_ref) do nothing' \
  --para 'on conflict (gateway, event_ref) do update set received_at = now() /* MUTANTE: duplicata vira linha */' \
  --suite "tests/integration/f12-eventos-e-bloqueio.test.ts" \
  --titulo "a segunda entrega do mesmo evento é duplicate: nada ativa de novo, um evento gravado, uma fatura paga" \
  --espera "duplicate" \
  --nome "f12-evento-duplicado-aplica-de-novo"
