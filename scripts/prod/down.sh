#!/usr/bin/env bash
# scripts/prod/down.sh — derruba SÓ a produção. Volumes (banco, storage,
# sessões do WAHA) FICAM. Apagar volumes de produção é porta 1-way do
# proprietário: `docker compose -f compose.prod.yml -p crm-prod down -v`.
source "$(dirname "$0")/_env.sh"
"${PROD_COMPOSE[@]}" down
echo "==> containers da produção restantes: $(docker ps -aq --filter name=crm-prod- | wc -l)"
echo "==> volumes preservados: $(docker volume ls -q --filter name=crm-prod | tr '\n' ' ')"
