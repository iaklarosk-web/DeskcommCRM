#!/usr/bin/env bash
# scripts/prod/prova.sh — a linha `prod:` do BUILD-STATE (F08-T10, ADR-032 §4).
#
# Mede contra o stack `crm-prod` DE PÉ, com denominador, o que §7.9 pede da
# produção inicial: configuração sem placeholder, nada em porta pública, o
# domínio com HTTPS/HSTS, o dono logando, cada jornada real acontecida UMA vez
# (o que ficou no banco ou no log de jornadas com o id do provedor), backup
# confirmado no remoto e restore com `rows_diff=0`. Nenhum segredo sai daqui:
# OWNER_PASSWORD entra no corpo de uma requisição e nunca é impresso.
#
# Cada campo é lido, não declarado. Um campo que não pôde ser medido sai como
# `0/1` (ou `absent`) — e a linha inteira reprova o fechamento; nunca "1/1 por
# fé". Saída: a linha `prod:` em stdout; exit 1 se algum campo obrigatório
# não bateu o denominador.
source "$(dirname "$0")/_env.sh"
DB_URL=$(prod_db_url)
APP_URL=$(prod_env NEXT_PUBLIC_APP_URL)
BIND_IP=$(prod_env PROD_BIND_IP)
JORNADAS="docs/ops/prod-jornadas.log"
VARS="scripts/prod/vars-obrigatorias.txt"
FALHAS=0
falha() { echo "  ✗ $*" >&2; FALHAS=$((FALHAS+1)); }

# ─── stack ───────────────────────────────────────────────────────────────────
DECLARADOS=$("${PROD_COMPOSE[@]}" config --services | wc -l)
RODANDO=$(docker ps --filter name=crm-prod- --filter status=running --format '{{.Names}}' | wc -l)
[ "$RODANDO" = "$DECLARADOS" ] || falha "serviços: $RODANDO/$DECLARADOS"

# ─── configuração sem placeholder ────────────────────────────────────────────
TOTAL_VARS=0; PRESENTES=0; PLACEHOLDERS=0
while read -r nome; do
  [ -n "$nome" ] || continue
  case "$nome" in \#*) continue ;; esac
  TOTAL_VARS=$((TOTAL_VARS+1))
  valor=$(prod_env "$nome")
  if [ -n "$valor" ]; then PRESENTES=$((PRESENTES+1)); else falha "variável vazia: $nome"; fi
  if printf '%s' "$valor" | grep -qiE 'placeholder|changeme|example|staging|xxx'; then PLACEHOLDERS=$((PLACEHOLDERS+1)); falha "placeholder em $nome"; fi
done < "$VARS"

# ─── portas ──────────────────────────────────────────────────────────────────
PUBLICAS=$(ss -ltn | grep -E ":(3300|5643[12]) " | awk '{print $4}' | grep -vc -E "^(127\.0\.0\.1|$BIND_IP):" || true)
[ "$PUBLICAS" = 0 ] || falha "portas em interface pública: $PUBLICAS"

# ─── domínio: HTTPS + HSTS + os outros vhosts continuam de pé ────────────────
CABECALHOS=$(curl -sI --max-time 20 "$APP_URL/api/v1/health" || true)
HTTPS=0; HSTS=0
printf '%s' "$CABECALHOS" | head -1 | grep -q " 200" && HTTPS=1 || falha "https: $(printf '%s' "$CABECALHOS" | head -1)"
printf '%s' "$CABECALHOS" | grep -qi '^strict-transport-security:' && HSTS=1 || falha "sem HSTS"
VHOSTS=(https://transportes.kntecnologia.app https://pdv.kntecnologia.app https://kntecnologia.app https://trade.kntecnologia.app https://oferta.kntecnologia.app https://marketing.kntecnologia.app https://mapabid.kntecnologia.app)
VH_OK=0
for v in "${VHOSTS[@]}"; do
  code=$(curl -s -o /dev/null --max-time 20 -w '%{http_code}' "$v" || echo 000)
  case "$code" in 2*|3*) VH_OK=$((VH_OK+1)) ;; *) falha "vhost $v: $code" ;; esac
done

# ─── o dono loga pelo domínio (GoTrue atrás do Caddy → kong) ─────────────────
LOGIN=0
TOKEN=$(curl -s --max-time 20 -X POST "$APP_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $(prod_env ANON_KEY)" -H "content-type: application/json" \
  --data-binary "$(node -e 'process.stdout.write(JSON.stringify({email:process.argv[1],password:process.argv[2]}))' "$(prod_env OWNER_EMAIL)" "$(prod_env OWNER_PASSWORD)")" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(j.access_token?"ok":"")}catch{process.stdout.write("")}})')
[ "$TOKEN" = ok ] && LOGIN=1 || falha "login do dono pelo domínio"

