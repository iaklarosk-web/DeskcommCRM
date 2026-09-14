/**
 * A mecânica comum dos mutantes 44, 45 e 46 (G-38).
 *
 * Junta as duas mecânicas que já existiam no repositório:
 *
 *  - a de `33-f03-adapter-allowlist.sh` / `43-f04-consumo-em-dobro.sh`: o fonte
 *    muda só em MEMÓRIA, por um plugin de `transform` do Vite, e o arquivo do
 *    repositório nunca é tocado;
 *  - a de `42-f04-acervo-filtro-de-organizacao.sh`: a prova sabotada é de
 *    INTEGRAÇÃO e precisa do Postgres efêmero com o baseline, então quem a roda
 *    é `scripts/test-db.sh` (que `scripts/test-integration.sh` parametriza).
 *
 * Os três mutantes da F04-T04/T05/T09 sabotam invariantes do TURNO, e nenhum
 * deles é observável sem banco: silêncio, limiar e laço de retry só aparecem no
 * que foi (ou não foi) gravado e no quanto o provedor foi chamado.
 *
 * Uso:
 *   node tests/mutants/f04-turno-mutante.mjs \
 *     --arquivo <src/...ts> --de <trecho> --para <trecho> \
 *     --suite <tests/integration/...test.ts> --titulo <nome do caso> \
 *     --espera <trecho da mensagem de falha> --nome <rotulo>
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

function argumento(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  assert.ok(i > 0 && i + 1 < process.argv.length, `argumento --${nome} ausente`);
  return process.argv[i + 1];
}

const raiz = process.cwd();
const arquivo = argumento("arquivo");
const de = argumento("de");
const para = argumento("para");
const suite = argumento("suite");
const titulo = argumento("titulo");
const espera = argumento("espera");
const nome = argumento("nome");

// O scratch vive sob `.verify-logs/` porque o detector de árvore viva do
// `test-db.sh` mede `tests/integration`, o baseline e a config: escrever ali
// dentro DURANTE a corrida invalidaria o próprio veredito.
mkdirSync(path.join(raiz, ".verify-logs"), { recursive: true });
const scratch = mkdtempSync(path.join(raiz, ".verify-logs", `${nome}-mutant.`));

try {
  const fonte = readFileSync(path.join(raiz, arquivo), "utf8");
  const vezes = fonte.split(de).length - 1;
  assert.equal(vezes, 1, `alvo do mutante mudou (${vezes} ocorrências em ${arquivo})`);

  const config = path.join(scratch, "vitest-mutante.config.mjs");
  const saida = path.join(scratch, "result.json");
  const log = path.join(scratch, "result.log");

  writeFileSync(
    config,
    `import base from ${JSON.stringify(path.join(raiz, "vitest.integration.config.ts"))};
     import path from "node:path";
     const target=${JSON.stringify(path.join(raiz, arquivo))};
     const from=${JSON.stringify(de)};
     const to=${JSON.stringify(para)};
     export default {...base,plugins:[...(base.plugins??[]),{
       name:${JSON.stringify(`${nome}-mutant`)},enforce:"pre",
       transform(code,id){
         if(path.resolve(id.split("?")[0])!==path.resolve(target)) return;
         const hits=code.split(from).length-1;
         if(hits!==1) throw new Error("alvo da mutação apareceu " + hits + " vezes");
         return {code:code.replace(from,to),map:null};
       }
     }]};`,
  );

  const corrida = spawnSync(
    "bash",
    [
      path.join(raiz, "scripts/test-db.sh"),
      suite,
      "-t",
      titulo,
      "--reporter=json",
      "--outputFile",
      saida,
    ],
    {
      cwd: raiz,
      encoding: "utf8",
      timeout: 900_000,
      env: {
        ...process.env,
        // `scripts/test-db.sh` invoca `vitest` pelo nome: sob `pnpm test:*` o
        // `node_modules/.bin` está no PATH, e aqui não estaria. Chamar
        // `pnpm test:integration` não serve — aquele script FIXA a config, e é
        // justamente a config (com o plugin de mutação) que precisa ser outra.
        PATH: `${path.join(raiz, "node_modules/.bin")}:${process.env.PATH ?? ""}`,
        TEST_DB_SUITE_DIR: path.join(raiz, "tests/integration"),
        TEST_DB_VITEST_CONFIG: config,
      },
    },
  );
  writeFileSync(log, `${corrida.stdout ?? ""}\n${corrida.stderr ?? ""}`);

  if (corrida.status !== 1) {
    process.stderr.write(`${corrida.stdout ?? ""}\n${corrida.stderr ?? ""}\n`);
    throw new Error(`MUTANTE SEM VEREDITO: esperava exit 1, veio ${corrida.status}`);
  }

  const relatorio = JSON.parse(readFileSync(saida, "utf8"));
  const casos = relatorio.testResults
    .flatMap((arquivoDeTeste) => arquivoDeTeste.assertionResults)
    .filter((caso) => caso.title === titulo);
  assert.equal(casos.length, 1, `o caso alvo não rodou (${casos.length} encontrados)`);
  assert.equal(casos[0].status, "failed", "a prova não ficou vermelha com a sabotagem");
  assert.ok(
    casos[0].failureMessages.join("\n").includes(espera),
    `a falha não observou o invariante sabotado (esperava conter: ${espera})`,
  );

  process.stdout.write(`mutants_killed=1/1 (${nome}; asserção observada)\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
