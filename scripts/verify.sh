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
  F05) CLOSED_E2E=1; EXPECTED_SPECS=10 ;;
  F06) CLOSED_E2E=1; EXPECTED_SPECS=10 ;;   # ADR-028: sem tela nova, inventário de F05
  # ADR-029: F07 roda o navegador DUAS vezes na mesma árvore, uma por tenant do
  # seed (`E2E_TENANT`), e mede `src_diff_lines` entre elas (§8.3).
  F07) CLOSED_E2E=1; EXPECTED_SPECS=10; REPLICABILITY_TENANTS="deka,demo2" ;;
  # ADR-031: F11 (+1 spec) e F12 (+1 spec) fecham juntas; cada uma roda o
  # navegador por tenant do seed como a F07 e mede `admin`/`billing`.
  F11) CLOSED_E2E=1; EXPECTED_SPECS=11; REPLICABILITY_TENANTS="deka,demo2" ;;
  F12) CLOSED_E2E=1; EXPECTED_SPECS=12; REPLICABILITY_TENANTS="deka,demo2" ;;
  # ADR-033: F08 (produção inicial) roda o inventário de F12; a prova de
  # produção é a linha `prod:` fora do bloco (scripts/prod/prova.sh).
  F08) CLOSED_E2E=1; EXPECTED_SPECS=12; REPLICABILITY_TENANTS="deka,demo2" ;;
  # ADR-035: F13 (CRM comercial) acrescenta a spec f13-crm-comercial (+7
  # testes) ao inventário de F12 e mede a linha `crm:`.
  F13) CLOSED_E2E=1; EXPECTED_SPECS=13; REPLICABILITY_TENANTS="deka,demo2" ;;
  # ADR-037: F15 (automação/autonomia) acrescenta a spec f15-automacao-e-autonomia
  # (+7 testes) ao inventário de F13 e mede a linha `autonomy:`.
  F15) CLOSED_E2E=1; EXPECTED_SPECS=14; REPLICABILITY_TENANTS="deka,demo2" ;;
  # ADR-039: F14 (chat do site, agenda, canais) fecha DEPOIS da F15 e acrescenta
  # a spec f14-canais-e-agenda (+7 testes) ao inventário de F15; mede `channels:`.
  F14) CLOSED_E2E=1; EXPECTED_SPECS=15; REPLICABILITY_TENANTS="deka,demo2" ;;
  F18) CLOSED_E2E=1; EXPECTED_SPECS=16; REPLICABILITY_TENANTS="deka,demo2" ;;
  # ADR-043: F19 (cobrança real por Stripe + padrão KN do /admin) fecha DEPOIS da
  # F18 e acrescenta a spec f19-cobranca-stripe (+7 testes) ao inventário de F18;
  # mede a linha `stripe:`.
  F19) CLOSED_E2E=1; EXPECTED_SPECS=17; REPLICABILITY_TENANTS="deka,demo2" ;;
  F20) CLOSED_E2E=1; EXPECTED_SPECS=18; REPLICABILITY_TENANTS="deka,demo2" ;;
  F21) CLOSED_E2E=1; EXPECTED_SPECS=19; REPLICABILITY_TENANTS="deka,demo2" ;;
  # ADR-050: F24 (Suporte KN) não cria tela; inventário de F21 (como F06/ADR-028).
  F24) CLOSED_E2E=1; EXPECTED_SPECS=19; REPLICABILITY_TENANTS="deka,demo2" ;;
  *)   CLOSED_E2E=0; EXPECTED_SPECS=0 ;;
esac
REPLICABILITY_TENANTS="${REPLICABILITY_TENANTS:-}"
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

# F18-T05 (ADR-041 §5, §B22): TETO por passo, e entrada fechada.
#
# Um passo que nunca volta não reprova — ele PENDURA, e o gate fica vivo sem
# produzir nada (medido: uma prova de shell herdada parou 1h25 num `head -1`
# esperando stdin, depois de ter passado em 58 s duas horas antes). O teto é
# generoso de propósito: ele existe para transformar "pendurado" em "reprovado
# com nome", não para apertar passo lento. `</dev/null` fecha a entrada: nenhum
# passo do gate lê do teclado, e quem tentar lê EOF em vez de esperar.
VERIFY_STEP_TIMEOUT="${VERIFY_STEP_TIMEOUT:-3600}"

step() {
  local name=$1; shift
  local started; started=$(date +%s)
  timeout --kill-after=30s "$VERIFY_STEP_TIMEOUT" "$@" >"$LOG_DIR/$name.log" 2>&1 </dev/null
  local result=$?
  if [ "$result" = 124 ] || [ "$result" = 137 ]; then
    echo "[verify] $name: TETO de ${VERIFY_STEP_TIMEOUT}s estourado — passo pendurado, não lento (§B22)" >&2
  fi
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
# F18-T04 (ADR-041 §4, §B19): a régua de canal volta ao gate. Ela reprovava
# desde a F11 e o gate não a rodava — régua vermelha que ninguém roda é régua
# que não existe, e o verde afirmava que a doutrina estava sendo respeitada.
step lint-channels pnpm lint:channels
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
step divergencia-ambiente node scripts/verify/divergencia-de-ambiente.mjs

if [ "$CLOSED_E2E" = 1 ]; then
  mapfile -t F02_SPECS < <(node scripts/verify/f02-e2e.mjs specs "$PHASE")
  if [ "$F02_SANDBOX_OK" != 1 ] || [ "$(cat "$LOG_DIR/build.exit")" != 0 ]; then
    skip_step e2e-plan "sandbox ou build F02 falhou"
    skip_step e2e "inventário E2E indisponível"
  elif [ "${#F02_SPECS[@]}" != "$EXPECTED_SPECS" ]; then
    skip_step e2e-plan "manifesto F02 inválido"
    skip_step e2e "inventário E2E indisponível"
  elif e2e_suite e2e-plan "${F02_SPECS[@]}" --list; then
    if [ -n "$REPLICABILITY_TENANTS" ]; then
      # Uma execução por tenant, sem commit entre elas; a árvore de src/ é
      # medida antes da primeira e depois da última (ADR-029 §1).
      SRC_TREE_BEFORE=$(node scripts/verify/replicability.mjs tree "$ROOT") || SRC_TREE_BEFORE=invalid
      for tenant in ${REPLICABILITY_TENANTS//,/ }; do
        E2E_TENANT="$tenant" e2e_suite "e2e-$tenant" "${F02_SPECS[@]}"
      done
      SRC_TREE_AFTER=$(node scripts/verify/replicability.mjs tree "$ROOT") || SRC_TREE_AFTER=invalid
      step replicability node scripts/verify/replicability.mjs report "$ROOT" "$LOG_DIR/replicability.json"         "$REPLICABILITY_TENANTS" "$SRC_TREE_BEFORE" "$SRC_TREE_AFTER"
    else
      e2e_suite e2e "${F02_SPECS[@]}"
    fi
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
