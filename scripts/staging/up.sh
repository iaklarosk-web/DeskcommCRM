#!/usr/bin/env bash
# scripts/staging/up.sh — sobe o staging de clone limpo (F06-T06, §7.7).
#
# Ordem (medida na primeira subida — ver docs/ops/staging.md):
#   1. build do app no HOST (`next build`, placeholders de NEXT_PUBLIC_*)
#   2. `.staging/app/` (standalone + static + public) e `.staging/kong.yml`
#   3. camada Supabase: db → auth/rest/storage/realtime/mailpit → kong
#   4. extensões + `supabase/baseline.sql` (idempotente; é o que o self-host aplica)
#   5. seeds dos dois tenants (create-tenant.sh) + usuários do smoke
#   6. produto: app → workers → scheduler
#   7. conferência: serviços `running` = declarados; health do app
#
# Flags: --skip-build   reaproveita .next/ (só quando o build acabou de rodar)
#        --no-seed      não toca em seeds (banco já semeado)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

ENV_FILE="/srv/secrets/crm-staging.env"
COMPOSE=(docker compose -f compose.staging.yml --env-file "$ENV_FILE" -p crm-staging)
DB_PORT=56422
API_PORT=56421
APP_PORT=3200
SKIP_BUILD=0; NO_SEED=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --no-seed) NO_SEED=1 ;;
    *) echo "flag desconhecida: $arg" >&2; exit 2 ;;
  esac
done

[ -r "$ENV_FILE" ] || { echo "==> $ENV_FILE ausente ou ilegível; rode scripts/staging/secrets.sh" >&2; exit 1; }
# Só as variáveis que os passos do host precisam; o compose lê o arquivo sozinho.
ler_env() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
POSTGRES_PASSWORD=$(ler_env POSTGRES_PASSWORD)
ANON_KEY=$(ler_env ANON_KEY)
SERVICE_ROLE_KEY=$(ler_env SERVICE_ROLE_KEY)
BIND_IP=$(ler_env STAGING_BIND_IP)
SMOKE_PASSWORD=$(ler_env STAGING_SMOKE_PASSWORD)
for v in POSTGRES_PASSWORD ANON_KEY SERVICE_ROLE_KEY BIND_IP SMOKE_PASSWORD; do
  [ -n "${!v}" ] || { echo "==> $v vazio em $ENV_FILE" >&2; exit 1; }
done
DB_URL="postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${DB_PORT}/postgres"
MARCADOR_FICCAO="crm-staging-fictional-fixtures"
INICIO=$(date +%s)
marco() { echo "==> [$(( $(date +%s) - INICIO ))s] $*"; }

# ─── 1. build do app no host ────────────────────────────────────────────────
if [ "$SKIP_BUILD" = 0 ]; then
  marco "next build no host (placeholders de NEXT_PUBLIC_*, como o Dockerfile)"
  NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key \
  NEXT_PUBLIC_APP_URL=https://placeholder.invalid \
  NEXT_PUBLIC_ADMIN_URL=https://placeholder.invalid \
  NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 SENTRY_DSN=off \
  NODE_OPTIONS=--max-old-space-size=4096 \
    pnpm build >.staging-build.log 2>&1 || { tail -40 .staging-build.log >&2; exit 1; }
  mv .staging-build.log .verify-logs/staging-build.log 2>/dev/null || true
fi
[ -f .next/standalone/server.js ] || { echo "==> .next/standalone/server.js ausente: o build não gerou standalone" >&2; exit 1; }

# ─── 2. contexto do app e kong.yml ───────────────────────────────────────────
marco "montando .staging/app e .staging/kong.yml"
rm -rf .staging/app && mkdir -p .staging/app
cp -r .next/standalone .staging/app/standalone
cp -r .next/static .staging/app/static
cp -r public .staging/app/public
cp scripts/staging/Dockerfile.staging .staging/app/Dockerfile.staging
sed -e "s|__ANON_KEY__|$ANON_KEY|" -e "s|__SERVICE_KEY__|$SERVICE_ROLE_KEY|" \
  scripts/staging/kong.template.yml > .staging/kong.yml
# O kong roda como usuário próprio dentro do container: o arquivo precisa ser
# legível; quem esconde as chaves de outros usuários da VPS é a pasta (700).
chmod 700 .staging && chmod 644 .staging/kong.yml

# ─── 3. camada Supabase ──────────────────────────────────────────────────────
marco "subindo a camada Supabase (db, auth, rest, storage, realtime, mailpit, kong)"
"${COMPOSE[@]}" up -d --no-build db
for i in $(seq 1 60); do
  if PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p "$DB_PORT" -U postgres -d postgres -Atc "select 1" >/dev/null 2>&1; then break; fi
  sleep 2
  [ "$i" = 60 ] && { echo "==> db não respondeu em 120 s" >&2; exit 1; }
done
"${COMPOSE[@]}" up -d --no-build auth rest storage realtime mailpit
marco "esperando as migrations do GoTrue (auth.users) e do Storage (storage.buckets)"
for i in $(seq 1 90); do
  ok=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p "$DB_PORT" -U postgres -d postgres -Atc \
    "select count(*) from information_schema.tables where (table_schema,table_name) in (('auth','users'),('storage','buckets'))" 2>/dev/null || echo 0)
  [ "$ok" = 2 ] && break
  sleep 2
  [ "$i" = 90 ] && { echo "==> auth/storage não migraram em 180 s" >&2; "${COMPOSE[@]}" logs --tail=30 auth storage >&2; exit 1; }
