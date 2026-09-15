#!/usr/bin/env bash
# scripts/prod/secrets.sh — completa o env de segredos da PRODUÇÃO (F08-T02, D52).
#
# `/srv/secrets/crm-prod.env` nasceu em 13/09/2026 pela preparação da F08
# (`~/projetos/CRM-OS/scripts/gera-crm-prod-env.sh`, mesma receita de
# `scripts/staging/secrets.sh`). Este script é a versão VERSIONADA da receita:
# idempotente POR CHAVE — variável que existe nunca é regravada (rotacionar é
# porta 1-way do proprietário); variável que falta entra no fim. Nada aqui
# imprime valor: só nome e tamanho.
#
# O que ele acrescenta ao que a preparação já gravou:
#   WAHA_API_KEY                 chave app ↔ container WAHA (interna, gerada aqui)
#   WAHA_API_KEY_SHA512          o hash que o WAHA compara (`sha512:` no compose)
#   BILLING_MOCK_WEBHOOK_SECRET  HMAC do webhook do gateway mock (D52: Stripe depois)
# As chaves do proprietário (ANTHROPIC/OPENAI/RESEND/SENTRY) NÃO nascem aqui:
# `segredo crm-prod.env <NOME>`.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
ARQUIVO="/srv/secrets/crm-prod.env"
command -v tailscale >/dev/null 2>&1 || { echo "tailscale não encontrado no PATH" >&2; exit 1; }
BIND_IP=$(tailscale ip -4 | head -1)
[ -n "$BIND_IP" ] || { echo "sem IP do Tailscale; a produção não escuta em interface pública" >&2; exit 1; }
hex() { openssl rand -hex "$1"; }
b64() { openssl rand -base64 32; }
JWT_SECRET=$(hex 32)
jwt() {
  node -e '
    const { createHmac } = require("node:crypto");
    const [secret, role] = process.argv.slice(1);
    const b64u = (s) => Buffer.from(s).toString("base64url");
    const iat = Math.floor(Date.now() / 1000);
    const cabecalho = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const corpo = b64u(JSON.stringify({ iss: "supabase-prod", role, iat, exp: iat + 10 * 365 * 24 * 3600 }));
    const assinatura = createHmac("sha256", secret).update(`${cabecalho}.${corpo}`).digest("base64url");
    process.stdout.write(`${cabecalho}.${corpo}.${assinatura}`);
  ' "$JWT_SECRET" "$1"
}
TMP=$(mktemp); chmod 600 "$TMP"
if [ -f "$ARQUIVO" ]; then
  cat "$ARQUIVO" > "$TMP"
  if grep -qE '^JWT_SECRET=' "$ARQUIVO"; then JWT_SECRET=$(grep -E '^JWT_SECRET=' "$ARQUIVO" | cut -d= -f2-); fi
else
  {
    echo "# crm-prod — segredos da PRODUÇÃO do CRM OS nesta VPS (F08, D12/D52). Gerado por scripts/prod/secrets.sh em $(date -u +%Y-%m-%dT%H:%M:%SZ)."
    echo "# Nunca em chat, commit ou log. compose.prod.yml lê por --env-file/env_file; scripts/prod/*.sh leem nome a nome."
  } > "$TMP"
fi
valor_de() { grep -E "^$1=" "$TMP" | head -1 | cut -d= -f2- | sed -E "s/^'(.*)'$/\1/; s/^\"(.*)\"$/\1/"; }
garantir() { local nome=$1 valor=$2; grep -qE "^${nome}=" "$TMP" && return 0; echo "${nome}=${valor}" >> "$TMP"; echo "    + $nome"; }
garantir PROD_BIND_IP "$BIND_IP"
garantir POSTGRES_PASSWORD "$(hex 24)"
garantir JWT_SECRET "$JWT_SECRET"
garantir ANON_KEY "$(jwt anon)"
garantir SERVICE_ROLE_KEY "$(jwt service_role)"
garantir INTERNAL_SECRET "$(hex 32)"
garantir INTERNAL_CRON_SECRET "$(hex 32)"
garantir IMPERSONATE_COOKIE_SECRET "$(hex 32)"
garantir SRH_TOKEN "$(hex 24)"
garantir CPF_ENCRYPTION_KEY "$(b64)"
garantir WAHA_BYO_ENCRYPTION_KEY "$(b64)"
garantir AI_CRED_AES_KEY "$(b64)"
garantir REALTIME_DB_ENC_KEY "$(hex 8)"
garantir REALTIME_SECRET_KEY_BASE "$(hex 32)"
garantir WAHA_HMAC_SECRET "$(hex 24)"
garantir WAHA_API_KEY "$(hex 24)"
# O WAHA compara o hash (`WAHA_API_KEY: "sha512:<hash>"` no compose); o app
# manda o plaintext. Derivado da chave acima.
garantir WAHA_API_KEY_SHA512 "$(printf '%s' "$(valor_de WAHA_API_KEY)" | sha512sum | cut -d' ' -f1)"
garantir BILLING_MOCK_WEBHOOK_SECRET "$(hex 24)"
garantir NEXT_PUBLIC_APP_URL "https://crm.kntecnologia.app"
garantir PLATFORM_NAME "\"CRM OS\""
garantir RESEND_FROM_EMAIL "crm@mail.kntecnologia.app"
sudo install -o root -g klarosk -m 640 "$TMP" "$ARQUIVO"; rm -f "$TMP"
echo "==> gravado: $ARQUIVO"
while IFS='=' read -r nome valor; do case "$nome" in \#*|"") continue ;; esac; echo "    $nome (${#valor} chars)"; done < "$ARQUIVO"
