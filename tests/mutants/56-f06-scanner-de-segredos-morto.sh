#!/usr/bin/env bash
# F06-T04, G-38: o scanner de segredos que o CI roda PRECISA estar vivo.
#
# ─── O que este mutante sabota ───────────────────────────────────────────────
#
# Um scanner com o padrão quebrado devolve `findings=0` para tudo — e um CI que
# lê só esse zero aprovaria um PR com a chave colada. O que separa "nada
# encontrado" de "nada procurado" é a fixture negativa (G-51): o script sai 1
# quando não a pega. A mutação troca o padrão por um que não casa nada; a
# prova de F06-T04 (que executa o script de verdade) tem de ficar vermelha.
#
# Mecânica: cópia sabotada do script num scratch, apontada pela variável
# `F06_SCAN_SECRETS_SCRIPT` que só o teste lê. Nenhum arquivo do repositório é
# tocado.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/f06-scanner-morto.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

if [ "$(grep -c "^PADRAO='" scripts/scan-secrets.sh)" != 1 ]; then
  echo 'alvo do mutante mudou: PADRAO= não é único em scripts/scan-secrets.sh' >&2
  exit 1
fi
sed "s/^PADRAO='.*'$/PADRAO='padrao-mutante-que-nao-casa-nada'/" scripts/scan-secrets.sh > "$scratch/scan-secrets.sh"
grep -q "padrao-mutante-que-nao-casa-nada" "$scratch/scan-secrets.sh"

if F06_SCAN_SECRETS_SCRIPT="$scratch/scan-secrets.sh" \
   node node_modules/vitest/vitest.mjs run tests/unit/f06-t04-t08-ci-segredos-e-verify.test.ts \
     -t "a varredura de verdade" --maxWorkers=1 --allowOnly=false \
     --reporter=json --outputFile "$scratch/result.json" >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: o scanner com padrão morto passou na prova de F06-T04' >&2
  exit 1
fi
if ! grep -q "a fixture negativa" "$scratch/result.json" || ! grep -q '"status":"failed"' "$scratch/result.json"; then
  cat "$scratch/result.log" >&2
  echo 'MUTANTE VIVO: falhou sem a asserção esperada' >&2
  exit 1
fi
echo 'mutants_killed=1/1 (f06-scanner-de-segredos-morto; asserção observada)'
