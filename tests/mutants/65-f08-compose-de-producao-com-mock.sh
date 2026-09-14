#!/usr/bin/env bash
# F08-T01, G-38: a régua do compose de PRODUÇÃO precisa estar viva.
#
# ─── O que este mutante sabota ───────────────────────────────────────────────
#
# Um compose de produção com `AI_PROVIDER: mock` no app entrega resposta de
# brinquedo ao cliente achando que é a IA (src/ai/provedor.ts: "o pior tipo de
# silêncio"). A régua `tests/unit/f08-t01-compose-de-producao.test.ts` lê o
# arquivo e cobra `anthropic` em app e workers e a ausência de dublês. A mutação
# troca o provedor do app numa CÓPIA do compose (F08_COMPOSE_PROD aponta o
# teste para ela); nenhum arquivo do repositório é tocado.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/f08-compose-mock.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

if [ "$(grep -c '^      AI_PROVIDER: anthropic$' compose.prod.yml)" != 4 ]; then
  echo 'alvo do mutante mudou: AI_PROVIDER: anthropic deveria aparecer 4 vezes em compose.prod.yml' >&2
  exit 1
fi
# só a PRIMEIRA ocorrência (o app): um mock basta para reprovar.
sed '0,/^      AI_PROVIDER: anthropic$/s//      AI_PROVIDER: mock/' compose.prod.yml > "$scratch/compose.prod.yml"
[ "$(grep -c '^      AI_PROVIDER: mock$' "$scratch/compose.prod.yml")" = 1 ]

if F08_COMPOSE_PROD="$scratch/compose.prod.yml" \
   node node_modules/vitest/vitest.mjs run tests/unit/f08-t01-compose-de-producao.test.ts \
     -t "provedores REAIS" --maxWorkers=1 --allowOnly=false \
     --reporter=json --outputFile "$scratch/result.json" >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: compose de produção com AI_PROVIDER=mock passou na régua de F08-T01' >&2
  exit 1
fi
if ! grep -q '"status":"failed"' "$scratch/result.json" || ! grep -q 'provedores REAIS' "$scratch/result.json"; then
  cat "$scratch/result.log" >&2
  echo 'MUTANTE VIVO: falhou sem a asserção esperada' >&2
  exit 1
fi
echo 'mutants_killed=1/1 (f08-compose-de-producao-com-mock; asserção observada)'
