#!/usr/bin/env bash
# create-tenant (F01-T06) — wrapper fino do scripts/create-tenant.ts.
# Uso: scripts/create-tenant.sh docs/tenants/demo2.seed.yaml
# Idempotente: a segunda execução imprime rows_created=0.
set -euo pipefail
cd "$(dirname "$0")/.."
exec pnpm exec tsx scripts/create-tenant.ts "$@"
