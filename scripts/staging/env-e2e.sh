#!/usr/bin/env bash
# scripts/staging/env-e2e.sh — o `.env.e2e` do gate DENTRO do staging (ADR-028 §2).
#
# O `verify.sh` com `VERIFY_ENVIRONMENT=staging` exige um `.env.e2e` apontado
# para o Supabase do staging (loopback 56421/56422) e o app do gate em 3202 —
# o `next start` que o Playwright sobe no host, do mesmo commit. As chaves
# vêm de `/srv/secrets/crm-staging.env`; nada é impresso.
#
# O `.env.e2e` anterior (o do sandbox descartável) é preservado em
# `.env.e2e.sandbox` e volta com `--restore`. Os dois são privados (.gitignore).
#
# Uso:
#   bash scripts/staging/env-e2e.sh            # escreve o .env.e2e do staging
#   bash scripts/staging/env-e2e.sh --restore  # devolve o do sandbox
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [ "${1:-}" = "--restore" ]; then
  [ -f .env.e2e.sandbox ] || { echo "==> .env.e2e.sandbox não existe; nada a restaurar" >&2; exit 1; }
  mv .env.e2e.sandbox .env.e2e
  echo "==> .env.e2e do sandbox restaurado"
  exit 0
fi

ENV_FILE="/srv/secrets/crm-staging.env"
[ -r "$ENV_FILE" ] || { echo "==> $ENV_FILE ilegível" >&2; exit 1; }
ler() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

if [ -f .env.e2e ] && ! grep -q "GERADO por scripts/staging/env-e2e.sh" .env.e2e; then
  cp .env.e2e .env.e2e.sandbox
  echo "==> .env.e2e anterior preservado em .env.e2e.sandbox"
fi

# Chaves de cifra: reaproveita as do .env.e2e atual quando existem (credencial
# já cifrada no banco do staging pelo gate anterior continua legível).
CHAVE_CPF=""; CHAVE_WAHA=""; CHAVE_AI=""
if [ -f .env.e2e ]; then
  CHAVE_CPF="$(grep -E '^CPF_ENCRYPTION_KEY=' .env.e2e | cut -d= -f2- || true)"
  CHAVE_WAHA="$(grep -E '^WAHA_BYO_ENCRYPTION_KEY=' .env.e2e | cut -d= -f2- || true)"
  CHAVE_AI="$(grep -E '^AI_CRED_AES_KEY=' .env.e2e | cut -d= -f2- || true)"
fi
[ "${#CHAVE_CPF}" -ge 44 ] || CHAVE_CPF="$(openssl rand -base64 32)"
[ "${#CHAVE_WAHA}" -ge 44 ] || CHAVE_WAHA="$(openssl rand -base64 32)"
[ "${#CHAVE_AI}" -ge 44 ] || CHAVE_AI="$(openssl rand -base64 32)"

umask 077
cat > .env.e2e <<EOF
# ── Ambiente do E2E — o STAGING desta VPS, em loopback (ADR-028 §2) ──────────
# GERADO por scripts/staging/env-e2e.sh. Não versionado (.gitignore cobre '.env*').
# O app do gate sobe em 3202 (Playwright); o container do staging segue em 3200.
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:56421
NEXT_PUBLIC_SUPABASE_ANON_KEY=$(ler ANON_KEY)
SUPABASE_SERVICE_ROLE_KEY=$(ler SERVICE_ROLE_KEY)
SUPABASE_DB_URL=postgresql://postgres:$(ler POSTGRES_PASSWORD)@127.0.0.1:56422/postgres
NEXT_PUBLIC_APP_URL=http://localhost:3202
INTERNAL_SECRET=$(ler INTERNAL_SECRET)
IMPERSONATE_COOKIE_SECRET=$(ler IMPERSONATE_COOKIE_SECRET)
CPF_ENCRYPTION_KEY=$CHAVE_CPF
WAHA_BYO_ENCRYPTION_KEY=$CHAVE_WAHA
AI_CRED_AES_KEY=$CHAVE_AI
WAHA_API_BASE_URL=http://127.0.0.1:3999
WAHA_API_KEY=e2e-placeholder-nao-e-segredo
WAHA_WEBHOOK_BASE_URL=http://127.0.0.1:3202
UPSTASH_REDIS_REST_URL=http://127.0.0.1:3998
UPSTASH_REDIS_REST_TOKEN=e2e-placeholder-nao-e-segredo
WHATSAPP_MOCK_HMAC_SECRET=$(ler WHATSAPP_MOCK_HMAC_SECRET)
AI_PROVIDER=mock
WHATSAPP_MODE=mock
NEXT_TELEMETRY_DISABLED=1
SENTRY_DSN=off
E2E_PORT=3202
F02_E2E_SANDBOX_ID=crm-staging
EOF
echo "==> .env.e2e do staging escrito ($(grep -cE '^[A-Z_]+=' .env.e2e) variáveis; loopback 56421/56422, app 3202)"
