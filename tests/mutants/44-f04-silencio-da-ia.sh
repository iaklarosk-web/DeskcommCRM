#!/usr/bin/env bash
# F04-T05, G-38: a guarda de SILÊNCIO do turno (§5.8 invariante 3, D19,
# AGENTS.md regra 19). Conversa fora de `ESTADOS_EM_QUE_A_IA_FALA` encerra o
# turno antes de qualquer leitura de contexto e sem uma palavra com o provedor.
#
# Tirar a guarda é a mudança mais inocente que existe: o turno continua
# funcionando, o cliente continua recebendo resposta, nenhuma tela muda. A única
# consequência é a IA respondendo POR CIMA do atendente que assumiu a conversa —
# e gastando token nela. Este mutante existe para que isso fique VERMELHO.
#
# Mecânica: mutação em MEMÓRIA (plugin de transform, como
# 33-f03-adapter-allowlist.sh) sobre a suíte de INTEGRAÇÃO, que precisa do
# Postgres efêmero (como 42-f04-acervo-filtro-de-organizacao.sh). Nenhum arquivo
# do repositório é tocado.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

exec node tests/mutants/f04-turno-mutante.mjs \
  --arquivo "src/ai/turno.ts" \
  --de 'if (!iaPodeFalar(conversa.estado)) return silenciar("estado_nao_e_da_ia", conversa.estado);' \
  --para 'if (false && !iaPodeFalar(conversa.estado)) return silenciar("estado_nao_e_da_ia", conversa.estado);' \
  --suite "tests/integration/f04-t09-erro-do-provedor.test.ts" \
  --titulo "em waiting_human a IA não fala: turno silenciado, sem gastar e sem enviar" \
  --espera "a IA respondeu numa conversa em waiting_human" \
  --nome "f04-silencio-da-ia"
