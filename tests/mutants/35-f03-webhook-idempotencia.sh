#!/usr/bin/env bash
# F03-T04/T10, G-38: SEM chave de idempotência, a reentrega grava a SEGUNDA
# linha da mensagem do cliente — e a prova de F03-T04 tem de ficar VERMELHA na
# asserção nominal (`stored=2`), não em outra qualquer.
#
# ─── Por que a sabotagem tem DUAS metades ──────────────────────────────────
#
# A metade do BANCO é a que o desenho pede: derrubar o índice novo
# (`messages_org_provider_external_uk`) E a constraint herdada
# (`messages_org_external_id_unique`), para que nada mais recuse a segunda
# linha.
#
# Só isso, porém, não produz `stored=2`: o INSERT do pipeline nomeia a tripla no
# `on conflict`, e sem o índice o Postgres recusa a PRÓPRIA instrução (42P10,
# "no unique or exclusion constraint matching the ON CONFLICT specification").
# O teste ficaria vermelho por erro de sintaxe — que é um vermelho sobre outra
# coisa, e mutante que mata por acidente não prova nada. Por isso a segunda
# metade remove, EM MEMÓRIA, a cláusula de idempotência do fonte: aí a instrução
# roda, a segunda entrega grava, e o vermelho é o da duplicação.
#
# O fonte no disco não é tocado.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

RAIZ="$PWD"
mkdir -p "$RAIZ/.verify-logs"
scratch=$(mktemp -d "$RAIZ/.verify-logs/f03-idempotencia-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

ALVO="src/channels/inbound.ts"
DE=$'         on conflict (organization_id, provider, external_id)\n           where provider is not null and external_id is not null\n           do nothing\n'
TITULO="o segundo POST idêntico produz delta 0 em TODAS as tabelas de public"

# Metade 1 — o banco perde as duas chaves.
cat >"$scratch/sabotagem.sql" <<'SQL'
drop index public.messages_org_provider_external_uk;
alter table public.messages drop constraint messages_org_external_id_unique;
SQL

# Metade 2 — o fonte perde a cláusula, só na memória do vitest.
node --input-type=module - "$scratch" "$RAIZ" "$ALVO" "$DE" <<'JS'
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [scratch, raiz, alvo, de] = process.argv.slice(2);
const fonte = readFileSync(path.join(raiz, alvo), "utf8");
assert.equal(fonte.split(de).length - 1, 1, "alvo do mutante mudou: a cláusula on conflict não está no fonte");

writeFileSync(
  path.join(scratch, "vite-mutant.mjs"),
  `import base from ${JSON.stringify(path.join(raiz, "vitest.integration.config.ts"))};
   import path from "node:path";
   const raiz = ${JSON.stringify(raiz)};
   const target = ${JSON.stringify(path.join(raiz, alvo))};
   const de = ${JSON.stringify(de)};
   export default {
     ...base,
     root: raiz,
     test: {
       ...base.test,
       root: raiz,
       include: [path.join(raiz, "tests/integration/**/*.test.ts")],
       setupFiles: [path.join(raiz, "tests/db/banco-limpo-por-arquivo.ts")],
     },
     plugins: [...(base.plugins ?? []), {
       name: "f03-webhook-idempotencia-mutant", enforce: "pre",
       transform(code, id) {
         if (path.resolve(id.split("?")[0]) !== path.resolve(target)) return;
         const hits = code.split(de).length - 1;
         if (hits !== 1) throw new Error("alvo da mutação apareceu " + hits + " vezes");
         return { code: code.replace(de, ""), map: null };
       },
     }],
   };`,
);
JS

CONFIG_REL="${scratch#"$RAIZ"/}/vite-mutant.mjs"

# `scripts/test-db.sh` chama `vitest` pelo nome; quem o alcança normalmente é o
# `pnpm run`, e este script o invoca direto — sem isto o harness morre com
# "vitest: command not found" ANTES de rodar prova nenhuma.
export PATH="$RAIZ/node_modules/.bin:$PATH"

set +e
TEST_DB_POS_BASELINE_SQL="$scratch/sabotagem.sql" \
TEST_DB_SUITE_DIR="$RAIZ/tests/integration" \
TEST_DB_VITEST_CONFIG="$CONFIG_REL" \
  bash scripts/test-db.sh tests/integration/f03-webhook-entrada.test.ts \
  -t "$TITULO" \
  --reporter=json --outputFile="$scratch/result.json" \
  >"$scratch/result.log" 2>&1
status=$?
set -e

if [ "$status" -eq 0 ] || [ ! -s "$scratch/result.json" ]; then
  cat "$scratch/result.log" >&2
  echo "MUTANTE SEM VEREDITO: esperava falha e relatório JSON" >&2
  exit 1
fi

node --input-type=module - "$scratch/result.json" "$TITULO" <<'JS'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const [arquivo, titulo] = process.argv.slice(2);
const report = JSON.parse(readFileSync(arquivo, "utf8"));
const alvo = report.testResults
  .flatMap((file) => file.assertionResults)
  .find((test) => test.title === titulo);
assert.equal(alvo?.status, "failed", "a falha não atingiu a prova esperada");
const mensagem = alvo.failureMessages.join("\n");
assert.match(
  mensagem,
  /a reentrega gravou uma segunda linha de mensagem: stored=2/,
  `a falha não observou a duplicação da reentrega:\n${mensagem}`,
);
JS

echo "mutants_killed=1/1 (f03-webhook-idempotencia; stored=2 observado)"
