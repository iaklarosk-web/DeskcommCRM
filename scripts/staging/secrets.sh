#!/usr/bin/env bash
# scripts/staging/secrets.sh — gera UMA vez o env de segredos do staging (F06-T06).
#
# Destino: /srv/secrets/crm-staging.env (root:klarosk 640, regra da casa).
# Nada aqui é impresso: o script mostra NOME e TAMANHO de cada valor, nunca o
# valor. Se o arquivo já existe, nada é regravado — apagar ou rotacionar
# segredo é porta 1-way do proprietário.
#
# O que gera:
#   STAGING_BIND_IP           IP do Tailscale desta VPS (as portas só escutam nele e em 127.0.0.1)
#   POSTGRES_PASSWORD         senha dos papéis do Supabase local
#   JWT_SECRET                segredo HS256 do GoTrue/PostgREST/Storage/Realtime (64 hex)
#   ANON_KEY, SERVICE_ROLE_KEY JWTs assinados com o JWT_SECRET (iss supabase-staging, 10 anos)
#   INTERNAL_SECRET, INTERNAL_CRON_SECRET, IMPERSONATE_COOKIE_SECRET, SRH_TOKEN
#   CPF_ENCRYPTION_KEY, WAHA_BYO_ENCRYPTION_KEY, AI_CRED_AES_KEY   (32 bytes, base64)
#   REALTIME_DB_ENC_KEY (16 chars), REALTIME_SECRET_KEY_BASE (64 hex)
#   STAGING_SMOKE_PASSWORD    senha dos usuários fictícios que o smoke usa para logar
#   WHATSAPP_MOCK_HMAC_SECRET assinatura do webhook do canal mock (smoke)
set -euo pipefail

ARQUIVO="/srv/secrets/crm-staging.env"

command -v tailscale >/dev/null 2>&1 || { echo "tailscale não encontrado no PATH" >&2; exit 1; }
BIND_IP=$(tailscale ip -4 | head -1)
[ -n "$BIND_IP" ] || { echo "sem IP do Tailscale; o staging não escuta em interface pública" >&2; exit 1; }

hex() { openssl rand -hex "$1"; }
b64() { openssl rand -base64 32; }

JWT_SECRET=$(hex 32)
jwt() {
  # HS256, sem dependência além do Node do repositório.
  node -e '
    const { createHmac } = require("node:crypto");
    const [secret, role] = process.argv.slice(1);
    const b64u = (s) => Buffer.from(s).toString("base64url");
    const iat = Math.floor(Date.now() / 1000);
    const cabecalho = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const corpo = b64u(JSON.stringify({ iss: "supabase-staging", role, iat, exp: iat + 10 * 365 * 24 * 3600 }));
    const assinatura = createHmac("sha256", secret).update(`${cabecalho}.${corpo}`).digest("base64url");
    process.stdout.write(`${cabecalho}.${corpo}.${assinatura}`);
  ' "$JWT_SECRET" "$1"
}

# Idempotente POR CHAVE: variável que já existe nunca é regravada (rotacionar é
# do proprietário); variável nova entra no fim. As chaves JWT dependem do
# JWT_SECRET, então as três só nascem juntas, na primeira vez.
TMP=$(mktemp)
chmod 600 "$TMP"
if [ -f "$ARQUIVO" ]; then
  cat "$ARQUIVO" > "$TMP"
  if grep -qE '^JWT_SECRET=' "$ARQUIVO"; then JWT_SECRET=$(grep -E '^JWT_SECRET=' "$ARQUIVO" | cut -d= -f2-); fi
else
  {
    echo "# crm-staging — segredos do staging do CRM SaaS nesta VPS (F06-T06). Gerado por scripts/staging/secrets.sh em $(date -u +%Y-%m-%dT%H:%M:%SZ)."
    echo "# Nunca em chat, commit ou log. Lido por docker compose --env-file e env_file (compose.staging.yml) e por direnv nos scripts do host."
  } > "$TMP"
fi
garantir() {
  local nome=$1 valor=$2
  grep -qE "^${nome}=" "$TMP" && return 0
  echo "${nome}=${valor}" >> "$TMP"
  echo "    + $nome"
}
garantir STAGING_BIND_IP "$BIND_IP"
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
garantir STAGING_SMOKE_PASSWORD "$(hex 12)"
# Assinatura HMAC do webhook do canal mock (src/channels/mock.ts:94): sem ela o
# adapter responde 503 `sem_credencial` — é o que o smoke exercita.
garantir WHATSAPP_MOCK_HMAC_SECRET "$(hex 24)"

sudo install -o root -g klarosk -m 640 "$TMP" "$ARQUIVO"
rm -f "$TMP"

echo "==> gravado: $ARQUIVO"
while IFS='=' read -r nome valor; do
  case "$nome" in \#*|"") continue ;; esac
  echo "    $nome (${#valor} chars)"
done < "$ARQUIVO"
