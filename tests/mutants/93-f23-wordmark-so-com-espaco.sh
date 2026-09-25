#!/usr/bin/env bash
# F23 (G-38): a regra do sufixo "OS" da fachada tem de errar para o lado de NÃO
# pintar. A mutação afrouxa a expressão para `/os$/i` sem exigir espaço — o
# jeito "óbvio" de escrever isso, e o que pintaria "Kair|os" e "CRM|OS" na
# marca de um revendedor. `tests/unit/branding-wordmark.test.ts` tem de ficar
# vermelho nos casos negativos; senão a régua aceita a versão que quebra a marca.
#
# Vermelho POR ASSERÇÃO, não por quebra (corolário do G-04): confere que o
# vitest rodou os casos e que a falha é a esperada, não um `command not found`.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

ALVO="lib/branding/wordmark.ts"
ORIGINAL='const SUFIXO_OS = /^(.*\S)\s+(OS)$/;'
MUTANTE='const SUFIXO_OS = /^(.*\S)\s*(OS)$/i; // MUTANTE: sem espaço, sem caixa'
if [ "$(grep -cF "$ORIGINAL" "$ALVO")" != "1" ]; then
  echo "MUTANTE INVÁLIDO: alvo não encontrado em $ALVO" >&2
  exit 1
fi

TASK_TMP=$(mktemp -d "${TMPDIR:-/tmp}/mutante-wordmark.XXXXXXXX")
cp "$ALVO" "$TASK_TMP/wordmark.ts.bak"
trap 'cp "$TASK_TMP/wordmark.ts.bak" "$ALVO"; rm -rf -- "$TASK_TMP"' EXIT

python3 - "$ALVO" "$ORIGINAL" "$MUTANTE" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); t = p.read_text(encoding="utf-8")
assert t.count(sys.argv[2]) == 1
p.write_text(t.replace(sys.argv[2], sys.argv[3]), encoding="utf-8")
PY

if pnpm exec vitest run tests/unit/branding-wordmark.test.ts >"$TASK_TMP/result.log" 2>&1; then
  echo "MUTANTE VIVO: a suíte ficou verde com o sufixo pintando 'Kairos' e 'CRMOS'" >&2
  exit 1
fi
if ! grep -qE "não pinta a metade de um nome próprio|nome colado" "$TASK_TMP/result.log"; then
  cat "$TASK_TMP/result.log" >&2
  echo "MUTANTE VIVO: falhou sem a asserção esperada" >&2
  exit 1
fi
echo "mutants_killed=1/1 (f23-wordmark-so-com-espaco; asserção observada)"
