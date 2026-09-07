#!/usr/bin/env bash
# scripts/verify.sh — v0 (F00-T07). Contrato: docs/DIRETRIZ.md §8.3 (D25).
# Roda os comandos reais da §6.1 e imprime EXATAMENTE o bloco VERIFY SUMMARY como últimas linhas.
# Campo sem mecanismo ainda imprime `pending` (nunca é omitido). Sai 0 só se a linha STATUS for
# `READY (Fnn)` da fase corrente lida do BUILD-STATE (ou `READY (staging)` em F07); senão 1.
# v0 (F00): obrigatórios = build, lint, typecheck e os runners que existem; tudo o mais pending.
# Mudança deste arquivo só por ADR depois de congelado pelo dono (D25).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
export WHATSAPP_MODE=mock AI_PROVIDER=mock CI=1
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
LOG_DIR="${VERIFY_LOG_DIR:-.verify-logs}"; mkdir -p "$LOG_DIR"
PHASE=$(sed -nE 's/^current_phase:\s*(F[0-9]{2}).*/\1/p' BUILD-STATE.md | head -1); PHASE=${PHASE:-F00}
BASELINE_N0=$(sed -nE 's/^baseline_n0:\s*([0-9]+).*/\1/p' BUILD-STATE.md | head -1); BASELINE_N0=${BASELINE_N0:-pending}
F00_COMMIT=$(sed -nE 's/^f00_commit:\s*([0-9a-f]{7,40}).*/\1/p' BUILD-STATE.md | head -1)
FAIL=0
has_script() { node -e "process.exit(require('./package.json').scripts['$1']?0:1)"; }
# vitest: o rodapé é a autoridade (CLAUDE.md §Testes): "Tests  N passed | M failed (T)"
vitest_count() { # log -> "passados/total"
  local l; l=$(grep -aE "^\s*Tests\s" "$1" | tail -1)
  local p t; p=$(echo "$l" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' | head -1); t=$(echo "$l" | grep -oE '\(([0-9]+)\)' | tr -d '()' | tail -1)
  [ -n "$p" ] && [ -n "$t" ] && echo "$p/$t" || echo "0/0"
}
step() { # nome comando... -> exit code no arquivo
  local nome=$1; shift; local t0=$(date +%s)
  "$@" > "$LOG_DIR/$nome.log" 2>&1; local ec=$?
  echo "[verify] $nome: exit=$ec $(( $(date +%s)-t0 ))s" >&2; echo $ec > "$LOG_DIR/$nome.exit"; return $ec
}
okfail() { [ "$1" = 0 ] && echo ok || echo fail; }

step typecheck pnpm typecheck; TC=$?; [ $TC = 0 ] || FAIL=1
step lint pnpm lint; LI=$?; [ $LI = 0 ] || FAIL=1
step build pnpm build; BU=$?; [ $BU = 0 ] || FAIL=1
step test_unit pnpm test:unit; UN=$?; [ $UN = 0 ] || FAIL=1; UNIT=$(vitest_count "$LOG_DIR/test_unit.log")
if has_script test:integration; then step test_integration pnpm test:integration; IN=$?; [ $IN = 0 ] || FAIL=1; INTEG=$(vitest_count "$LOG_DIR/test_integration.log"); else INTEG=pending; fi
if has_script test:db; then
  if command -v docker >/dev/null && docker info >/dev/null 2>&1; then step test_db pnpm test:db; DBX=$?; [ $DBX = 0 ] || FAIL=1; DB=$(vitest_count "$LOG_DIR/test_db.log")
  else echo "[verify] test_db: docker indisponível para este usuário" >&2; DB="0/0"; FAIL=1; fi
else DB=pending; fi
E2E=pending   # obrigatório a partir de F02 (§8.3); v0 não sobe app nem seeds
# tests_deleted: arquivos removidos de tests/ desde o commit da F00
if [ -n "$F00_COMMIT" ]; then TD=$(git diff --diff-filter=D --name-only "$F00_COMMIT" -- tests | wc -l | tr -d ' '); else TD=pending; fi
TS=$(grep -rnE "\.(skip|only)\(" tests src 2>/dev/null | wc -l | tr -d ' ')
# mutants: Q scripts em tests/mutants/; morto = script sai 0 (o script sabota, roda o subteste e espera vermelho)
Q=0; K=0; if [ -d tests/mutants ]; then for m in tests/mutants/*.sh; do [ -e "$m" ] || continue; Q=$((Q+1)); bash "$m" >/dev/null 2>&1 && K=$((K+1)); done; fi
if [ "$Q" = 0 ]; then MUT=pending; else MUT="$K/$Q"; [ "$K" = "$Q" ] || FAIL=1; fi
GREP_DEKA=$(grep -ril deka src/ 2>/dev/null | wc -l | tr -d ' ')

# STATUS: v0 só conhece os obrigatórios de F00/F01 que já têm mecanismo; o resto é pending e não conta.
case "$PHASE" in
  F00) STATUS=$([ $FAIL = 0 ] && echo "READY (F00)" || echo "NOT READY") ;;
  *)   STATUS="NOT READY" ;;   # v1 (F01-T11) implementa isolation/rbac/entitlement/secrets antes de liberar F01+
esac

echo "VERIFY SUMMARY"
echo "build=$(okfail $BU) lint=$(okfail $LI) typecheck=$(okfail $TC)"
echo "unit=$UNIT integration=$INTEG db=$DB e2e=$E2E baseline_n0=$BASELINE_N0"
echo "isolation: tables=pending ops=4 dirs=2 leaks=pending"
echo "rbac: roles=3 denied_expected=pending denied_actual=pending"
echo "entitlement: usage_events_written=pending"
echo "ai_eval: cases=pending pass=pending unknown=6 injection=10 cross_tenant=5 provider_calls_at_zero_balance=pending"
echo "handoff: ai_msgs_after_handoff=pending summary=pending assignee=pending notify=pending"
echo "reminder: runs=pending sent=pending duplicates=pending"
echo "webhook: replay=pending stored=pending tables_checked=pending"
echo "replicability: e2e[deka]=pending e2e[demo2]=pending src_diff_lines=pending grep_deka_in_src=$GREP_DEKA"
echo "secrets: files_scanned=pending findings=pending"
echo "tests_deleted=$TD tests_skipped=$TS mutants_killed=$MUT"
echo "STATUS: $STATUS"
[ "$STATUS" != "NOT READY" ]
