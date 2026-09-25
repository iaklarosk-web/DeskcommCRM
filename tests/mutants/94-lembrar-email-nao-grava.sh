#!/usr/bin/env bash
# F23 (G-38): "Lembrar meu e-mail" que não grava é uma caixa decorativa. A mutação
# faz `lembrarEmail` sair antes do `setItem`; `tests/unit/lembrar-email.test.ts`
# tem de ficar vermelho no caso "guarda o e-mail e o devolve" — senão a régua
# aceita a versão que finge lembrar.
#
# Vermelho POR ASSERÇÃO, não por quebra (corolário do G-04).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

ALVO="lib/auth/lembrar-email.ts"
ORIGINAL='    window.localStorage.setItem(CHAVE, limpo);'
MUTANTE='    return; // MUTANTE: nunca grava'
if [ "$(grep -cF "$ORIGINAL" "$ALVO")" != "1" ]; then
  echo "MUTANTE INVÁLIDO: alvo não encontrado em $ALVO" >&2
  exit 1
fi

TASK_TMP=$(mktemp -d "${TMPDIR:-/tmp}/mutante-lembrar-email.XXXXXXXX")
cp "$ALVO" "$TASK_TMP/lembrar-email.ts.bak"
trap 'cp "$TASK_TMP/lembrar-email.ts.bak" "$ALVO"; rm -rf -- "$TASK_TMP"' EXIT

python3 - "$ALVO" "$ORIGINAL" "$MUTANTE" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); t = p.read_text(encoding="utf-8")
assert t.count(sys.argv[2]) == 1
p.write_text(t.replace(sys.argv[2], sys.argv[3]), encoding="utf-8")
PY

if pnpm exec vitest run tests/unit/lembrar-email.test.ts >"$TASK_TMP/result.log" 2>&1; then
  echo "MUTANTE VIVO: a suíte ficou verde com lembrarEmail sem gravar nada" >&2
  exit 1
fi
if ! grep -qE "guarda o e-mail e o devolve" "$TASK_TMP/result.log"; then
  cat "$TASK_TMP/result.log" >&2
  echo "MUTANTE VIVO: falhou sem a asserção esperada" >&2
  exit 1
fi
echo "mutants_killed=1/1 (lembrar-email-nao-grava; asserção observada)"
