#!/usr/bin/env bash
# ADR-007: phase readiness and explicit revalidation are different verdicts.
# New gate tests use local files/processes; existing DB runners provision their
# own disposable Postgres. E2E remains pending in this F01 verifier.
set -uo pipefail
ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$ROOT" || exit 1
REVALIDATE=()
if [ "$#" -gt 0 ]; then
  if [ "$#" != 2 ] || [ "$1" != --revalidate ]; then
    echo 'Uso: ./scripts/verify.sh [--revalidate F01]' >&2
    exit 2
  fi
  REVALIDATE=("$2")
fi
# Validate the requested completed phase before any expensive command.
node scripts/verify/report.mjs context "$ROOT" - "${REVALIDATE[@]}" >/dev/null || exit 1
export WHATSAPP_MODE=mock AI_PROVIDER=mock CI=1
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
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
suite() {
  local name=$1 script=$2
  step "$name" pnpm "$script" --maxWorkers=1 --allowOnly=false \
    --reporter=default --reporter="$ROOT/scripts/verify/reporter.mjs" \
    --outputFile="$LOG_DIR/$name.json"
}

step typecheck pnpm typecheck
step lint pnpm lint
step build pnpm build
step shell pnpm test:shell
suite unit test:unit
suite integration test:integration
suite db test:db
step secrets bash scripts/scan-secrets.sh

# Each mutant receives its own metrics path; healthy metrics are never replaced.
Q=0; K=0
for mutant in tests/mutants/*.sh; do
  [ -f "$mutant" ] || continue
  Q=$((Q+1))
  name=$(basename "$mutant" .sh)
  mkdir -p "$LOG_DIR/mutants/$name"
  if VERIFY_LOG_DIR="$LOG_DIR/mutants/$name" bash "$mutant" >"$LOG_DIR/mutants/$name.log" 2>&1; then
    K=$((K+1))
  fi
done
echo "$K/$Q" >"$LOG_DIR/mutants.count"
node scripts/verify/report.mjs report "$ROOT" "$LOG_DIR" "${REVALIDATE[@]}"
