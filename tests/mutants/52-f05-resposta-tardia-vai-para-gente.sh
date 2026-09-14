#!/usr/bin/env bash
# F05-T08, G-38: resposta ao lembrete DEPOIS do corte vai para gente, sem
# tocar no pedido e sem chamar o provedor (§7.6 T08: "resposta após fechamento
# da produção segue exceção/avaliação humana configurada, sem assumir a
# entrega automaticamente").
#
# ─── O que este mutante sabota ───────────────────────────────────────────────
#
# A regra é um `if (contexto.lembrete?.replied_late === true)` entre o contexto
# e o provedor. A mutação a desliga (`=== "nunca"`): o turno passa a tratar a
# resposta tardia como qualquer outra — chama o modelo, o modelo lê o LEMBRETE
# e pede `update_order_quantity`, e a entrega passa a ser assumida por quem não
# devia decidir isso. Nenhum erro, nenhuma tela: só um pedido alterado fora do
# prazo. Tem de deixar `provider_calls=0` e `handoff=tenant_rule` vermelhos.
#
# Mecânica: mutação em MEMÓRIA, suíte de INTEGRAÇÃO com Postgres efêmero. O
# caso S3 monta o próprio cenário (o beforeAll do arquivo dispara o lembrete).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

exec node tests/mutants/f04-turno-mutante.mjs \
  --arquivo "src/ai/turno.ts" \
  --de 'if (contexto.lembrete?.replied_late === true) {' \
  --para 'if ((contexto.lembrete?.replied_late as unknown) === "nunca") {' \
  --suite "tests/integration/f05-lembrete-resposta.test.ts" \
  --titulo "S3: resposta DEPOIS do corte → handoff tenant_rule sem chamar o provedor; o pedido não muda" \
  --espera "o turno gastou token numa resposta que a regra manda para gente" \
  --nome "f05-resposta-tardia-vai-para-gente"
