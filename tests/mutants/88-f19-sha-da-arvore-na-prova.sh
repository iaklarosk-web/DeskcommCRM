#!/usr/bin/env bash
# F19-T06 (achado de 22/09/2026), G-38: a linha `prod:` tem de citar o commit EM
# EXECUÇÃO, lido do carimbo da imagem. A mutação devolve o `git rev-parse --short
# HEAD` da árvore — a prova jurando um deploy que não houve; o caso "prova.sh lê
# o carimbo do container e NUNCA usa o HEAD da árvore como sha" tem de ficar
# vermelho.
#
# A mutação é em DISCO (cópia num scratch, nunca na árvore) porque a suíte lê os
# scripts com `readFileSync`: mutante em memória não a alcançaria — foi o que a
# primeira versão deste arquivo provou, ficando verde.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/f19-sha-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/scripts/prod" "$scratch/scripts/staging" "$scratch/tests/unit"
node --input-type=module - "$scratch" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const destino = process.argv[2];
const prova = readFileSync('scripts/prod/prova.sh', 'utf8');
const alvo = "SHA=$(docker exec crm-prod-app sh -c 'cat /app/COMMIT 2>/dev/null || cat /app/standalone/COMMIT 2>/dev/null' 2>/dev/null | tr -d '\\r\\n')";
if (prova.split(alvo).length - 1 !== 1) throw new Error('Mutant target missing: o carimbo mudou de forma em prova.sh');
writeFileSync(`${destino}/scripts/prod/prova.sh`, prova.replace(alvo, 'SHA=$(git rev-parse --short HEAD) # MUTANTE: sha da árvore'));
JS
cp scripts/prod/up.sh "$scratch/scripts/prod/up.sh"
cp scripts/staging/Dockerfile.staging "$scratch/scripts/staging/Dockerfile.staging"
if F19_T06_RAIZ_DOS_SCRIPTS="$scratch" ./node_modules/.bin/vitest run tests/unit/f19-t06-sha-da-producao-e-o-da-imagem.test.ts >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: a suíte ficou verde com o sha vindo da árvore' >&2
  tail -20 "$scratch/result.log" >&2
  exit 1
fi
if ! grep -q 'prova.sh ainda usa o HEAD da árvore' "$scratch/result.log"; then
  tail -20 "$scratch/result.log" >&2
  echo 'MUTANTE VIVO: falhou sem a asserção esperada' >&2
  exit 1
fi
echo 'mutants_killed=1/1 (f19-sha-da-arvore-na-prova; asserção observada)'
