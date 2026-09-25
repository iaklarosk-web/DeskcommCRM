#!/usr/bin/env bash
# F04-T11, G-38: "sem filtro de tenant no RAG → `cross_tenant` falha, exit 1"
# (§7.5). Este é o ponto de observação do `pnpm ai:eval`; o mutante 42 mede o
# MESMO filtro pela prova de acervo (F04-T03), com a lista de fontes envenenada.
#
# ═══ Por que a sabotagem tem DUAS metades ═══════════════════════════════════
#
# O filtro de tenant do acervo é uma defesa dupla, e isso é desenho
# (`src/knowledge/busca.ts:28-36`):
#
#   1. a LISTA — `resolverAcervoDaOrganizacao` só devolve fontes da organização;
#   2. a RPC — `fn_buscar_trechos_das_fontes` filtra `c.organization_id`.
#
# Tirar UMA delas não vaza nada: a outra segura, e é exatamente para isso que as
# duas existem. Um mutante que removesse só uma nasceria VIVO — ele mediria a
# tolerância do desenho, não o filtro. Por isso aqui as duas caem juntas: o que
# se afirma é "sem filtro de tenant no acervo, o `ai:eval` fica vermelho", e a
# afirmação só é verificável com o filtro inteiro fora.
#
# Mecânica: a metade do BANCO vai por `TEST_DB_POS_BASELINE_SQL` (o gancho de
# sabotagem de `scripts/test-db.sh`, como no 42); a metade do CÓDIGO vai por um
# plugin de `transform` do Vite, em MEMÓRIA (como no 33/43/44). Nenhum arquivo
# do repositório é tocado, e a métrica do run saudável não é substituída — a
# corrida sabotada escreve num `VERIFY_LOG_DIR` próprio.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

ALVO_TS="src/knowledge/busca.ts"
DE='where organization_id = $1'
PARA='where ($1::uuid is not null) /* MUTANTE: o filtro de tenant saiu da lista */'
ESPERA='o registro de outro tenant apareceu na resposta'

mkdir -p "$PWD/.verify-logs"
scratch=$(mktemp -d "$PWD/.verify-logs/f04-ai-eval-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

# Metade 1 — a RPC do baseline SEM `c.organization_id = p_organization_id`.
# Tudo o mais é cópia fiel: o que se mede é o efeito daquela linha.
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

# Metade 2 — a lista de fontes sem o predicado de organização, em memória.
node --input-type=module - "$scratch" "$ALVO_TS" "$DE" "$PARA" <<'JS'
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [scratch, alvo, de, para] = process.argv.slice(2);
const raiz = process.cwd();
const fonte = readFileSync(path.join(raiz, alvo), "utf8");
const vezes = fonte.split(de).length - 1;
assert.equal(vezes, 1, `alvo do mutante mudou (${vezes} ocorrências em ${alvo})`);

writeFileSync(
  path.join(scratch, "vitest-mutante.config.mjs"),
  `import base from ${JSON.stringify(path.join(raiz, "vitest.integration.config.ts"))};
   import path from "node:path";
   const target=${JSON.stringify(path.join(raiz, alvo))};
   const from=${JSON.stringify(de)};
   const to=${JSON.stringify(para)};
   export default {...base,plugins:[...(base.plugins??[]),{
     name:"f04-acervo-no-ai-eval-mutant",enforce:"pre",
     transform(code,id){
       if(path.resolve(id.split("?")[0])!==path.resolve(target)) return;
       const hits=code.split(from).length-1;
       if(hits!==1) throw new Error("alvo da mutação apareceu " + hits + " vezes");
       return {code:code.replace(from,to),map:null};
     }
   }]};`,
);
JS

set +e
TEST_DB_POS_BASELINE_SQL="$scratch/sabotagem.sql" \
TEST_DB_VITEST_CONFIG="$scratch/vitest-mutante.config.mjs" \
VERIFY_LOG_DIR="$scratch/logs" \
  pnpm ai:eval >"$scratch/result.log" 2>&1
status=$?
set -e

if [ "$status" -ne 1 ]; then
  cat "$scratch/result.log" >&2
  echo "MUTANTE VIVO: pnpm ai:eval não saiu 1 com o acervo sem filtro de tenant (exit $status)" >&2
  exit 1
fi

# `grep -qF`, não `rg`: ripgrep não é dependência deste repositório.
if ! grep -qF "$ESPERA" "$scratch/result.log"; then
  cat "$scratch/result.log" >&2
  echo "MUTANTE VIVO: saiu 1 sem observar o vazamento entre tenants" >&2
  exit 1
fi

# A falha tem de ser dos casos CROSS-TENANT, e de todos os cinco — um vermelho
# em outro lugar sairia 1 do mesmo jeito e não provaria nada sobre o filtro.
vazados=$(grep -oE 'cross-tenant-0[1-5]: o registro de outro tenant apareceu na resposta' \
  "$scratch/result.log" | sed 's/:.*//' | sort -u | wc -l)
if [ "$vazados" -ne 5 ]; then
  cat "$scratch/result.log" >&2
  echo "MUTANTE VIVO: $vazados de 5 casos cross_tenant acusaram vazamento" >&2
  exit 1
fi

echo "mutants_killed=1/1 (f04-acervo-no-ai-eval; 5/5 cross_tenant vermelhos, ai:eval exit 1)"
