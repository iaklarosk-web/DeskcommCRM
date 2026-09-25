#!/usr/bin/env bash
# scripts/prod/up.sh — sobe a PRODUÇÃO INICIAL de clone limpo (F08-T02, ADR-032).
#
# A receita de scripts/staging/up.sh, menos o que produção não tem: NENHUM
# seed (não há tenant fictício em produção), nenhum usuário de smoke, nenhum
# marcador de ficção no banco. O platform_admin real nasce em
# scripts/prod/bootstrap-owner.sh (F08-T04), depois desta subida.
#
# Ordem:
#   1. build do app no HOST (`next build`, placeholders de NEXT_PUBLIC_*)
#   2. `.prod/app/` (standalone + static + public) e `.prod/kong.yml`
#   3. camada Supabase: db → auth/rest/storage/realtime → kong
#   4. extensões + `supabase/baseline.sql` (idempotente)
#   5. produto: redis/srh/waha → app → workers → scheduler
#   6. conferência: serviços `running` = declarados; health do app; portas
#
# Flags: --skip-build   reaproveita .next/ (só quando o build acabou de rodar)
# Re-executável: baseline idempotente, volumes preservados, imagens rebuildadas.
source "$(dirname "$0")/_env.sh"
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    *) echo "flag desconhecida: $arg" >&2; exit 2 ;;
  esac
done
POSTGRES_PASSWORD=$(prod_env POSTGRES_PASSWORD)
ANON_KEY=$(prod_env ANON_KEY)
SERVICE_ROLE_KEY=$(prod_env SERVICE_ROLE_KEY)
BIND_IP=$(prod_env PROD_BIND_IP)
APP_URL=$(prod_env NEXT_PUBLIC_APP_URL)
for v in POSTGRES_PASSWORD ANON_KEY SERVICE_ROLE_KEY BIND_IP APP_URL; do
  [ -n "${!v}" ] || { echo "==> $v vazio em $PROD_ENV_FILE (rode scripts/prod/secrets.sh)" >&2; exit 1; }
done
DB_URL=$(prod_db_url)
INICIO=$(date +%s)
marco() { echo "==> [$(( $(date +%s) - INICIO ))s] $*"; }
mkdir -p .verify-logs

# ─── 1. build do app no host ────────────────────────────────────────────────
if [ "$SKIP_BUILD" = 0 ]; then
  marco "next build no host (placeholders de NEXT_PUBLIC_*, como o Dockerfile)"
  NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key \
  NEXT_PUBLIC_APP_URL=https://placeholder.invalid \
  NEXT_PUBLIC_ADMIN_URL=https://placeholder.invalid \
  NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 SENTRY_DSN=off \
  NODE_OPTIONS=--max-old-space-size=4096 \
    pnpm build >.verify-logs/prod-build.log 2>&1 || { tail -40 .verify-logs/prod-build.log >&2; exit 1; }
fi
[ -f .next/standalone/server.js ] || { echo "==> .next/standalone/server.js ausente: o build não gerou standalone" >&2; exit 1; }

# ─── 2. contexto do app e kong.yml ───────────────────────────────────────────
marco "montando .prod/app e .prod/kong.yml"
rm -rf .prod/app && mkdir -p .prod/app
cp -r .next/standalone .prod/app/standalone
cp -r .next/static .prod/app/static
cp -r public .prod/app/public
cp scripts/staging/Dockerfile.staging .prod/app/Dockerfile.staging
# F19-T06: carimbo do commit que ESTÁ sendo empacotado. `prova.sh` lê este
# arquivo DE DENTRO do container — antes ele imprimia o HEAD da árvore, e uma
# prova rodada depois de novos commits jurava um deploy que não houve.
# O Dockerfile copia `standalone/` para `/app`, então o carimbo entra ali e a
# prova o lê em `/app/COMMIT` dentro do container.
git rev-parse --short HEAD > .prod/app/standalone/COMMIT
sed -e "s|__ANON_KEY__|$ANON_KEY|" -e "s|__SERVICE_KEY__|$SERVICE_ROLE_KEY|" \
  scripts/staging/kong.template.yml > .prod/kong.yml
chmod 700 .prod && chmod 644 .prod/kong.yml

