#!/usr/bin/env bash
# F07-T03 (§7.8, D36, ADR-029 §4) — "como criar um tenant novo" ao pé da letra,
# no STAGING desta VPS, com um tenant EFÊMERO: cria pelo seed, dá senha aos
# usuários fictícios, roda o smoke só nele, roda o navegador com a organização
# A provisionada do seu seed (`E2E_TENANT`), e o REMOVE — a organização por
# cascata, os usuários do seed por e-mail.
#
# Saída (a linha que o BUILD-STATE cita):
#   <slug>: created=1 smoke=pass=6/6 e2e[<slug>]=41/41 specs=10/10 removed=1 tenants=2
#
# Pré-condições (mesmas do gate dentro do staging, ADR-028 §2): staging de pé
# (`scripts/staging/status.sh`), `.env.e2e` apontado para o staging
# (`scripts/staging/env-e2e.sh`) e `.next` buildado com ele (`pnpm e2e:build`).
# Nada aqui sai para pessoa: WHATSAPP_MODE=mock, AI_PROVIDER=mock.
#
# Uso: bash scripts/verify/tenant-efemero.sh [slug]   (padrão: demo3)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
SLUG="${1:-demo3}"
[[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || { echo "slug inválido: $SLUG" >&2; exit 2; }
SEED="docs/tenants/$SLUG.seed.yaml"
[ -f "$SEED" ] || { echo "seed ausente: $SEED" >&2; exit 2; }
ENV_FILE="${STAGING_ENV_FILE:-/srv/secrets/crm-staging.env}"
[ -r "$ENV_FILE" ] || { echo "$ENV_FILE ilegível" >&2; exit 2; }
ler_env() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
POSTGRES_PASSWORD=$(ler_env POSTGRES_PASSWORD)
STAGING_SMOKE_PASSWORD=$(ler_env STAGING_SMOKE_PASSWORD)
[ -n "$POSTGRES_PASSWORD" ] && [ -n "$STAGING_SMOKE_PASSWORD" ] || { echo "segredos do staging ausentes" >&2; exit 2; }
export SUPABASE_DB_URL="postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:56422/postgres"
export STAGING_SMOKE_PASSWORD
APP_URL="${STAGING_APP_URL:-http://127.0.0.1:3200}"
LOG_DIR="${VERIFY_LOG_DIR:-.verify-logs}/f07-t03-$SLUG-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$LOG_DIR"
echo "[tenant-efemero] evidência em $LOG_DIR" >&2

grep -q "GERADO por scripts/staging/env-e2e.sh" .env.e2e 2>/dev/null || { echo ".env.e2e não é o do staging (rode scripts/staging/env-e2e.sh)" >&2; exit 2; }
[ -f .next/BUILD_ID ] || { echo ".next ausente: rode pnpm e2e:build com o .env.e2e do staging" >&2; exit 2; }

psql_q() { psql "$SUPABASE_DB_URL" -Atc "$1"; }
falhas=0
marco() { echo "[tenant-efemero] $*" >&2; }

# ─── 0. antes: o tenant não existe; conta os que existem ────────────────────
antes=$(psql_q "select count(*) from public.organizations")
ja=$(psql_q "select count(*) from public.organizations where slug = '$SLUG'")
[ "$ja" = 0 ] || { echo "o tenant $SLUG já existe no staging; efêmero tem de nascer aqui" >&2; exit 2; }
marco "tenants antes=$antes"

# ─── 1. criar pelo seed (o caminho de §8.7 §6) ──────────────────────────────
bash scripts/create-tenant.sh "$SEED" >"$LOG_DIR/create-tenant.log" 2>&1
rc=$?; cat "$LOG_DIR/create-tenant.log" >&2
criadas=$(grep -oE "rows_created=[0-9]+" "$LOG_DIR/create-tenant.log" | tail -1 | cut -d= -f2)
created=0; [ "$rc" = 0 ] && [ "${criadas:-0}" -gt 0 ] && created=1
[ "$created" = 1 ] || falhas=$((falhas+1))
bash scripts/staging/seed-users.sh "$SLUG" >"$LOG_DIR/seed-users.log" 2>&1 || falhas=$((falhas+1))
marco "created=$created rows_created=${criadas:-0}"

# ─── 2. smoke SÓ no tenant novo ─────────────────────────────────────────────
SMOKE_TENANTS="$SLUG" bash scripts/smoke.sh "$APP_URL" >"$LOG_DIR/smoke.out" 2>"$LOG_DIR/smoke.err"
smoke_rc=$?
smoke_line=$(grep '^smoke: ' "$LOG_DIR/smoke.out" | tail -1)
smoke_pass=$(echo "$smoke_line" | grep -oE "pass=[0-9]+/[0-9]+" | cut -d= -f2)
[ "$smoke_rc" = 0 ] || falhas=$((falhas+1))
marco "smoke rc=$smoke_rc $smoke_line"

# ─── 3. navegador: o inventário inteiro da F07 com A provisionada do seed ───
mapfile -t SPECS < <(node scripts/verify/f02-e2e.mjs specs F07)
export E2E_TENANT="$SLUG" F02_E2E_SANDBOX_ID=crm-staging E2E_PORT=3202 CI=1 WHATSAPP_MODE=mock AI_PROVIDER=mock
pnpm exec playwright test "${SPECS[@]}" --project=chromium --workers=1 --retries=0 --forbid-only \
  --reporter=json >"$LOG_DIR/e2e-$SLUG.json" 2>"$LOG_DIR/e2e-$SLUG.log"
e2e_rc=$?
read -r e2e_ok e2e_total e2e_specs < <(node -e '
  const r = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  const s = r.stats ?? {}; const files = new Set();
  const visit = (suite) => { for (const spec of suite.specs ?? []) files.add(spec.file); for (const c of suite.suites ?? []) visit(c); };
  for (const suite of r.suites ?? []) visit(suite);
  const total = (s.expected ?? 0) + (s.unexpected ?? 0) + (s.flaky ?? 0) + (s.skipped ?? 0);
  console.log(`${s.expected ?? 0} ${total} ${files.size}`);
' "$LOG_DIR/e2e-$SLUG.json" 2>/dev/null || echo "0 0 0")
[ "$e2e_rc" = 0 ] && [ "$e2e_ok" = "$e2e_total" ] && [ "$e2e_total" -gt 0 ] || falhas=$((falhas+1))
marco "e2e rc=$e2e_rc passed=$e2e_ok/$e2e_total specs=$e2e_specs/${#SPECS[@]}"
unset E2E_TENANT

# ─── 4. remover: organização (cascata) e usuários do seed ───────────────────
emails=$(node -e '
  const {parse} = require("yaml"); const seed = parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  console.log((seed.users ?? []).map((u) => u.email).filter((e) => typeof e === "string" && !e.startsWith("TODO-")).map((e) => `'"'"'${e}'"'"'`).join(","));
' "$SEED")
removed=$(psql_q "with o as (delete from public.organizations where slug = '$SLUG' returning id) select count(*) from o")
usuarios_removidos=$(psql_q "with u as (delete from auth.users where email in ($emails) returning id) select count(*) from u")
replicas=$(psql_q "select count(*) from public.organizations where slug like '$SLUG-e2e-%'")
depois=$(psql_q "select count(*) from public.organizations")
[ "$removed" = 1 ] && [ "$replicas" = 0 ] && [ "$depois" = "$antes" ] || falhas=$((falhas+1))
marco "removed=$removed usuarios_removidos=$usuarios_removidos replicas_restantes=$replicas tenants=$depois"

linha="$SLUG: created=$created smoke=pass=${smoke_pass:-0/0} e2e[$SLUG]=$e2e_ok/$e2e_total specs=$e2e_specs/${#SPECS[@]} removed=$removed tenants=$depois"
echo "$linha" | tee "$LOG_DIR/linha.txt"
echo "$smoke_line" | tee -a "$LOG_DIR/linha.txt"
[ "$falhas" = 0 ] || { echo "[tenant-efemero] falhas=$falhas" >&2; exit 1; }
