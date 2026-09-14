#!/usr/bin/env bash
# scripts/staging/status.sh — o que está de pé e quanto cada container consome.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
docker compose -f compose.staging.yml --env-file /srv/secrets/crm-staging.env -p crm-staging ps
echo
echo "memória por container (docker stats, uma amostra):"
docker stats --no-stream --format '  {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' $(docker ps -q --filter name=crm-staging-) 2>/dev/null | sort
echo
echo "portas escutando (só 127.0.0.1 e o IP do Tailscale devem aparecer):"
ss -ltn | grep -E ":(3200|5642[124]) " | awk '{print "  " $4}'
free -m | head -2
