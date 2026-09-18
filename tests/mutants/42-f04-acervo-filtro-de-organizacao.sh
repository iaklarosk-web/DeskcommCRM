#!/usr/bin/env bash
# F04-T03, G-38: o filtro de organização de `fn_buscar_trechos_das_fontes` é a
# garantia de isolamento do acervo (§5.10, ADR-021 decisão 4). Removê-lo NÃO
# quebra nada visível — as buscas continuam devolvendo os trechos certos para
# quem passa só as fontes do próprio tenant, e é por isso que ele consegue sumir
# num refactor sem ninguém notar. Este mutante existe para que sumir fique
# VERMELHO na asserção nominal de `cross_tenant_hits`.
#
# A sabotagem é de BANCO (mecânica de 31-f03-projecao-de-estado.sh): o SQL é
# aplicado ao MOLDE depois do baseline, via TEST_DB_POS_BASELINE_SQL, que
# scripts/test-db.sh honra e scripts/test-integration.sh herda. Nenhum arquivo
# do repositório é tocado.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mkdir -p "$PWD/.verify-logs"
scratch=$(mktemp -d "$PWD/.verify-logs/f04-acervo-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

# Cópia da função do baseline SEM a linha `c.organization_id = p_organization_id`.
# Tudo o mais é idêntico: o que se mede é o efeito daquela linha, não o de uma
# função diferente.
cat >"$scratch/sabotagem.sql" <<'SQL'
create or replace function public.fn_buscar_trechos_das_fontes(
  p_organization_id uuid,
  p_source_ids uuid[],
  p_embedding public.vector,
  p_k integer default 5,
  p_threshold real default 0.40,
  p_embedding_model text default null
) returns table(
  chunk_id uuid,
  knowledge_source_id uuid,
  source_name text,
  content text,
  similarity real,
  metadata jsonb
)
  language plpgsql stable security definer
  set search_path to 'public'
as $$
begin
  if auth.uid() is not null
     and not public.fn_role_at_least(p_organization_id, 'viewer') then
    raise exception 'caller_not_authorized_for_org'
      using hint = 'fn_buscar_trechos_das_fontes: caller must be an active member of the organization';
  end if;

  return query
  select
    c.id as chunk_id,
    c.knowledge_source_id,
    s.name as source_name,
    c.content,
    (1 - (c.embedding <=> p_embedding))::real as similarity,
    c.metadata
  from public.ai_chunks c
  join public.ai_knowledge_sources s
    on s.id = c.knowledge_source_id
   and s.organization_id = c.organization_id
  join public.ai_knowledge_versions v
    on v.id = c.kb_version_id
  where s.id = any(p_source_ids)   -- MUTANTE: o filtro de organização saiu daqui
    and s.is_active
    and s.status = 'ready'
    and c.kb_version_id = s.active_kb_version_id
    and (
      p_embedding_model is null
      or v.embedding_model is null
      or v.embedding_model = p_embedding_model
    )
    and (1 - (c.embedding <=> p_embedding)) >= p_threshold
  order by c.embedding <=> p_embedding asc
  limit greatest(p_k, 0);
end $$;
SQL

titulo='knowledge: docs_a=2 docs_b=1 consultas=5 cross_tenant_hits=0/R'

set +e
TEST_DB_POS_BASELINE_SQL="$scratch/sabotagem.sql" pnpm test:integration \
  tests/integration/f04-t03-acervo-da-organizacao.test.ts \
  -t "cross_tenant_hits=0/R" \
  --reporter=json --outputFile="$scratch/result.json" \
  >"$scratch/result.log" 2>&1
status=$?
set -e

if [ "$status" -ne 1 ] || [ ! -s "$scratch/result.json" ]; then
  cat "$scratch/result.log" >&2
  echo "MUTANTE SEM VEREDITO: esperava exit 1 e relatório JSON" >&2
  exit 1
fi

node --input-type=module - "$scratch/result.json" "$titulo" <<'JS'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
const title = process.argv[3];
const target = report.testResults
  .flatMap((file) => file.assertionResults)
  .find((test) => test.title === title);
assert.equal(target?.status, "failed", "falha não atingiu a prova esperada");
assert.match(
  target.failureMessages.join("\n"),
  /trecho de outra organização vazou para a busca/,
  "a falha não observou o vazamento entre tenants",
);
JS

echo "mutants_killed=1/1 (f04-acervo-filtro-de-organizacao; asserção observada)"