# ─── banco de produção ───────────────────────────────────────────────────────
q() { psql "$DB_URL" -Atc "$1"; }
PLATFORM_ADMINS=$(q "select count(*) from public.platform_admins where revoked_at is null")
ORGS=$(q "select count(*) from public.organizations")
ORGS_SEM=$(q "select count(*) from public.organizations o where not exists (select 1 from public.subscriptions s where s.organization_id = o.id)")
[ "$PLATFORM_ADMINS" -ge 1 ] || falha "platform_admins=$PLATFORM_ADMINS"
[ "$ORGS_SEM" = 0 ] || falha "orgs sem assinatura: $ORGS_SEM/$ORGS"
# Jornadas reais que deixam rastro no banco: um turno de chat gravado por
# run-model-call em `ai_usage_events` (§5.3) e um material indexado pelo
# rag-indexer com `ai_chunks.embedding vector(1536)` do provedor real
# (ADR-002: o acervo do SaaS usa embedding determinístico; o real é o herdado).
AI_TURNS=$(q "select count(*) from public.ai_usage_events where operation = 'chat' and model not ilike '%mock%'")
CHUNKS=$(q "select count(*) from public.ai_chunks c join public.ai_knowledge_sources s on s.id = c.knowledge_source_id where s.last_index_status = 'ok'")
AI_TURN=$([ "$AI_TURNS" -ge 1 ] && echo 1 || echo 0); [ "$AI_TURN" = 1 ] || falha "nenhum turno real de IA em ai_usage_events"
EMBEDDING=$([ "$CHUNKS" -ge 1 ] && echo 1 || echo 0); [ "$EMBEDDING" = 1 ] || falha "nenhum material indexado com embedding real (ai_chunks)"

# ─── jornadas com id do provedor (log versionado, sem corpo) ─────────────────
EMAIL=0; SENTRY=0
if [ -f "$JORNADAS" ]; then
  grep -qE '^email: ok ' "$JORNADAS" && EMAIL=1
  grep -qE '^sentry: ok ' "$JORNADAS" && SENTRY=1
fi
[ "$EMAIL" = 1 ] || falha "sem linha 'email: ok' em $JORNADAS"
[ "$SENTRY" = 1 ] || falha "sem linha 'sentry: ok' em $JORNADAS"

# ─── WhatsApp: container real de pé, sem número (D12-4) ─────────────────────
WAHA=$(docker exec crm-prod-waha wget -q -O - http://127.0.0.1:3000/ping 2>/dev/null | grep -c pong || true)
[ "$WAHA" = 1 ] && WHATSAPP=health_only || { WHATSAPP=down; falha "waha /ping"; }

# ─── backup no remoto e restore ──────────────────────────────────────────────
BACKUP=0
MARCADOR="${CRM_BACKUP_MARKER:-/var/tmp/crm-os-backup-success.marker}"
if [ -f "$MARCADOR" ]; then
  remoto=$(sed -n 4p "$MARCADOR"); tamanho=$(sed -n 3p "$MARCADOR")
  remoto_agora=$(rclone lsl "$remoto" 2>/dev/null | awk 'NR == 1 { print $1 }')
  [ -n "$remoto_agora" ] && [ "$remoto_agora" = "$tamanho" ] && BACKUP=1
fi
[ "$BACKUP" = 1 ] || falha "backup no remoto não confirmado (marcador $MARCADOR)"
RESTORE_DIFF=absent
if [ -f docs/ops/restore-prod.log ]; then
  RESTORE_DIFF=$(tail -n 1 docs/ops/restore-prod.log | grep -oE 'rows_diff=[0-9]+' | cut -d= -f2)
fi
[ "$RESTORE_DIFF" = 0 ] || falha "restore-prod.log: rows_diff=$RESTORE_DIFF"

SHA=$(git rev-parse --short HEAD)
echo "prod: compose=crm-prod services_running=$RODANDO/$DECLARADOS config_vars=$PRESENTES/$TOTAL_VARS placeholders=$PLACEHOLDERS/$TOTAL_VARS public_ports=$PUBLICAS https=$HTTPS/1 hsts=$HSTS/1 vhosts_ok=$VH_OK/${#VHOSTS[@]} owner_login=$LOGIN/1 platform_admins=$PLATFORM_ADMINS orgs=$ORGS orgs_without_subscription=$ORGS_SEM/$ORGS ai_turn=$AI_TURN/1 embedding=$EMBEDDING/1 email=$EMAIL/1 sentry_event=$SENTRY/1 whatsapp=$WHATSAPP backup=$BACKUP/1 restore_rows_diff=$RESTORE_DIFF sha=$SHA"
[ "$FALHAS" = 0 ] || { echo "==> $FALHAS campo(s) fora do denominador" >&2; exit 1; }
