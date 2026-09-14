#!/usr/bin/env bash
# scripts/prod/jornada-email.sh — UM e-mail real, ao PROPRIETÁRIO, pela produção (F08-T06).
#
# A jornada é a recuperação de senha do próprio dono: o mesmo
# `POST /auth/v1/recover` que `app/actions/auth/requestPasswordReset.ts` chama,
# pelo domínio (Caddy → kong → GoTrue), e o GoTrue entrega pela Resend por
# SMTP (compose.prod.yml: `GOTRUE_SMTP_HOST=smtp.resend.com`). Destinatário =
# `OWNER_EMAIL`, e só ele (regra da casa: nunca mensagem a terceiros).
#
# Dois caminhos, um destinatário: (1) SMTP do GoTrue — o `/recover` aceito
# (HTTP 200) e a linha `user_recovery_requested` em `auth.audit_log_entries`;
# (2) a API do produto (`lib/email/resend.ts`, jornada-email.ts no worker) —
# a Resend devolve o id do envio. Saída: `email: ok id=<id da Resend> …`, o
# que `scripts/prod/prova.sh` lê em docs/ops/prod-jornadas.log.
source "$(dirname "$0")/_env.sh"
APP_URL=$(prod_env NEXT_PUBLIC_APP_URL)
DB_URL=$(prod_db_url)
DESTINO=$(prod_env OWNER_EMAIL)
REMETENTE=$(prod_env RESEND_FROM_EMAIL)
CHAVE=$(prod_env RESEND_API_KEY)
[ -n "$DESTINO" ] && [ -n "$REMETENTE" ] && [ -n "$CHAVE" ] || { echo "==> OWNER_EMAIL/RESEND_FROM_EMAIL/RESEND_API_KEY vazios" >&2; exit 1; }

ANTES=$(psql "$DB_URL" -Atc "select count(*) from auth.audit_log_entries where payload->>'action' = 'user_recovery_requested'")
INICIO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CODIGO=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 -X POST "$APP_URL/auth/v1/recover" \
  -H "apikey: $(prod_env ANON_KEY)" -H "content-type: application/json" \
  --data-binary "$(node -e 'process.stdout.write(JSON.stringify({email:process.argv[1],gotrue_meta_security:{}}))' "$DESTINO")")
[ "$CODIGO" = 200 ] || { echo "==> /auth/v1/recover respondeu $CODIGO" >&2; exit 1; }
sleep 5
DEPOIS=$(psql "$DB_URL" -Atc "select count(*) from auth.audit_log_entries where payload->>'action' = 'user_recovery_requested'")
[ "$DEPOIS" -gt "$ANTES" ] || { echo "==> auth.audit_log_entries não registrou user_recovery_requested ($ANTES → $DEPOIS)" >&2; exit 1; }

# A chave da Resend é SÓ de envio (restricted_api_key: a API de listagem
# responde 401), então a evidência do caminho SMTP é o GoTrue (audit
# `user_recovery_requested` + envio sem erro) e o e-mail na caixa do
# proprietário. O caminho da API do produto (`lib/email/resend.ts`) devolve o
# id do envio: roda dentro do worker, com o env resolvido pelo compose.
docker cp scripts/prod/jornada-email.ts crm-prod-worker:/app/scripts/prod-jornada-email.ts
API=$(docker exec -w /app crm-prod-worker sh -c 'TSX_TSCONFIG_PATH=/app/tsconfig.json node --import /app/node_modules/tsx/dist/loader.mjs /app/scripts/prod-jornada-email.ts' 2>&1 | grep -E '^email_api:' || true)
docker exec crm-prod-worker rm -f /app/scripts/prod-jornada-email.ts
case "$API" in "email_api: ok id="*) ;; *) echo "==> envio pela API do produto falhou: ${API:-sem linha}" >&2; exit 1 ;; esac
ID=$(printf '%s' "$API" | sed -E 's/^email_api: ok id=([^ ]+).*/\1/')
echo "email: ok id=$ID from=$REMETENTE recovery_audit=$((DEPOIS-ANTES))/1 recovery_via=gotrue-smtp-resend api_via=lib/email/resend.ts to=owner"
