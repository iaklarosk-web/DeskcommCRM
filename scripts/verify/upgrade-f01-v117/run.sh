#!/usr/bin/env bash
# Upgrade F01 -> current combined baseline, over synthetic data, in one disposable DB.
set -euo pipefail
PROOF_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROOF_WORKTREE="$(cd "$PROOF_SCRIPT_DIR/../../.." && pwd)"
PROOF_BASE_COMMIT=960a46907449fcd4a7e773e40016742c25c0a09d
PROOF_DIR="$(mktemp -d "${TMPDIR:-/tmp}/crm-os-upgrade-f01-v117.XXXXXX")"
PROOF_CONTAINER="crm-os-upgrade-$(basename "$PROOF_DIR")"
PROOF_STARTED=0

cleanup() {
  if [ "$PROOF_STARTED" = 1 ]; then
    if docker rm -fv "$PROOF_CONTAINER" >/dev/null 2>&1; then
      printf 'container_removed=yes\n'
    else
      printf 'container_removed=no name=%s\n' "$PROOF_CONTAINER" >&2
    fi
  fi
}
trap cleanup EXIT
trap 'printf "UPGRADE_PROOF=FAIL line=%s artifacts=%s\n" "$LINENO" "$PROOF_DIR" >&2' ERR

printf 'artifacts=%s\n' "$PROOF_DIR"
python3 "$PROOF_SCRIPT_DIR/test-comparator.py"
git -C "$PROOF_WORKTREE" show "$PROOF_BASE_COMMIT:supabase/baseline.sql" > "$PROOF_DIR/baseline-f01.sql"
cp "$PROOF_WORKTREE/supabase/baseline.sql" "$PROOF_DIR/baseline-combined.sql"
cp "$PROOF_WORKTREE/scripts/test-db.sh" "$PROOF_DIR/test-db-input.sh"
python3 - "$PROOF_DIR" <<'PY'
import re, sys
from pathlib import Path
directory = Path(sys.argv[1])
source = (directory / "test-db-input.sh").read_text()
match = re.search(r"^psql_install <<'SQL'\n(.*?)^SQL$", source, re.M | re.S)
if not match or match.group(1).count("create extension") < 3:
    raise SystemExit("cannot extract Supabase harness prelude")
(directory / "prelude.sql").write_text(match.group(1))
PY
printf 'baseline_old_commit=%s\n' "$PROOF_BASE_COMMIT"
printf 'baseline_old_sha256=%s\n' "$(sha256sum "$PROOF_DIR/baseline-f01.sql" | cut -d' ' -f1)"
printf 'baseline_combined_sha256=%s\n' "$(sha256sum "$PROOF_DIR/baseline-combined.sql" | cut -d' ' -f1)"
printf 'harness_prelude_sha256=%s\n' "$(sha256sum "$PROOF_DIR/prelude.sql" | cut -d' ' -f1)"
printf 'image=pgvector/pgvector:pg15\n'
docker run -d --rm --name "$PROOF_CONTAINER" -p 127.0.0.1::5432 \
  --label deskcomm.harness=upgrade-f01-v117 --label "deskcomm.worktree=$PROOF_WORKTREE" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=upgrade_proof pgvector/pgvector:pg15 >/dev/null
PROOF_STARTED=1
printf 'container=%s port=%s\n' "$PROOF_CONTAINER" "$(docker port "$PROOF_CONTAINER" 5432/tcp)"
printf 'image_id=%s\n' "$(docker inspect --format '{{.Image}}' "$PROOF_CONTAINER")"
proof_ready=0
for proof_attempt in $(seq 1 60); do
  if docker exec "$PROOF_CONTAINER" psql -h 127.0.0.1 -U postgres -d upgrade_proof -tAc 'select 1' >/dev/null 2>&1; then
    proof_ready=1
    break
  fi
  sleep 1
done
[ "$proof_ready" = 1 ]

