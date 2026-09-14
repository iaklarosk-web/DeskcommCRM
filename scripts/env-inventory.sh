#!/usr/bin/env bash
# F00-T05 — inventário de env vars por grep no código (DIRETRIZ §6.3, D08, G-27).
# O .env.example herdado do Deskcomm é o TEMPLATE do operador (o kit self-host o lê; testes
# vigiam seu formato: nenhum comentário na mesma linha do valor, aviso da OpenRouter, sync
# com lib/env.ts). Este script NÃO o reescreve: acrescenta, depois do marcador, um bloco
# gerado, só de comentários, com a origem (arquivo:linha) de cada variável lida no código.
# Não cria `NOME=`: variável presente e VAZIA no template é contrato para o kit (o teste
# env-vazia-no-exemplo-nao-usa-coalescencia-nula reprova `??` sobre ela). Rodar de novo substitui o bloco.
# Fontes: (a) process.env.NOME em código; (b) chaves do z.object de lib/env.ts (lê process.env inteiro).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
DIRS=(app lib src workers scripts supabase hooks components proxy.ts instrumentation.ts instrumentation-client.ts next.config.ts sentry.server.config.ts sentry.edge.config.ts)
printf '%s\n' "${DIRS[@]}" > .envscan-dirs
MARK='# ==== inventário por grep (scripts/env-inventory.sh, F00-T05) — gerado, não editar abaixo ===='
TMP=$(mktemp)
grep -rnoE 'process\.env\.[A-Z][A-Z0-9_]*' "${DIRS[@]}" --include=*.ts --include=*.tsx --include=*.mjs --include=*.js --include=*.sh 2>/dev/null \
  | grep -v -E '\.test\.|/tests?/' \
  | sed -E 's#^([^:]+):([0-9]+):process\.env\.(.*)$#\3 \1:\2#' >> "$TMP" || true
awk '/const schema = z\.object\(\{/{f=1;next} f&&/^\}\);/{f=0} f' lib/env.ts \
  | grep -nE '^\s+[A-Z][A-Z0-9_]+\s*:' | sed -E 's/^([0-9]+):\s*([A-Z][A-Z0-9_]+).*/\2 lib\/env.ts:schema+\1/' >> "$TMP" || true
sort "$TMP" | awk '{a[$1]=a[$1] (a[$1]?", ":"") $2} END{for(k in a) print k" "a[k]}' | sort > "$TMP.agg"
N=$(wc -l < "$TMP.agg")
# template = tudo antes do marcador (ou o arquivo inteiro na primeira execução)
awk -v m="$MARK" '$0==m{exit} {print}' .env.example > "$TMP.tpl"
grep -oE '^[A-Z][A-Z0-9_]+=' "$TMP.tpl" | tr -d '=' | sort -u > "$TMP.tplkeys"
{
  cat "$TMP.tpl"
  echo "$MARK"
  echo "# vars_no_codigo=$N. Uma entrada por variável lida no código; 'lido em' = arquivo:linha."
  echo "# Só comentários: o template acima é o contrato do operador; [sem template] marca variável lida no código e ausente dele."
  while read -r nome origem; do
    if grep -qx "$nome" "$TMP.tplkeys"; then echo "# $nome lido em: $origem"; else echo "# $nome [sem template] lido em: $origem"; fi
  done < "$TMP.agg"
  echo "# documentadas sem uso no código (só no template acima, em docs/SETUP.md ou README.md — normalmente lidas por compose/kit, não por process.env):"
  { cat "$TMP.tplkeys"; grep -hoE '\b[A-Z][A-Z0-9_]{3,}\b' docs/SETUP.md README.md || true; } | sort -u \
    | comm -23 - <(cut -d' ' -f1 "$TMP.agg") | grep -E '_' | grep -vE '^(ON_ERROR_STOP|NOME_DA_VARIAVEL|SEU_IP|NEXT_PUBLIC)$' | sed 's/^/# /' || true
} > "$TMP.out"
M=$(grep -c '^# [A-Z][A-Z0-9_]*$' "$TMP.out" || true)
A=$(grep -c '\[sem template\]' "$TMP.out" || true)
cat "$TMP.out" > .env.example
echo "vars_no_codigo=$N vars_so_na_doc=$M vars_sem_template=$A"
