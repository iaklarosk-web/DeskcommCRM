#!/usr/bin/env bash
# F05-T04, G-38: a guarda pós-handoff (§5.11, §7.6, AGENTS.md regra 19 —
# `ai_messages_after_handoff = 0` verificado).
#
# ─── O que este mutante sabota, e por que NÃO é o mesmo do 44 ────────────────
#
# O mutante 44 apaga a GUARDA (`if (!iaPodeFalar(...)) return silenciar(...)`).
# Este apaga a DERIVAÇÃO dela: `ESTADOS_EM_QUE_A_IA_FALA` sai da tabela D16 pelo
# evento `ai.reply_sent`, e a mutação alarga o filtro para incluir também
# `waiting_human` e `human_handling`. A guarda continua lá, continua rodando e
# continua devolvendo `true` — só que agora para os dois estados em que a
# conversa já é de uma pessoa.
#
# É a forma mais provável de esta regra morrer na vida real: ninguém apaga um
# `if`; alguém "conserta" a lista de estados ao acrescentar um estado novo. O
# turno continua respondendo, o cliente continua recebendo texto, nenhuma tela
# muda — e a IA passa a falar por cima do atendente que assumiu a conversa,
# gastando token nela.
#
# Tem de deixar `ai_msgs_after_handoff >= 1` e a asserção NOMINAL vermelha.
#
# Mecânica: mutação em MEMÓRIA (plugin de transform), sobre a suíte de
# INTEGRAÇÃO, que precisa do Postgres efêmero. Nenhum arquivo do repositório é
# tocado. O caso alvo monta o próprio cenário (handoff + claim + mensagem
# humana), então roda sozinho com `-t` e fica vermelho pela guarda — não por
# falta de cenário.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

exec node tests/mutants/f04-turno-mutante.mjs \
  --arquivo "src/ai/guardrails.ts" \
  --de '(linha) => linha.event === "ai.reply_sent" && linha.actor.includes("ai"),' \
  --para '(linha) => linha.event === "ai.reply_sent" || linha.from === "human_handling" || linha.from === "waiting_human",' \
  --suite "tests/integration/f05-handoff.test.ts" \
  --titulo "handoff: ai_msgs_after_handoff=0 com handoffs=H e msgs_after=Mh acima de zero" \
  --espera "a IA escreveu numa conversa que já é de uma pessoa (AGENTS.md 19)" \
  --nome "f05-silencio-depois-do-handoff"
