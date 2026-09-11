#!/usr/bin/env bash
# F03-T03/T10, G-38: se o pipeline ACEITAR um `account_key` que não casa com
# nenhuma conta, a mensagem de um remetente qualquer entra no CRM de um tenant
# que nunca a pediu — e nada no log diz que isso aconteceu.
#
# A sabotagem tira do `fromWebhook` a única coisa que amarra o evento à conta: o
# filtro por `account_key`. O `$2` continua citado na query (retirá-lo faria o
# driver recusar o bind e o vermelho seria sobre o parâmetro, não sobre o
# tenant), mas deixa de decidir qualquer coisa — qualquer conta ativa daquele
# provedor serve. Com isso o evento órfão resolve tenant, nada vai para
# `webhook_quarantine`, e o caso 1 da prova de F03-T03 tem de ficar VERMELHO.
#
# O fonte no disco não é tocado.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

RAIZ="$PWD"
mkdir -p "$RAIZ/.verify-logs"
scratch=$(mktemp -d "$RAIZ/.verify-logs/f03-quarentena-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

ALVO="src/tenant-context/from-webhook.ts"
DE="where provider = \$1 and account_key = \$2 and status = 'active'"
PARA="where provider = \$1 and account_key is not null and \$2::text is not null and status = 'active'"
TITULO="resolve as duas contas na organização certa e põe a conta desconhecida em quarentena"

node --input-type=module - "$scratch" "$RAIZ" "$ALVO" "$DE" "$PARA" <<'JS'
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [scratch, raiz, alvo, de, para] = process.argv.slice(2);
const fonte = readFileSync(path.join(raiz, alvo), "utf8");
assert.equal(fonte.split(de).length - 1, 1, "alvo do mutante mudou: o filtro por account_key não está no fonte");

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
       name: "f03-webhook-quarentena-mutant", enforce: "pre",
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
  /conta desconhecida não foi para quarentena/,
  `a falha não observou a quarentena ausente:\n${mensagem}`,
);
JS

echo "mutants_killed=1/1 (f03-webhook-quarentena; asserção observada)"