sql() { docker exec -i "$PROOF_CONTAINER" psql -X -q -U postgres -d upgrade_proof -v ON_ERROR_STOP=1 -f - "$@"; }
step() {
  local proof_label=$1 proof_input=$2
  if ! sql < "$proof_input" > "$PROOF_DIR/$proof_label.log" 2>&1; then
    tail -20 "$PROOF_DIR/$proof_label.log"
    return 1
  fi
  printf '%s=pass\n' "$proof_label"
  if [[ "$proof_label" == security-* || "$proof_label" == rls-* ]]; then
    sed -n 's/^.*NOTICE:  /observed: /p' "$PROOF_DIR/$proof_label.log"
  fi
}
snapshot() {
  sql -tA < "$PROOF_SCRIPT_DIR/snapshot.sql" > "$PROOF_DIR/$1-data.json"
  sql -tA < "$PROOF_SCRIPT_DIR/f01-schema.sql" > "$PROOF_DIR/$1-f01-schema.json"
}

step prelude "$PROOF_DIR/prelude.sql"
step install-f01 "$PROOF_DIR/baseline-f01.sql"
step seed-f01 "$PROOF_SCRIPT_DIR/seed.sql"
step security-before "$PROOF_SCRIPT_DIR/security.sql"
step rls-before "$PROOF_SCRIPT_DIR/isolation.sql"
snapshot before
step upgrade-combined "$PROOF_DIR/baseline-combined.sql"
snapshot upgraded
diff -u "$PROOF_DIR/before-data.json" "$PROOF_DIR/upgraded-data.json" > "$PROOF_DIR/preservation.diff" || true
python3 "$PROOF_SCRIPT_DIR/compare-preservation.py" "$PROOF_DIR"
diff -u "$PROOF_DIR/before-f01-schema.json" "$PROOF_DIR/upgraded-f01-schema.json" > "$PROOF_DIR/f01-schema.diff"
step security-after "$PROOF_SCRIPT_DIR/security.sql"
step rls-after "$PROOF_SCRIPT_DIR/isolation.sql"
step rerun-combined "$PROOF_DIR/baseline-combined.sql"
snapshot rerun
diff -u "$PROOF_DIR/upgraded-data.json" "$PROOF_DIR/rerun-data.json" > "$PROOF_DIR/rerun-data.diff"
diff -u "$PROOF_DIR/upgraded-f01-schema.json" "$PROOF_DIR/rerun-f01-schema.json" > "$PROOF_DIR/rerun-schema.diff"
step security-rerun "$PROOF_SCRIPT_DIR/security.sql"
step rls-rerun "$PROOF_SCRIPT_DIR/isolation.sql"
sql -tA <<'SQL'
select 'public_tables='||count(*) from pg_tables where schemaname='public';
select 'tenant_tables='||count(*) from information_schema.columns where table_schema='public' and column_name='organization_id';
select 'policies='||count(*) from pg_policies where schemaname='public';
select 'observed_new_tables='||string_agg(tablename,',' order by tablename) from pg_tables where schemaname='public' and tablename in ('platform_support_sessions','event_service_origins','appointment_recovery_receipts','channel_connection_requests','ai_reply_drafts');
select 'service_revision_columns='||count(*) from information_schema.columns where table_schema='public' and table_name in ('conversations','messages') and column_name='service_revision';
SQL
python3 - "$PROOF_DIR" <<'PY'
import json, sys
from pathlib import Path
directory = Path(sys.argv[1])
data = json.loads((directory / "before-data.json").read_text())
schema = json.loads((directory / "before-f01-schema.json").read_text())
if len(data) != 13 or not all(v and isinstance(v, list) for v in data.values()):
    raise SystemExit("fixture groups missing or empty")
rows = sum(map(len, data.values()))
if rows < 25:
    raise SystemExit(f"insufficient synthetic rows: {rows}")
print(f'PRESERVATION groups={len(data)}/{len(data)} rows={rows}/{rows} checks={len(schema["constraints"])} indexes={len(schema["indexes"])} prior_values_changed=0 rerun_diffs=0')
PY
# The result belongs to the input captured at the start, never a mixture of edits.
cmp -s "$PROOF_DIR/baseline-combined.sql" "$PROOF_WORKTREE/supabase/baseline.sql"
cmp -s "$PROOF_DIR/test-db-input.sh" "$PROOF_WORKTREE/scripts/test-db.sh"
printf 'UPGRADE old=960a469 passes=2/2 strict_errors=0 source_inputs_unchanged=yes\n'
printf 'UPGRADE_PROOF=PASS\n'
