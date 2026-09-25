#!/usr/bin/env bash
# scripts/prod/stripe-live.sh — liga e prova o Stripe LIVE na produção (F19-T06,
# ADR-044 §4; D58). Lê /srv/secrets/crm-prod.env nome a nome (nunca imprime
# valor) e delega a scripts/prod/stripe-live.ts:
#
#   bash scripts/prod/stripe-live.sh ligar   # registra o webhook LIVE pela API,
#                                            # provisiona os planos do dono e GRAVA
#                                            # STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_IDS /
#                                            # STRIPE_PORTAL_CONFIGURATION_ID / STRIPE_MODE=live /
#                                            # BILLING_GATEWAY=stripe no env (sudo install)
#   bash scripts/prod/stripe-live.sh provar  # a linha `stripe_live:` (sem cobrança)
#
# Depois de `ligar`: `bash scripts/prod/up.sh` (o app precisa reler o env) e
# `bash scripts/prod/prova.sh` tem de mostrar `billing_gateway=stripe`.
source "$(dirname "$0")/_env.sh"
MODO="${1:-}"
[ "$MODO" = "ligar" ] || [ "$MODO" = "provar" ] || { echo "uso: $0 ligar|provar" >&2; exit 2; }
export STRIPE_SECRET_KEY="$(prod_env STRIPE_SECRET_KEY)"
export SUPABASE_DB_URL="$(prod_db_url)"
export APP_URL="$(prod_env NEXT_PUBLIC_APP_URL)"
export ADMIN_SUMMARY_TOKEN="$(prod_env ADMIN_SUMMARY_TOKEN)"
export STRIPE_PRICE_IDS="$(prod_env STRIPE_PRICE_IDS)"
export STRIPE_PORTAL_CONFIGURATION_ID="$(prod_env STRIPE_PORTAL_CONFIGURATION_ID)"
export STRIPE_WEBHOOK_SECRET_EXISTENTE="$(prod_env STRIPE_WEBHOOK_SECRET)"
export STRIPE_PORTAL_CONFIGURATION_ID_EXISTENTE="$STRIPE_PORTAL_CONFIGURATION_ID"
export PATH="$PWD/node_modules/.bin:$PATH"

if [ "$MODO" = "provar" ]; then
  exec tsx scripts/prod/stripe-live.ts provar
fi

OUT=$(mktemp); chmod 600 "$OUT"
trap 'rm -f "$OUT"' EXIT
tsx scripts/prod/stripe-live.ts ligar --out "$OUT"

# Grava no env: substitui a linha se existe, acrescenta se não. Nunca ecoa valor.
TMP=$(mktemp); chmod 600 "$TMP"; cat "$PROD_ENV_FILE" > "$TMP"
GRAVADAS=0
while IFS= read -r linha; do
  [ -n "$linha" ] || continue
  nome="${linha%%=*}"
  if grep -qE "^${nome}=" "$TMP"; then
    grep -vE "^${nome}=" "$TMP" > "$TMP.novo"; mv "$TMP.novo" "$TMP"
  fi
  printf '%s\n' "$linha" >> "$TMP"
  GRAVADAS=$((GRAVADAS+1))
  echo "    = $nome (${#linha} chars com o nome)"
done < "$OUT"
sudo install -o root -g klarosk -m 640 "$TMP" "$PROD_ENV_FILE"; rm -f "$TMP"
echo "==> $GRAVADAS variáveis gravadas em $PROD_ENV_FILE; agora: bash scripts/prod/up.sh && bash scripts/prod/prova.sh"
