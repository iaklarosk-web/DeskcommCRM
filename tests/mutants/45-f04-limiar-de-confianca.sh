#!/usr/bin/env bash
# F04-T05, G-38: o LIMIAR DE CONFIANÇA de §5.9/D19. `confidence` abaixo de
# `tenant_settings.ai.confidence_threshold` é gatilho de handoff `low_confidence`
# — e o limiar é do TENANT, não uma constante do código.
#
# Sabotar a comparação não quebra nada visível: o agente continua respondendo, e
# respondendo MAIS (toda resposta insegura passa a ir para o cliente). O defeito
# aparece na conversa de quem recebeu um palpite, não em teste nenhum — a menos
# que exista este. Ele existe.
#
# Mecânica: mutação em memória sobre a suíte de integração (ver
# tests/mutants/f04-turno-mutante.mjs). Nenhum arquivo do repositório é tocado.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

exec node tests/mutants/f04-turno-mutante.mjs \
  --arquivo "src/ai/guardrails.ts" \
  --de 'return confidence < limiar;' \
  --para 'return false;' \
  --suite "tests/integration/f04-t05-guardrails.test.ts" \
  --titulo "a mesma confiança 0,3 chama humano no tenant de 0,6 e responde no de 0,2" \
  --espera "resposta de baixa confiança não virou handoff no tenant de limiar 0,6" \
  --nome "f04-limiar-de-confianca"
