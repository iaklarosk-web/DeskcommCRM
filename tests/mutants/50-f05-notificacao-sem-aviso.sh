#!/usr/bin/env bash
# F05-T05, G-38: o aviso POR USUÁRIO de §5.16 ("in-app SEMPRE; +1 por
# destinatário").
#
# ─── O que este mutante sabota ───────────────────────────────────────────────
#
# `notify()` grava uma linha em `notifications` por destinatário distinto. A
# mutação pula o PRIMEIRO da lista (`destinatarios.slice(1)`): com um destinatário
# só — que é como cinco dos seis eventos são chamados na vida real (a tarefa tem
# UM assignee, a conversa assumida tem UM dono) — ninguém é avisado, `count`
# volta 0 e nenhuma exceção sobe. É a forma provável de a regra morrer: um
# "ajuste" no laço, sem erro, sem tela mudando, e o handoff de um cliente
# ficando em silêncio para a pessoa que o assumiria.
#
# Tem de deixar `rows=6/6` vermelho na prova de F05-T05.
#
# Mecânica: mutação em MEMÓRIA (plugin de transform), sobre a suíte de
# INTEGRAÇÃO, que precisa do Postgres efêmero. Nenhum arquivo do repositório é
# tocado. O caso alvo é o primeiro do arquivo e não depende de nenhum outro.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

exec node tests/mutants/f04-turno-mutante.mjs \
  --arquivo "src/notifications/notify.ts" \
  --de 'for (const userId of destinatarios) {' \
  --para 'for (const userId of destinatarios.slice(1)) {' \
  --suite "tests/integration/f05-notificacoes.test.ts" \
  --titulo "notifications: events=6 rows=6/6 email_outbox=6/6" \
  --espera "não gravou o aviso" \
  --nome "f05-notificacao-sem-aviso"
