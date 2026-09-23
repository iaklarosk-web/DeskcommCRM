#!/usr/bin/env bash
# scripts/prod/backup.sh — pg_dump da PRODUÇÃO para ./backups/prod-<data>.dump
# (F08-T09). É o scripts/backup.sh com o banco de produção; o backup DIÁRIO
# para o Google Drive é ~/bin/backup-crm-os (scripts/prod/backup-diario.sh).
source "$(dirname "$0")/_env.sh"
SUPABASE_DB_URL="$(prod_db_url)" BACKUP_PREFIX=prod bash scripts/backup.sh "${1:-./backups}"
