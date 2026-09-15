#!/usr/bin/env bash
# F03-T05, G-38: apagar a consulta à fronteira herdada faz a transição rodar a
# partir de `archived` — e a linha D16 desse par declara o efeito
# `new_conversation`, que o schema herdado não comporta. O resultado é HTTP 500
# numa mensagem legítima de cliente.
#
# Este mutante existe porque o conserto é INVISÍVEL no caminho feliz: toda
# mensagem dentro da janela de serviço passa igual com ou sem a consulta. Sem
# um vermelho dedicado, remover a leitura de `service_revision` pareceria uma
# simplificação inofensiva.
#
# Sabotagem só em memória, pelo transform do Vite. O fonte no disco não é tocado.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

RAIZ="$PWD"
mkdir -p "$RAIZ/.verify-logs"
scratch=$(mktemp -d "$RAIZ/.verify-logs/f03-fronteira-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

ALVO="src/channels/inbound.ts"
DE="if (linhaDaFronteira === undefined || linhaDaFronteira.service_revision === null) {"
PARA="if (false) { void linhaDaFronteira;"
TITULO="arquiva a conversa, recebe uma mensagem anterior ao fechamento e responde 200 sem mover nada"

node --input-type=module - "$scratch" "$RAIZ" "$ALVO" "$DE" "$PARA" <<'JS'
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [scratch, raiz, alvo, de, para] = process.argv.slice(2);
const fonte = readFileSync(path.join(raiz, alvo), "utf8");
assert.equal(
  fonte.split(de).length - 1,
  1,
  "alvo do mutante mudou: a guarda da fronteira não está no fonte",
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
       name: "f03-fronteira-de-servico-mutant", enforce: "pre",
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

# `scripts/test-db.sh` chama `vitest` pelo nome; este script o invoca direto.
export PATH="$RAIZ/node_modules/.bin:$PATH"

set +e
TEST_DB_SUITE_DIR="$RAIZ/tests/integration" \
TEST_DB_VITEST_CONFIG="$CONFIG_REL" \
  bash scripts/test-db.sh tests/integration/f03-fronteira-de-servico.test.ts \
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
  /mensagem fora da janela derrubou a rota/,
  `a falha não observou a queda da rota:\n${mensagem}`,
);
JS

echo "mutants_killed=1/1 (f03-fronteira-de-servico; rota derrubada observada)"