# ─── 3. camada Supabase ──────────────────────────────────────────────────────
marco "subindo a camada Supabase (db, auth, rest, storage, realtime, kong)"
"${PROD_COMPOSE[@]}" up -d --no-build db
for i in $(seq 1 60); do
  if PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p "$PROD_DB_PORT" -U postgres -d postgres -Atc "select 1" >/dev/null 2>&1; then break; fi
  sleep 2
  [ "$i" = 60 ] && { echo "==> db não respondeu em 120 s" >&2; exit 1; }
done
"${PROD_COMPOSE[@]}" up -d --no-build auth rest storage realtime
marco "esperando as migrations do GoTrue (auth.users) e do Storage (storage.buckets)"
for i in $(seq 1 90); do
  ok=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p "$PROD_DB_PORT" -U postgres -d postgres -Atc \
    "select count(*) from information_schema.tables where (table_schema,table_name) in (('auth','users'),('storage','buckets'))" 2>/dev/null || echo 0)
  [ "$ok" = 2 ] && break
  sleep 2
  [ "$i" = 90 ] && { echo "==> auth/storage não migraram em 180 s" >&2; "${PROD_COMPOSE[@]}" logs --tail=30 auth storage >&2; exit 1; }
done
"${PROD_COMPOSE[@]}" up -d --no-build kong
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PROD_API_PORT}/auth/v1/health" -H "apikey: $ANON_KEY"; then break; fi
  sleep 2
  [ "$i" = 30 ] && { echo "==> kong/auth não responderam em 60 s" >&2; exit 1; }
done

# ─── 4. extensões + baseline ─────────────────────────────────────────────────
marco "extensões que o baseline referencia e não cria (mesma lista de scripts/test-db.sh)"
PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p "$PROD_DB_PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema public;
create extension if not exists citext with schema public;
create extension if not exists pg_trgm with schema public;
SQL
marco "aplicando supabase/baseline.sql (idempotente)"
PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p "$PROD_DB_PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
  -f supabase/baseline.sql > .verify-logs/prod-baseline.log 2>&1 || { tail -20 .verify-logs/prod-baseline.log >&2; exit 1; }
TABELAS=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p "$PROD_DB_PORT" -U postgres -d postgres -Atc \
  "select count(*) from pg_tables where schemaname='public'")
marco "baseline aplicado: tabelas em public = $TABELAS"
"${PROD_COMPOSE[@]}" restart realtime >/dev/null

# ─── 5. produto ──────────────────────────────────────────────────────────────
marco "build das imagens do produto (app fino, worker, scheduler) e subida"
"${PROD_COMPOSE[@]}" build app worker scheduler > .verify-logs/prod-images.log 2>&1 || { tail -40 .verify-logs/prod-images.log >&2; exit 1; }
rm -rf .prod/app
"${PROD_COMPOSE[@]}" up -d --no-build redis srh waha app worker worker-saida worker-lembrete scheduler
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PROD_APP_PORT}/api/v1/health"; then break; fi
  sleep 3
  [ "$i" = 60 ] && { echo "==> app não respondeu /api/v1/health em 180 s" >&2; "${PROD_COMPOSE[@]}" logs --tail=40 app >&2; exit 1; }
done

# ─── 6. conferência ──────────────────────────────────────────────────────────
DECLARADOS=$("${PROD_COMPOSE[@]}" config --services | wc -l)
RODANDO=$("${PROD_COMPOSE[@]}" ps --format json | node -e '
  let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
    const linhas=d.trim().split("\n").filter(Boolean).map(l=>JSON.parse(l));
    const itens=Array.isArray(linhas[0])?linhas[0]:linhas;
    process.stdout.write(String(itens.filter(x=>x.State==="running").length));
  })')
marco "docker compose ps: running=$RODANDO/$DECLARADOS declarados"
echo "==> app:      $APP_URL (pelo Caddy do host, F08-T03) — e http://127.0.0.1:${PROD_APP_PORT} nesta máquina"
echo "==> supabase: kong 127.0.0.1:${PROD_API_PORT}  db 127.0.0.1:${PROD_DB_PORT}  (e no IP do Tailscale ${BIND_IP})"
echo "==> nada publicado na interface pública: ss -ltn abaixo mostra só 127.0.0.1 e ${BIND_IP}"
ss -ltn | grep -E ":(3300|5643[12]) " | awk '{print "    " $4}'
[ "$RODANDO" = "$DECLARADOS" ] || { echo "==> serviços fora de running:" >&2; "${PROD_COMPOSE[@]}" ps >&2; exit 1; }
