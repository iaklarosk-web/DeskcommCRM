#!/usr/bin/env bash
# scripts/prod/_env.sh — o que TODO script de produção compartilha (F08-T02).
# É `source`ado; não roda sozinho. Nada daqui imprime valor de segredo.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
PROD_ENV_FILE="/srv/secrets/crm-prod.env"
PROD_COMPOSE=(docker compose -f compose.prod.yml --env-file "$PROD_ENV_FILE" -p crm-prod)
PROD_DB_PORT=56432
PROD_API_PORT=56431
PROD_APP_PORT=3300
[ -r "$PROD_ENV_FILE" ] || { echo "==> $PROD_ENV_FILE ausente ou ilegível (root:klarosk 640; veja docs/ops/prod.md)" >&2; exit 1; }
# Tira aspas simples/duplas externas: o `segredo` da casa grava NOME='valor'.
prod_env() { grep -E "^$1=" "$PROD_ENV_FILE" | head -1 | cut -d= -f2- | sed -E "s/^'(.*)'$/\1/; s/^\"(.*)\"$/\1/"; }
prod_db_url() { echo "postgresql://postgres:$(prod_env POSTGRES_PASSWORD)@127.0.0.1:${PROD_DB_PORT}/postgres"; }
