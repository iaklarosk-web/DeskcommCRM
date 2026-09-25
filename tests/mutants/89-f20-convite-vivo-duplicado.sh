#!/usr/bin/env bash
# F20-T01 (ADR-045 §1; D61 b), G-38: "reenviar revoga o anterior" é garantia do
# BANCO — o índice único PARCIAL só conta convite VIVO. A mutação tira as duas
# cláusulas do WHERE (o índice passa a valer para linhas aceitas e revogadas):
# a prova tem de ficar vermelha, porque revogar deixaria de liberar um convite
# novo. Mutação em DISCO (o baseline é aplicado por psql a partir do arquivo;
# mutante em memória não o alcança), numa CÓPIA — a árvore nunca é tocada.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/f20-indice-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/supabase"
node --input-type=module - "$scratch/supabase/baseline.sql" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const fonte = readFileSync('supabase/baseline.sql', 'utf8');
const alvo = `create unique index if not exists team_invites_um_vivo_por_email
  on public.team_invites (organization_id, lower(email))
  where accepted_at is null and revoked_at is null;`;
if (fonte.split(alvo).length - 1 !== 1) throw new Error('Mutant target missing: o índice único parcial mudou de forma no baseline');
const mutado = `create unique index if not exists team_invites_um_vivo_por_email
  on public.team_invites (organization_id, lower(email)); -- MUTANTE: índice deixou de ser parcial`;
writeFileSync(process.argv[2], fonte.replace(alvo, mutado));
JS
if TEST_DB_BASELINE="$scratch/supabase/baseline.sql" \
   bash scripts/test-db.sh tests/invariants/f20-t01-team-invites-schema.test.ts >"$scratch/result.log" 2>&1; then
  echo 'MUTANTE VIVO: a prova ficou verde com o índice não-parcial' >&2
  tail -20 "$scratch/result.log" >&2
  exit 1
fi
# Duas defesas podem matar este mutante, e as duas são a mesma verdade:
#   1. a GUARDA da própria migration ("não é PARCIAL"), que recusa aplicar o
#      baseline mutado — a defesa mais barata, porque nem chega ao teste;
#   2. a asserção da prova ("revogar/aceitar não liberou convite novo"), se um
#      dia a guarda sair.
if grep -q "não é PARCIAL" "$scratch/result.log"; then
  echo 'mutants_killed=1/1 (f20-convite-vivo-duplicado; morto pela guarda da migration 9035)'
  exit 0
fi
if grep -q "revogar não liberou convite novo\|aceitar não liberou convite novo" "$scratch/result.log"; then
  echo 'mutants_killed=1/1 (f20-convite-vivo-duplicado; morto pela asserção da prova)'
  exit 0
fi
tail -25 "$scratch/result.log" >&2
echo 'MUTANTE VIVO: falhou sem a guarda nem a asserção esperadas' >&2
exit 1
