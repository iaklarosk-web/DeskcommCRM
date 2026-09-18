#!/usr/bin/env bash
# scripts/staging/down.sh — derruba SÓ o staging. Volumes (banco, storage)
# ficam: é ambiente persistente, não o sandbox do gate. Para apagar volumes:
#   docker compose -f compose.staging.yml -p crm-staging down -v   (porta 1-way: o dono decide)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
docker compose -f compose.staging.yml --env-file /srv/secrets/crm-staging.env -p crm-staging down
echo "==> containers do staging restantes: $(docker ps -aq --filter name=crm-staging- | wc -l)"
echo "==> volumes preservados: $(docker volume ls -q --filter name=crm-staging | tr '\n' ' ')"
