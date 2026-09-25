#!/usr/bin/env bash
# F03-T07, G-38/G-15: com o limite de tentativas frouxo, o job que falha três
# vezes NUNCA chega a `blocked` — ele volta para `pending` e a fila tenta de
# novo, para sempre, sem avisar ninguém. A prova de F03-T07 tem de ficar
# VERMELHA na asserção NOMINAL (`final=pending`, esperado `blocked`).
#
# ─── Por que o alvo é o limite, e não o worker ─────────────────────────────
#
# O limite viaja COM o job: `enqueue` grava `MAX_TENTATIVAS_DE_SAIDA` em
# `job_queue.max_attempts`, e o worker compara `attempts >= max_attempts`.
# Sabotar a comparação no worker provaria o worker; sabotar o limite prova o
# CONTRATO — que é o que o cliente sente, porque é ele que decide se a mensagem
# que não sai vira aviso na Central ou silêncio.
#
# O desfecho sabotado é sutil de propósito: o job continua rodando, `job_runs`
# continua ganhando linhas, e o único sinal é o `status` que nunca para. Se a
# prova aceitasse "attempts=3" como suficiente, este mutante ficaria VERDE.
#
# O fonte no disco não é tocado.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

RAIZ="$PWD"
mkdir -p "$RAIZ/.verify-logs"
scratch=$(mktemp -d "$RAIZ/.verify-logs/f03-retry-sem-bloqueio-mutant.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT

ALVO="src/jobs/enqueue.ts"
DE="export const MAX_TENTATIVAS_DE_SAIDA = 3;"
PARA="export const MAX_TENTATIVAS_DE_SAIDA = 99;"
TITULO="bloqueia o job, registra o erro e avisa um humano"

node --input-type=module - "$scratch" "$RAIZ" "$ALVO" "$DE" "$PARA" <<'JS'
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [scratch, raiz, alvo, de, para] = process.argv.slice(2);
const fonte = readFileSync(path.join(raiz, alvo), "utf8");
assert.equal(
  fonte.split(de).length - 1,
  1,
  "alvo do mutante mudou: MAX_TENTATIVAS_DE_SAIDA não está no fonte com o valor esperado",
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
       name: "f03-retry-sem-bloqueio-mutant", enforce: "pre",
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
  /o job não bloqueou na terceira falha: final=pending esperado=blocked/,
  `a falha não observou o bloqueio perdido:\n${mensagem}`,
);
JS

echo "mutants_killed=1/1 (f03-retry-sem-bloqueio; final=pending observado)"
