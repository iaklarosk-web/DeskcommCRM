/**
 * `pnpm ai:eval` — roda o dataset de `docs/ai-eval/cases.yaml` e imprime a
 * linha `ai_eval:` do VERIFY SUMMARY (F04-T07, §7.5, §8.3, ADR-022).
 *
 * ═══ Por que este script DELEGA em vez de reimplementar ═════════════════════
 *
 * O runner precisa de um Postgres com o baseline aplicado — o `expected` de
 * cada caso é comparado com o BANCO (G-35), não com o texto. Essa máquina já
 * existe inteira em `scripts/test-db.sh`: container efêmero com porta escolhida
 * pelo daemon, baseline em install + update com `ON_ERROR_STOP=1`, banco novo
 * por arquivo, detector de árvore viva e teardown no EXIT. Reescrevê-la aqui
 * seria uma segunda máquina para derivar da primeira no primeiro conserto.
 *
 * Então: UMA implementação (`tests/integration/f04-t07-ai-eval.test.ts`), DUAS
 * entradas. `pnpm test:integration` a roda junto com a suíte — é assim que o
 * `verify.sh` obtém a métrica, sem que ele precise conhecer este script
 * (ADR-022 decisão 2: o gate lê `.verify-logs/metrics/ai-eval.line`). E
 * `pnpm ai:eval` a roda sozinha, para quem quer só a linha.
 *
 * ═══ O que sai na tela ══════════════════════════════════════════════════════
 *
 * A linha literal do bloco, lida do arquivo de métrica que a suíte acabou de
 * gravar. Suíte verde sem linha é FALHA: significa que a asserção passou sem
 * produzir evidência, que é exatamente o campo decorativo que §8.3 proíbe.
 *
 * Variáveis lidas (G-27, todas com default e nenhuma secreta):
 *   TEST_DB_VITEST_CONFIG  scripts/ai-eval.ts:59  (default: a config de integração)
 *   VERIFY_LOG_DIR         scripts/ai-eval.ts:79  (default: .verify-logs)
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "..");
const SUITE = "tests/integration/f04-t07-ai-eval.test.ts";
/** ADR-022 decisão 3: o ARQUIVO é `ai-eval`; o CAMPO do bloco é `ai_eval:`. */
const ARQUIVO_DA_METRICA = "ai-eval.line";

function main(): number {
  if (!existsSync(path.join(RAIZ, "docs/ai-eval/cases.yaml"))) {
    console.error("FATAL: docs/ai-eval/cases.yaml não encontrado");
    return 1;
  }

  const corrida = spawnSync("bash", [path.join(RAIZ, "scripts/test-db.sh"), SUITE, ...process.argv.slice(2)], {
    cwd: RAIZ,
    stdio: "inherit",
    env: {
      ...process.env,
      // `test-db.sh` chama `vitest` pelo nome: sob `pnpm run` o `.bin` do
      // projeto já está no PATH, mas repeti-lo aqui faz o script funcionar
      // também quando alguém o invoca por `tsx scripts/ai-eval.ts`.
      PATH: `${path.join(RAIZ, "node_modules/.bin")}:${process.env.PATH ?? ""}`,
      // §7.5: o dataset roda com o provedor MOCK. Nenhum byte sai para rede.
      AI_PROVIDER: "mock",
      WHATSAPP_MODE: "mock",
      TEST_DB_SUITE_DIR: path.join(RAIZ, "tests/integration"),
      // Respeitado quando já vem do ambiente — é o que permite ao mutante 47
      // injetar a config com o plugin de sabotagem sem tocar no repositório.
      TEST_DB_VITEST_CONFIG:
        process.env.TEST_DB_VITEST_CONFIG ?? "vitest.integration.config.ts",
    },
  });

  const linha = lerLinhaDaMetrica();
  if (linha !== null) {
    console.info("");
    console.info(linha);
  }

  if (corrida.status !== 0) {
    console.error(`ai:eval REPROVOU (exit ${corrida.status ?? "sinal " + String(corrida.signal)})`);
    return 1;
  }
  if (linha === null) {
    console.error(
      `FATAL: a suíte passou sem gravar metrics/${ARQUIVO_DA_METRICA} — ` +
        "asserção verde sem evidência não fecha o gate (§8.3).",
    );
    return 1;
  }
  return 0;
}

function lerLinhaDaMetrica(): string | null {
  const base = process.env.VERIFY_LOG_DIR
    ? path.resolve(process.env.VERIFY_LOG_DIR)
    : path.join(RAIZ, ".verify-logs");
  const arquivo = path.join(base, "metrics", ARQUIVO_DA_METRICA);
  if (!existsSync(arquivo)) return null;
  const conteudo = readFileSync(arquivo, "utf8").trim();
  return conteudo.length > 0 ? conteudo : null;
}

process.exit(main());
