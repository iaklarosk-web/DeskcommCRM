#!/usr/bin/env bash
# F04-T02, G-38/D33: com o gate de `by_risk` desarmado, a IA passa a CRIAR o
# pedido sozinha — sem pendência, sem `waiting_confirmation` e sem ninguém
# aprovar. A prova de F04-T02 tem de ficar VERMELHA na asserção NOMINAL
# (`status=executed`, esperado `pending`).
#
# ─── Por que o alvo é o `if`, e não `exigeConfirmacao` ────────────────────
#
# `exigeConfirmacao` responde "este risco pede confirmação?"; o `if` é quem
# OBEDECE à resposta. Sabotar a função provaria a leitura do Setting; sabotar o
# desvio prova o CONTRATO — que é o que o cliente sente, porque é ele que decide
# se um pedido nasce por decisão de uma pessoa ou por decisão de um modelo.
#
# O desfecho sabotado é sutil de propósito: `execute()` continua devolvendo
# sucesso, a auditoria continua ganhando linha, e o único sinal é o `status` que
# deixa de ser `pending`. Se a prova só contasse "deu certo", este mutante
# ficaria VERDE — e é exatamente esse verde que a F04-T02 existe para impedir.
#
# O fonte no disco não é tocado.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

RAIZ="$PWD"
mkdir -p "$RAIZ/.verify-logs"
scratch=$(mktemp -d "$RAIZ/.verify-logs/f04-confirmacao-por-risco-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

ALVO="src/actions/execute.ts"
DE="  if (await exigeConfirmacao(ctx, entrada, actor, deps)) {"
PARA="  if (false && (await exigeConfirmacao(ctx, entrada, actor, deps))) {"
TITULO="aprovar: a ação pendente EXECUTA antes, e a conversa volta para ai_handling"

node --input-type=module - "$scratch" "$RAIZ" "$ALVO" "$DE" "$PARA" <<'JS'
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [scratch, raiz, alvo, de, para] = process.argv.slice(2);
const fonte = readFileSync(path.join(raiz, alvo), "utf8");
assert.equal(
  fonte.split(de).length - 1,
  1,
  "alvo do mutante mudou: o desvio de confirmação não está no fonte como esperado",
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
       name: "f04-confirmacao-por-risco-mutant", enforce: "pre",
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

export PATH="$RAIZ/node_modules/.bin:$PATH"

set +e
TEST_DB_SUITE_DIR="$RAIZ/tests/integration" \
TEST_DB_VITEST_CONFIG="$CONFIG_REL" \
  bash scripts/test-db.sh tests/integration/f04-action-policy.test.ts \
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
// Pelo TEXTO da asserção nominal: "deu erro" aprovaria um vermelho de seed, de
// container ou de import — qualquer coisa menos o gate de D33 caído.
assert.match(
  mensagem,
  /create_order pela IA executou sem confirmação — o gate de by_risk \(D33\) não está valendo/,
  `a falha não observou o gate de confirmação perdido:\n${mensagem}`,
);
JS

echo "mutants_killed=1/1 (f04-confirmacao-por-risco; create_order da IA executou sem pendência)"
