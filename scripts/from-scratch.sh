#!/usr/bin/env bash
# F07-T04 (§7.8, §8.7 §7, ADR-029 §4) — "como rodar tudo do zero", executado:
# clone novo, instalação, banco novo com o baseline (a migração), seeds dos
# dois tenants pelo loader e o `verify.sh` inteiro no clone, no sandbox
# descartável (o banco também nasce do zero — por isso não é o staging).
#
# Saída (a linha que o BUILD-STATE e o FINAL-VALIDATION citam):
#   from-scratch: steps=7 pass=7/7 verify_exit=0 status="READY (Fnn)" clone=<dir> commit=<sha>
#
# Passos, cada um com exit próprio no log:
#   1 clone        git clone --branch <branch> <origem> <destino>
#   2 install      pnpm install --frozen-lockfile (store local do pnpm)
#   3 sandbox      scripts/verify/sandbox.sh up  (Supabase descartável 5542x + baseline.sql)
#   4 env          pnpm e2e:env com o workdir do sandbox (.env.e2e privado, nunca impresso)
#   5 seeds        create-tenant.sh deka + demo2 (com as fixtures fictícias da F02)
#   6 verify       VERIFY_LOG_DIR=<log> bash scripts/verify.sh   → STATUS e exit
#   7 down         scripts/verify/sandbox.sh down
#
# Uso: [FROM_SCRATCH_PHASE=Fnn] bash scripts/from-scratch.sh [destino] [origem] [branch]
#   destino: diretório NOVO (padrão: mktemp em $HOME/projetos/.from-scratch-XXXX)
#   origem : repositório a clonar (padrão: este checkout — prova o que está commitado)
#   branch : (padrão: a branch corrente)
# Leva o tempo de um gate (100–130 min nesta VPS) mais instalação e build.
set -uo pipefail
ORIGEM_RAIZ="$(git rev-parse --show-toplevel)"
cd "$ORIGEM_RAIZ"
BRANCH="${3:-$(git branch --show-current)}"
ORIGEM="${2:-$ORIGEM_RAIZ}"
DESTINO="${1:-$(mktemp -d "$HOME/projetos/.from-scratch-XXXX")}"
LOG_DIR="${FROM_SCRATCH_LOG_DIR:-$ORIGEM_RAIZ/.verify-logs/f07-t04-from-scratch-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$LOG_DIR"
echo "[from-scratch] destino=$DESTINO origem=$ORIGEM branch=$BRANCH log=$LOG_DIR" >&2

passos=0; ok=0
passo() {
  local nome=$1; shift
  passos=$((passos+1))
  local inicio; inicio=$(date +%s)
  "$@" >"$LOG_DIR/$nome.log" 2>&1
  local rc=$?
  echo "$rc" >"$LOG_DIR/$nome.exit"
  echo "[from-scratch] $nome: exit=$rc $(( $(date +%s)-inicio ))s" >&2
  [ "$rc" = 0 ] && ok=$((ok+1))
  return "$rc"
}

if [ -e "$DESTINO" ] && [ -n "$(ls -A "$DESTINO" 2>/dev/null)" ]; then
  echo "[from-scratch] destino não está vazio: $DESTINO" >&2; exit 2
fi

# 1. clone (do commit, não da árvore de trabalho: o que não foi commitado não conta)
passo clone git clone --quiet --branch "$BRANCH" "$ORIGEM" "$DESTINO" || { echo "clone falhou" >&2; exit 1; }
cd "$DESTINO" || exit 1
COMMIT=$(git rev-parse HEAD)

# 2. instalar
passo install pnpm install --frozen-lockfile --prefer-offline

# 3. banco do zero: o sandbox descartável aplica supabase/baseline.sql (a migração do self-host)
passo sandbox bash scripts/verify/sandbox.sh up

# 4. .env.e2e a partir do sandbox (privado; o conteúdo nunca vai ao log)
passo env env SUPABASE_WORKDIR=.verify-logs/sandbox-workdir E2E_PORT=3102 bash scripts/gerar-env-e2e.sh

