#!/usr/bin/env bash
# scripts/restore.sh — restore de um backup num banco VAZIO criado para o teste (F06-T05, D36).
#
# NUNCA toca o banco em uso (`postgres`). Cria `restore_<data>` no MESMO
# Postgres do staging, restaura o dump nele, compara tabela a tabela com a
# origem (contagem de linhas nos schemas public/auth/storage) e apaga o banco
# de teste ao fim. Grava `docs/ops/restore-staging.log` com a linha
# `restore: tables=T rows_diff=0 ...` — é a que o BUILD-STATE cita.
#
# Restore sobre banco em uso, com dados reais ou em produção é HUMANO
# (D11, D26): este script recusa qualquer alvo que não seja um banco novo
# criado por ele.
#
# Uso:  bash scripts/restore.sh <arquivo.dump>
# Env:  SUPABASE_DB_URL (ou /srv/secrets/crm-staging.env + porta 56422)
#       KEEP_DB=1 mantém o banco de teste para inspeção (apagar depois é seu)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

DUMP="${1:-}"
[ -f "$DUMP" ] || { echo "uso: scripts/restore.sh <arquivo.dump>" >&2; exit 2; }
ENV_FILE="/srv/secrets/crm-staging.env"
URL="${SUPABASE_DB_URL:-}"
if [ -z "$URL" ] && [ -r "$ENV_FILE" ]; then
  senha=$(grep -E '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
  [ -n "$senha" ] && URL="postgresql://postgres:${senha}@127.0.0.1:56422/postgres"
fi
[ -n "$URL" ] || { echo "FATAL: SUPABASE_DB_URL ausente e $ENV_FILE ilegível" >&2; exit 1; }
case "$URL" in
  *@127.0.0.1:*|*@localhost:*) ;;
  *) echo "RECUSADO: restore só contra Postgres local do staging (D11)" >&2; exit 1 ;;
esac

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
ALVO="restore_$(date -u +%Y%m%d_%H%M%S)"
ORIGEM_URL="$URL"
ALVO_URL="${URL%/postgres}/$ALVO"
LOG="docs/ops/restore-staging.log"
mkdir -p docs/ops

contar() {
  # uma linha por tabela: schema.tabela|linhas (contagem exata, não estimativa)
  local sql
  sql=$(psql "$1" -Atc "
    select coalesce(string_agg(format('select %L as t, count(*)::bigint as n from %I.%I', schemaname||'.'||tablename, schemaname, tablename), ' union all ' order by schemaname, tablename), 'select null::text, 0::bigint where false')
      from pg_tables where schemaname in ('public','auth','storage')")
  psql "$1" -Atc "$sql" | sort
}

echo "==> criando o banco vazio $ALVO (nunca o em uso)"
psql "$ORIGEM_URL" -v ON_ERROR_STOP=1 -qc "create database \"$ALVO\""
limpar() {
  if [ "${KEEP_DB:-0}" = 1 ]; then echo "==> KEEP_DB=1: $ALVO mantido"; return; fi
  psql "$ORIGEM_URL" -qc "drop database if exists \"$ALVO\"" || true
}
trap limpar EXIT

echo "==> extensões que o dump referencia e não cria (os schemas auth/storage vêm no dump)"
psql "$ALVO_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema public;
create extension if not exists citext with schema public;
create extension if not exists pg_trgm with schema public;
SQL

# O banco novo nasce do template da imagem do Supabase, que já tem `public`
# (e pode ter `auth`/`storage`) como schema NÃO padrão — o dump traz o
# `CREATE SCHEMA` deles e reprovaria com "already exists". A lista de
# restauração (`-L`) tira só as entradas de schema que já existem no alvo;
# tabelas, funções, índices e dados entram inteiros, com --exit-on-error.
LISTA=".verify-logs/restore-$STAMP.list"
pg_restore --list "$DUMP" > "$LISTA"
for schema in $(psql "$ALVO_URL" -Atc "select nspname from pg_namespace where nspname in ('public','auth','storage')"); do
  sed -i "/ SCHEMA - $schema /d" "$LISTA"
done
echo "==> pg_restore em $ALVO ($(grep -c . "$LISTA") entradas)"
INICIO=$(date +%s)
pg_restore --dbname="$ALVO_URL" --no-owner --no-privileges --exit-on-error -L "$LISTA" "$DUMP" > .verify-logs/restore-$STAMP.log 2>&1 \
  || { tail -20 .verify-logs/restore-$STAMP.log >&2; echo "FATAL: pg_restore falhou (log em .verify-logs/restore-$STAMP.log)" >&2; exit 1; }
DURACAO=$(( $(date +%s) - INICIO ))

echo "==> comparando tabela a tabela (public, auth, storage)"
ORIGEM=$(contar "$ORIGEM_URL")
DESTINO=$(contar "$ALVO_URL")
T_ORIGEM=$(printf '%s\n' "$ORIGEM" | grep -c . || true)
T_DESTINO=$(printf '%s\n' "$DESTINO" | grep -c . || true)
DIFF=$(diff <(printf '%s\n' "$ORIGEM") <(printf '%s\n' "$DESTINO") | grep -c '^[<>]' || true)
LINHAS_ORIGEM=$(printf '%s\n' "$ORIGEM" | awk -F'|' '{s+=$2} END {print s+0}')

LINHA="restore: tables=$T_ORIGEM tables_restored=$T_DESTINO rows=$LINHAS_ORIGEM rows_diff=$DIFF dump=$(basename "$DUMP") target=$ALVO seconds=$DURACAO at=$STAMP"
echo "$LINHA" | tee -a "$LOG"
if [ "$DIFF" != 0 ] || [ "$T_ORIGEM" != "$T_DESTINO" ]; then
  echo "==> diferenças:" >&2
  diff <(printf '%s\n' "$ORIGEM") <(printf '%s\n' "$DESTINO") >&2 || true
  exit 1
fi
