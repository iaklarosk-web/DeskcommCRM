#!/usr/bin/env bash
# F03-T08, G-38/D20: `enqueue()` SEM a validação de tenant do payload aceita
# job órfão — e a prova de F03-T08 tem de ficar VERMELHA na asserção NOMINAL
# (`rejected_without_tenant=0/2`), não em outra qualquer.
#
# ─── Por que a sabotagem é só de FONTE ─────────────────────────────────────
#
# A recusa não é do banco: `job_queue.organization_id` é NOT NULL, mas o
# `enqueue` grava ali o tenant do CHAMADOR, não o do payload — então um payload
# órfão passaria pelo schema sem um arranhão. Quem recusa é o `fromJob` do
# TenantContext (§5.1, invariante 2), e é ele que este mutante remove: no lugar
# dele entra um objeto que devolve o tenant do `ctx`, que é exatamente o atalho
# que um `enqueue` distraído escreveria.
#
# Se o contador subisse por outro caminho, ou se a prova aceitasse "deu erro"
# em vez de contar as duas recusas, este mutante ficaria VERDE — e é por isso
# que a asserção conferida abaixo é a do denominador, e não a do status.
#
# O fonte no disco não é tocado.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

RAIZ="$PWD"
mkdir -p "$RAIZ/.verify-logs"
scratch=$(mktemp -d "$RAIZ/.verify-logs/f03-fila-sem-tenant-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

ALVO="src/jobs/enqueue.ts"
DE="  const doPayload = fromJob(payload);"
PARA="  const doPayload = { organization_id: ctx.organization_id, source: \"job\" as const };"
TITULO="recusa e conta dois payloads sem organization_id"

node --input-type=module - "$scratch" "$RAIZ" "$ALVO" "$DE" "$PARA" <<'JS'
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [scratch, raiz, alvo, de, para] = process.argv.slice(2);
const fonte = readFileSync(path.join(raiz, alvo), "utf8");
assert.equal(
  fonte.split(de).length - 1,
  1,
  "alvo do mutante mudou: a chamada a fromJob não está no fonte do enqueue",
);

writeFileSync(
  path.join(scratch, "vite-mutant.mjs"),
  `import base from ${JSON.stringify(path.join(raiz, "vitest.integration.config.ts"))};
   import path from "node:path";
   const raiz = ${JSON.stringify(raiz)};
   const target = ${JSON.stringify(path.join(raiz, alvo))};
   const de = ${JSON.stringify(de)};
   const para = ${JSON.stringify(para)};
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
       name: "f03-fila-sem-tenant-mutant", enforce: "pre",
       transform(code, id) {
         if (path.resolve(id.split("?")[0]) !== path.resolve(target)) return;
         const hits = code.split(de).length - 1;
         if (hits !== 1) throw new Error("alvo da mutação apareceu " + hits + " vezes");
         return { code: code.replace(de, para), map: null };
       },
     }],
   };`,
);
JS

CONFIG_REL="${scratch#"$RAIZ"/}/vite-mutant.mjs"

# `scripts/test-db.sh` chama `vitest` pelo nome; quem o alcança normalmente é o
# `pnpm run`, e este script o invoca direto.
export PATH="$RAIZ/node_modules/.bin:$PATH"

set +e
TEST_DB_SUITE_DIR="$RAIZ/tests/integration" \
TEST_DB_VITEST_CONFIG="$CONFIG_REL" \
  bash scripts/test-db.sh tests/integration/f03-saida.test.ts \
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
  .find((test) => test.title.includes(titulo));
assert.equal(alvo?.status, "failed", "a falha não atingiu a prova esperada");
const mensagem = alvo.failureMessages.join("\n");
assert.match(
  mensagem,
  /a fila aceitou payload sem organization_id: rejected_without_tenant=0\/2/,
  `a falha não observou a recusa perdida:\n${mensagem}`,
);
JS

echo "mutants_killed=1/1 (f03-fila-sem-tenant; rejected_without_tenant=0/2 observado)"
