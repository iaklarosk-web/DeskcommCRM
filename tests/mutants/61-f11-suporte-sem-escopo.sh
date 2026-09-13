#!/usr/bin/env bash
# F11-T02, G-38: o acompanhamento tem ESCOPO (ADR-030 §4). A mutação faz
# `rotaNoEscopo` responder sim para tudo — um acompanhamento de `inbox`
# passaria a ler equipe, configurações e cobrança sem ninguém ver. Tem de
# deixar "escopo: rota fora do escopo é negada" vermelho em
# tests/integration/f11-entrada-e-suporte.test.ts. Mutação em MEMÓRIA.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tests/mutants/f04-turno-mutante.mjs \
  --arquivo "lib/impersonate/support.ts" \
  --de 'if (scope === "all" || caminho === null) return true;' \
  --para 'return true; /* MUTANTE: todo escopo alcança tudo */ if (scope === "all" || caminho === null) return true;' \
  --suite "tests/integration/f11-entrada-e-suporte.test.ts" \
  --titulo "escopo: rota fora do escopo é negada por rotaNoEscopo, a função do guarda; all alcança tudo; sair e auth ficam sempre abertos" \
  --espera "inbox" \
  --nome "f11-suporte-sem-escopo"
