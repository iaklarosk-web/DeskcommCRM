#!/usr/bin/env bash
# ADR-007: phase readiness and explicit revalidation are different verdicts.
# New gate tests use local files/processes; existing DB runners provision their
# own disposable Postgres. F02 adds a closed, disposable Playwright run.
set -uo pipefail
ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$ROOT" || exit 1
REVALIDATE=()
if [ "$#" -gt 0 ]; then
  if [ "$#" != 2 ] || [ "$1" != --revalidate ]; then
    echo 'Uso: ./scripts/verify.sh [--revalidate Fnn]' >&2
    exit 2
  fi
  REVALIDATE=("$2")
fi
# Validate the requested completed phase before any expensive command.
CONTEXT=$(node scripts/verify/report.mjs context "$ROOT" - "${REVALIDATE[@]}") || exit 1
PHASE=$(node -e 'const value=JSON.parse(process.argv[1]); if(!/^F\d{2}$/.test(value.phase)) process.exit(1); process.stdout.write(value.phase)' "$CONTEXT") || exit 1
# ADR-018: F03 herda integralmente os controles fechados da F02.
# ADR-018: EXPECTED_SPECS é uma segunda afirmação INDEPENDENTE do inventário.
# Se o módulo de specs for corrompido ou truncado, os dois números divergem e
# o gate recusa — que era exatamente o papel do "!= 7" da v1.
case "$PHASE" in
  F02) CLOSED_E2E=1; EXPECTED_SPECS=7 ;;
  F03) CLOSED_E2E=1; EXPECTED_SPECS=8 ;;
  F04) CLOSED_E2E=1; EXPECTED_SPECS=9 ;;
  *)   CLOSED_E2E=0; EXPECTED_SPECS=0 ;;
esac
export WHATSAPP_MODE=mock AI_PROVIDER=mock CI=1
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=3072}"
export VITEST_MAX_THREADS=1 VITEST_MAX_FORKS=1
LOG_BASE=$(node -e 'process.stdout.write(require("node:path").resolve(process.argv[1]))' "${VERIFY_LOG_DIR:-.verify-logs}") || exit 1
mkdir -p "$LOG_BASE" || exit 1
# Fresh run directory: no recursive delete of a caller-controlled path, no stale
# evidence from a previous run, no collision with another worktree/run.
LOG_DIR=$(mktemp -d "$LOG_BASE/run.XXXXXXXX") || exit 1
export VERIFY_LOG_DIR="$LOG_DIR"
mkdir -p "$LOG_DIR/metrics" "$LOG_DIR/mutants"
echo "[verify] evidence=$LOG_DIR" >&2

step() {
  local name=$1; shift
  local started; started=$(date +%s)
  "$@" >"$LOG_DIR/$name.log" 2>&1
  local result=$?
  echo "$result" >"$LOG_DIR/$name.exit"
  echo "[verify] $name: exit=$result $(( $(date +%s)-started ))s" >&2
  return "$result"
}
skip_step() {
  local name=$1 reason=$2
  echo 125 >"$LOG_DIR/$name.exit"
  echo "[verify] recusado: $reason" >"$LOG_DIR/$name.log"
  echo "[verify] $name: não executado ($reason)" >&2
}
suite() {
  local name=$1 script=$2
  if [ "$CLOSED_E2E" = 1 ] && { [ "$name" = unit ] || [ "$name" = db ] || [ "$name" = integration ]; }; then
    step "$name" env NODE_OPTIONS=--max-old-space-size=1536 pnpm "$script" --maxWorkers=1 --allowOnly=false \
      --reporter=default --reporter="$ROOT/scripts/verify/reporter.mjs" \
      --outputFile="$LOG_DIR/$name.json"
  else
    step "$name" pnpm "$script" --maxWorkers=1 --allowOnly=false \
      --reporter=default --reporter="$ROOT/scripts/verify/reporter.mjs" \
      --outputFile="$LOG_DIR/$name.json"
  fi
}
e2e_suite() {
  local name=$1; shift
  local started; started=$(date +%s)
  pnpm exec playwright test "$@" --project=chromium --workers=1 --retries=0 \
    --forbid-only --reporter=json >"$LOG_DIR/$name.json" 2>"$LOG_DIR/$name.log"
  local result=$?
  echo "$result" >"$LOG_DIR/$name.exit"
  echo "[verify] $name: exit=$result $(( $(date +%s)-started ))s" >&2
  return "$result"
}

F02_SANDBOX_OK=0
F02_INPUTS_OK=0
if [ "$CLOSED_E2E" = 1 ]; then
  if step inputs-before node scripts/verify/f02-e2e.mjs snapshot "$ROOT" "$LOG_DIR/inputs-before.json"; then
    F02_INPUTS_OK=1
  fi
  if step sandbox node scripts/verify/f02-e2e.mjs environment "$ROOT" "$LOG_DIR/sandbox.json"; then
    F02_SANDBOX_OK=1
  fi
fi

step typecheck pnpm typecheck
step lint pnpm lint
if [ "$CLOSED_E2E" = 1 ]; then
  if [ "$F02_SANDBOX_OK" = 1 ] && [ "$F02_INPUTS_OK" = 1 ]; then
    step build pnpm e2e:build
  else
    skip_step build "sandbox F02 inválido"
  fi
else
  step build pnpm build
fi
step shell pnpm test:shell
suite unit test:unit
suite integration test:integration
suite db test:db
step secrets bash scripts/scan-secrets.sh

if [ "$CLOSED_E2E" = 1 ]; then
  mapfile -t F02_SPECS < <(node scripts/verify/f02-e2e.mjs specs "$PHASE")
  if [ "$F02_SANDBOX_OK" != 1 ] || [ "$(cat "$LOG_DIR/build.exit")" != 0 ]; then
    skip_step e2e-plan "sandbox ou build F02 falhou"
    skip_step e2e "inventário E2E indisponível"
  elif [ "${#F02_SPECS[@]}" != "$EXPECTED_SPECS" ]; then
    skip_step e2e-plan "manifesto F02 inválido"
    skip_step e2e "inventário E2E indisponível"
  elif e2e_suite e2e-plan "${F02_SPECS[@]}" --list; then
    e2e_suite e2e "${F02_SPECS[@]}"
  else
    skip_step e2e "inventário E2E falhou"
  fi
fi

# Each mutant receives its own metrics path; healthy metrics are never replaced.
Q=0; K=0
for mutant in tests/mutants/*.sh; do
  [ -f "$mutant" ] || continue
  Q=$((Q+1))
  name=$(basename "$mutant" .sh)
  mkdir -p "$LOG_DIR/mutants/$name"
  if VERIFY_LOG_DIR="$LOG_DIR/mutants/$name" pnpm exec bash "$mutant" >"$LOG_DIR/mutants/$name.log" 2>&1; then
    K=$((K+1))
  fi
done
echo "$K/$Q" >"$LOG_DIR/mutants.count"
if [ "$CLOSED_E2E" = 1 ]; then
  if [ "$F02_INPUTS_OK" = 1 ]; then
    step inputs node scripts/verify/f02-e2e.mjs compare "$ROOT" "$LOG_DIR/inputs.json" "$LOG_DIR/inputs-before.json"
  else
    skip_step inputs "snapshot inicial dos inputs ausente"
  fi
fi
node scripts/verify/report.mjs report "$ROOT" "$LOG_DIR" "${REVALIDATE[@]}"