done
"${COMPOSE[@]}" up -d --no-build kong
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${API_PORT}/auth/v1/health" -H "apikey: $ANON_KEY"; then break; fi
  sleep 2
  [ "$i" = 30 ] && { echo "==> kong/auth não responderam em 60 s" >&2; exit 1; }
done

# ─── 4. extensões + baseline ─────────────────────────────────────────────────
marco "extensões que o baseline referencia e não cria (mesma lista de scripts/test-db.sh)"
PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p "$DB_PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema public;
create extension if not exists citext with schema public;
create extension if not exists pg_trgm with schema public;
SQL
marco "aplicando supabase/baseline.sql (idempotente)"
mkdir -p .verify-logs
PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p "$DB_PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
  -f supabase/baseline.sql > .verify-logs/staging-baseline.log 2>&1 || { tail -20 .verify-logs/staging-baseline.log >&2; exit 1; }
TABELAS=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p "$DB_PORT" -U postgres -d postgres -Atc \
  "select count(*) from pg_tables where schemaname='public'")
marco "baseline aplicado: tabelas em public = $TABELAS"
# O realtime nasceu antes da publication que o baseline cria: reinicia para ele vê-la.
"${COMPOSE[@]}" restart realtime >/dev/null

# ─── 5. seeds ────────────────────────────────────────────────────────────────
if [ "$NO_SEED" = 0 ]; then
  marco "seeds: deka e demo2 (scripts/create-tenant.sh, idempotente)"
  SUPABASE_DB_URL="$DB_URL" bash scripts/create-tenant.sh docs/tenants/deka.seed.yaml
  # demo2 leva as fixtures FICTÍCIAS da F02 (contatos, empresas, produtos,
  # pedidos): o create-tenant.ts pula os blocos customers/products do seed
  # ("entra na fase que adapta a tabela"), e sem linha nenhuma o smoke não
  # teria número a comparar. O marcador no banco é a guarda do escritor de
  # fixtures (G-41: só escreve em banco marcado como sandbox de ficção) — o
  # staging É esse banco.
  # `postgres` não é superusuário na imagem do Supabase; quem altera parâmetro
  # do banco é `supabase_admin` (mesma senha).
  PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p "$DB_PORT" -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qc \
    "alter database postgres set \"crm.fictional_fixture_sandbox\" = '$MARCADOR_FICCAO'"
  SUPABASE_DB_URL="$DB_URL" bash scripts/create-tenant.sh docs/tenants/demo2.seed.yaml \
    --fictional-fixtures docs/tenants/demo2.f02-fixtures.yaml --sandbox-marker "$MARCADOR_FICCAO"
  marco "usuários do smoke (senha do env, bcrypt no auth.users, confirmados)"
  SUPABASE_DB_URL="$DB_URL" STAGING_SMOKE_PASSWORD="$SMOKE_PASSWORD" bash scripts/staging/seed-users.sh
fi

# ─── 6. produto ──────────────────────────────────────────────────────────────
marco "build das imagens do produto (app fino, worker, scheduler) e subida"
"${COMPOSE[@]}" build app worker scheduler > .verify-logs/staging-images.log 2>&1 || { tail -40 .verify-logs/staging-images.log >&2; exit 1; }
# A árvore do build já virou imagem: fora do disco, para que vitest/eslint/tsc
# não a encontrem (o standalone traz uma cópia de tests/).
rm -rf .staging/app
"${COMPOSE[@]}" up -d --no-build redis srh waha-mock app worker worker-saida worker-lembrete scheduler
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${APP_PORT}/api/v1/health"; then break; fi
  sleep 3
  [ "$i" = 60 ] && { echo "==> app não respondeu /api/v1/health em 180 s" >&2; "${COMPOSE[@]}" logs --tail=40 app >&2; exit 1; }
done

# ─── 7. conferência (§7.7 T06) ───────────────────────────────────────────────
DECLARADOS=$("${COMPOSE[@]}" config --services | wc -l)
RODANDO=$("${COMPOSE[@]}" ps --format json | node -e '
  let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
    const linhas=d.trim().split("\n").filter(Boolean).map(l=>JSON.parse(l));
    const itens=Array.isArray(linhas[0])?linhas[0]:linhas;
    process.stdout.write(String(itens.filter(x=>x.State==="running").length));
  })')
marco "docker compose ps: running=$RODANDO/$DECLARADOS declarados"
echo "==> app:      http://${BIND_IP}:${APP_PORT}  (e http://127.0.0.1:${APP_PORT} nesta máquina)"
echo "==> supabase: http://${BIND_IP}:${API_PORT}  db 127.0.0.1:${DB_PORT}  mailpit http://${BIND_IP}:56424"
echo "==> nada publicado na interface pública: ss -ltn | grep -E ':(3200|5642[124])' abaixo mostra só 127.0.0.1 e ${BIND_IP}"
ss -ltn | grep -E ":(3200|5642[124]) " | awk '{print "    " $4}'
[ "$RODANDO" = "$DECLARADOS" ] || { echo "==> serviços fora de running:" >&2; "${COMPOSE[@]}" ps >&2; exit 1; }
