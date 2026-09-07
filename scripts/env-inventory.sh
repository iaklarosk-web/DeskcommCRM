#!/usr/bin/env bash
# F00-T05 — inventário de env vars por grep no código (DIRETRIZ §6.3, D08, G-27).
# Fontes: (a) process.env.NOME em código; (b) chaves do schema Zod de lib/env.ts (que lê process.env inteiro).
# Saída: .env.example (NOME= # arquivo:linha[, ...]) e a seção "# documentadas sem uso".
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
DIRS=(app lib workers scripts supabase hooks components proxy.ts instrumentation.ts instrumentation-client.ts next.config.ts sentry.server.config.ts sentry.edge.config.ts)
printf '%s\n' "${DIRS[@]}" > .envscan-dirs
TMP=$(mktemp)
# (a) process.env.X — arquivo:linha
grep -rnoE 'process\.env\.[A-Z][A-Z0-9_]*' "${DIRS[@]}" --include=*.ts --include=*.tsx --include=*.mjs --include=*.js --include=*.sh 2>/dev/null \
  | grep -v -E '\.test\.|/tests?/' \
  | sed -E 's#^([^:]+):([0-9]+):process\.env\.(.*)$#\3 \1:\2#' >> "$TMP" || true
# (b) chaves do z.object em lib/env.ts (entre 'const schema = z.object({' e o '});' que o fecha)
awk '/const schema = z\.object\(\{/{f=1;next} f&&/^\}\);/{f=0} f' lib/env.ts \
  | grep -nE '^\s+[A-Z][A-Z0-9_]+\s*:' | sed -E 's/^([0-9]+):\s*([A-Z][A-Z0-9_]+).*/\2 lib\/env.ts:schema+\1/' >> "$TMP" || true
# agrega por nome
sort "$TMP" | awk '{a[$1]=a[$1] (a[$1]?", ":"") $2} END{for(k in a) print k" "a[k]}' | sort > "$TMP.agg"
N=$(wc -l < "$TMP.agg")
{
  echo "# .env.example — gerado por scripts/env-inventory.sh (F00-T05). NÃO editar à mão."
  echo "# Cada linha: NOME= # onde o código lê (arquivo:linha). Pastas varridas em .envscan-dirs."
  echo "# Fase 1 roda com WHATSAPP_MODE=mock e AI_PROVIDER=mock (D12); credenciais reais são item do dono."
  echo "# vars_no_codigo=$N"
  echo
  awk '{n=$1; $1=""; sub(/^ /,""); print n"= # "$0}' "$TMP.agg"
  echo
  echo "# documentadas sem uso (citadas em docs/SETUP.md, README.md ou no .env.example herdado, sem leitura no código):"
  { grep -hoE '^[A-Z][A-Z0-9_]+=' docs/migration/env.example.deskcomm 2>/dev/null || true; \
    grep -hoE '\b[A-Z][A-Z0-9_]{3,}\b' docs/SETUP.md README.md || true; } | tr -d '=' | sort -u > "$TMP.doc"
  comm -23 "$TMP.doc" <(cut -d' ' -f1 "$TMP.agg") | grep -E '_' | grep -vE '^(ON_ERROR_STOP|NOME_DA_VARIAVEL|SEU_IP|NEXT_PUBLIC)$' | sed 's/^/# /' || true
} > "$TMP.out"
M=$(grep -c '^# [A-Z]' "$TMP.out" || true)
echo "vars_no_codigo=$N vars_so_na_doc=$M"
cat "$TMP.out" > "${ENV_OUT:-.env.example}"
