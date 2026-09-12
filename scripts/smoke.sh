#!/usr/bin/env bash
# scripts/smoke.sh <url> — smoke do staging (F06-T07) + p95 (F06-T09).
# Seis passos que comparam número, não HTTP 200; ver scripts/smoke.mjs.
#   bash scripts/smoke.sh http://127.0.0.1:3200
# Env opcional: SMOKE_SUPABASE_URL (padrão http://127.0.0.1:56421), SMOKE_DB_URL,
#               SMOKE_ENV_FILE (padrão /srv/secrets/crm-staging.env), SMOKE_SAMPLES (20).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node scripts/smoke.mjs "${1:-http://127.0.0.1:3200}"