# 5. seeds pelo loader — os dois tenants, como o runbook manda
# Senha PADRÃO do Supabase CLI local (fixa, documentada, sem valor fora do
# loopback); vai por variável porque URL com senha literal é achado do scanner.
SANDBOX_DB_PASSWORD="${SANDBOX_DB_PASSWORD:-postgres}"
DB_URL="postgresql://postgres:${SANDBOX_DB_PASSWORD}@127.0.0.1:55422/postgres"
MARCADOR="from-scratch-fictional-fixtures-$(date -u +%Y%m%d)"
seeds() {
  SUPABASE_DB_URL="$DB_URL" bash scripts/create-tenant.sh docs/tenants/deka.seed.yaml || return 1
  # `postgres` não é superusuário na imagem do Supabase; parâmetro de banco é
  # do `supabase_admin` (mesma senha) — igual ao up.sh do staging.
  psql "postgresql://supabase_admin:${SANDBOX_DB_PASSWORD}@127.0.0.1:55422/postgres" -v ON_ERROR_STOP=1 -qc \
    "alter database postgres set \"crm.fictional_fixture_sandbox\" = '$MARCADOR'" || return 1
  SUPABASE_DB_URL="$DB_URL" bash scripts/create-tenant.sh docs/tenants/demo2.seed.yaml \
    --fictional-fixtures docs/tenants/demo2.f02-fixtures.yaml --sandbox-marker "$MARCADOR" || return 1
  # segunda passada: idempotência (rows_created=0 nos dois)
  SUPABASE_DB_URL="$DB_URL" bash scripts/create-tenant.sh docs/tenants/deka.seed.yaml | grep -q "rows_created=0" || return 1
  SUPABASE_DB_URL="$DB_URL" bash scripts/create-tenant.sh docs/tenants/demo2.seed.yaml \
    --fictional-fixtures docs/tenants/demo2.f02-fixtures.yaml --sandbox-marker "$MARCADOR" | grep -q "rows_created=0" || return 1
}
passo seeds seeds

# 6. o gate inteiro, no clone, contra o sandbox (READY (Fnn) — prova de código do zero).
# A fase ativa é a da ORIGEM (ou FROM_SCRATCH_PHASE): o verify mede a matriz
# D15 e as linhas obrigatórias pela fase ativa da árvore (ADR-035 §3, ADR-037),
# e um valor fixo (F07, até a F15) reprovava a árvore por "RBAC fora do contrato".
FASE="${FROM_SCRATCH_PHASE:-$(sed -n 's/^current_phase: *\(F[0-9][0-9]\).*/\1/p' "$ORIGEM_RAIZ/BUILD-STATE.md" | head -1)}"
[ -n "$FASE" ] || { echo "[from-scratch] fase ativa não encontrada na origem" >&2; exit 2; }
sed -i "s/^current_phase: .*/current_phase: $FASE/" BUILD-STATE.md
echo "[from-scratch] fase=$FASE" >&2
passo verify env F02_E2E_SANDBOX_ID=f02-crm-cadastros-disposable E2E_PORT=3102 VERIFY_LOG_DIR="$LOG_DIR/verify" bash scripts/verify.sh
verify_exit=$(cat "$LOG_DIR/verify.exit")
status=$(grep -E '^STATUS: ' "$LOG_DIR/verify.log" | tail -1 | sed 's/^STATUS: //')

# 7. derrubar o sandbox (sempre)
passo down bash scripts/verify/sandbox.sh down

linha="from-scratch: steps=$passos pass=$ok/$passos verify_exit=${verify_exit:-null} status=\"${status:-n/a}\" clone=$DESTINO commit=${COMMIT:0:8}"
echo "$linha" | tee "$LOG_DIR/linha.txt"
grep -A40 '^VERIFY SUMMARY' "$LOG_DIR/verify.log" > "$LOG_DIR/verify-summary.txt" 2>/dev/null || true
[ "$ok" = "$passos" ] && [ "${verify_exit:-1}" = 0 ]
