#!/usr/bin/env bash
# F05-T06/T10, G-38: a idempotência do lembrete por `(tenant, customer, período)`
# (§5.12 invariante 1, D23; §7.6 T10: "sem chave do lembrete → duplicates=1").
#
# ─── O que este mutante sabota ───────────────────────────────────────────────
#
# `enviarParaCliente` consulta o claim do período ANTES de enviar: linha já
# `sent` = duplicata evitada. A mutação faz a linha já enviada ser tratada como
# se nunca tivesse saído — o índice único continua no banco (o insert é
# recusado como sempre), mas o CÓDIGO ignora a resposta do índice e envia de
# novo. É a forma provável de a regra morrer: ninguém apaga um índice; alguém
# "simplifica" o desvio que o lê.
#
# Tem de deixar `duplicates=1` (a segunda execução grava uma segunda mensagem)
# e a asserção nominal `reminder: runs=2 sent=1 duplicates=0` vermelha.
#
# Mecânica: mutação em MEMÓRIA, sobre a suíte de INTEGRAÇÃO com Postgres
# efêmero. O caso alvo depende do primeiro caso do arquivo (a primeira
# execução); o `-t` do vitest é REGEX e o título não tem metacaractere.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

exec node tests/mutants/f04-turno-mutante.mjs \
  --arquivo "src/reminder/envio.ts" \
  --de 'if (claim.estado === "sent" || claim.estado === "skipped") {' \
  --para 'if (claim.estado === "skipped") {' \
  --suite "tests/integration/f05-lembrete.test.ts" \
  --titulo "reminder: runs=2 sent=1 duplicates=0" \
  --espera "a segunda execução do mesmo período gravou de novo" \
  --nome "f05-lembrete-sem-chave-de-periodo"
