#!/usr/bin/env bash
# scripts/backup.sh — backup do Postgres do STAGING (F06-T05, §7.7).
#
# `pg_dump --format=custom` dos schemas que o produto usa: `public` (CRM),
# `auth` (usuários do GoTrue) e `storage` (metadados de arquivos). Sem
# ownership nem privilégios no dump: o restore recria o que precisa no banco
# de destino, e o destino do TESTE é um banco vazio (D36), nunca o em uso.
#
# Uso:  bash scripts/backup.sh [pasta]            (padrão: ./backups)
# Env:  SUPABASE_DB_URL (ou /srv/secrets/crm-staging.env + porta 56422)
#       RETENTION_DAYS (padrão 14)
# Saída: uma linha `backup: file=<caminho> bytes=N tables=T` e o caminho do dump.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

DIR="${1:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
ENV_FILE="/srv/secrets/crm-staging.env"

URL="${SUPABASE_DB_URL:-}"
if [ -z "$URL" ] && [ -r "$ENV_FILE" ]; then
  senha=$(grep -E '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
  [ -n "$senha" ] && URL="postgresql://postgres:${senha}@127.0.0.1:56422/postgres"
fi
[ -n "$URL" ] || { echo "FATAL: SUPABASE_DB_URL ausente e $ENV_FILE ilegível" >&2; exit 1; }

mkdir -p "$DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$DIR/staging-$STAMP.dump"
pg_dump "$URL" --format=custom --schema=public --schema=auth --schema=storage \
  --no-owner --no-privileges --file="$OUT"
TABELAS=$(pg_restore --list "$OUT" | grep -c ' TABLE [a-z_]* [a-z_]* ' || true)
echo "backup: file=$OUT bytes=$(stat -c %s "$OUT") tables=$TABELAS"

# retenção: apaga dumps mais velhos que RETENTION_DAYS
find "$DIR" -name 'staging-*.dump' -mtime +"$RETENTION_DAYS" -delete
echo "$OUT"
