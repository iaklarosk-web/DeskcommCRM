#!/usr/bin/env bash
# scripts/prod/restore.sh — restore de um dump da produção num banco VAZIO
# criado para o teste, no MESMO Postgres de produção; compara e apaga (D36).
# NUNCA toca `postgres` (o banco em uso). Log: docs/ops/restore-prod.log.
source "$(dirname "$0")/_env.sh"
SUPABASE_DB_URL="$(prod_db_url)" RESTORE_LOG=docs/ops/restore-prod.log bash scripts/restore.sh "$@"
