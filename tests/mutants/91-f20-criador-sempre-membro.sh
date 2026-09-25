#!/usr/bin/env bash
# F20-T04 (ADR-045 §5; D60), G-38: criar empresa para OUTRA pessoa não pode
# deixar o criador dentro. A mutação devolve a inserção incondicional da
# membership (o estado anterior, VARREDURA §B28) numa CÓPIA do baseline; a prova
# tem de ficar vermelha. Mutação em DISCO: o baseline é aplicado por psql, e
# mutante em memória não o alcança.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/f20-criador-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/supabase"
node --input-type=module - "$scratch/supabase/baseline.sql" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const fonte = readFileSync('supabase/baseline.sql', 'utf8');
const alvo = `  if lower(btrim(coalesce(p_request->>'owner_email', ''))) =
     (select lower(btrim(email)) from auth.users where id = p_actor) then`;
if (fonte.split(alvo).length - 1 !== 1) throw new Error('Mutant target missing: a condição da membership mudou de forma');
writeFileSync(process.argv[2], fonte.replace(alvo, '  if true then -- MUTANTE: criador volta a entrar em toda empresa'));
JS
if TEST_DB_BASELINE="$scratch/supabase/baseline.sql" \
   bash scripts/test-db.sh tests/invariants/f20-t04-membership-do-criador.test.ts >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: a prova ficou verde com o criador entrando em toda empresa' >&2
  tail -20 "$scratch/result.log" >&2
  exit 1
fi
if ! grep -q "o criador entrou numa empresa que não é dele" "$scratch/result.log"; then
  tail -25 "$scratch/result.log" >&2
  echo 'MUTANTE VIVO: falhou sem a asserção esperada' >&2
  exit 1
fi
echo 'mutants_killed=1/1 (f20-criador-sempre-membro; asserção observada)'
