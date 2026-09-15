#!/usr/bin/env bash
# scripts/prod/status.sh — o que está de pé, memória por container e portas.
# Última linha: `staging:`-like para o BUILD-STATE — aqui `prod_stack:`.
source "$(dirname "$0")/_env.sh"
"${PROD_COMPOSE[@]}" ps
echo
echo "memória por container (docker stats, uma amostra):"
docker stats --no-stream --format '  {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' $(docker ps -q --filter name=crm-prod-) 2>/dev/null | sort
echo
echo "portas escutando (só 127.0.0.1 e o IP do Tailscale devem aparecer):"
ss -ltn | grep -E ":(3300|5643[12]) " | awk '{print "  " $4}'
free -m | head -2
DECLARADOS=$("${PROD_COMPOSE[@]}" config --services | wc -l)
RODANDO=$(docker ps --filter name=crm-prod- --filter status=running --format '{{.Names}}' | wc -l)
MEM=$(docker stats --no-stream --format '{{.MemUsage}}' $(docker ps -q --filter name=crm-prod-) 2>/dev/null | awk '{v=$1; if (v ~ /GiB/) {sub(/GiB/,"",v); s+=v*1024} else {sub(/MiB/,"",v); s+=v}} END {printf "%d", s}')
PUBLICAS=$(ss -ltn | grep -E ":(3300|5643[12]) " | awk '{print $4}' | grep -vc -E "^(127\.0\.0\.1|$(prod_env PROD_BIND_IP)):" || true)
echo "prod_stack: compose=crm-prod services_running=$RODANDO/$DECLARADOS memory_mib=$MEM ports=127.0.0.1+tailscale(3300,56431,56432) public_ports=$PUBLICAS"
