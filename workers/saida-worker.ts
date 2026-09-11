/**
 * Entrypoint do worker de SAÍDA (§5.13, F03-T07/T08).
 *
 * G-71: caminho ABSOLUTO e nenhuma dependência de `process.cwd()` no código.
 * A forma de chamada é:
 *
 *   cd /tmp && TSX_TSCONFIG_PATH=/abs/tsconfig.json \
 *     node --import /abs/node_modules/tsx/dist/loader.mjs \
 *          /abs/workers/saida-worker.ts --once
 *
 * `TSX_TSCONFIG_PATH` é obrigatório e foi MEDIDO: o alias `@/` deste repositório
 * é resolvido pelo tsconfig que o tsx encontra a partir do CWD, e de `/tmp` não
 * há tsconfig nenhum — sem a variável o processo morre com `Cannot find module
 * '@/…'` antes de abrir conexão. Por isso o arquivo imprime o próprio caminho
 * resolvido no boot: um worker que só roda da raiz do repositório é um worker
 * que o cron não sabe chamar, e a descoberta acontece às 3 da manhã.
 *
 * ⚠️ BLOQUEIO CONHECIDO (F03-T07, registrado no relatório da task): hoje este
 * processo AINDA não sobe fora do bundler do Next, e a causa não está aqui.
 * `src/channels/inbound-parse.ts` importa quatro ajudantes de
 * `lib/waha/ingest.ts`, e esse módulo arrasta `lib/channels/pos-entrada.ts` →
 * `lib/dev/kick-local-pipeline.ts` → `lib/event-log/register-handlers.ts` →
 * `workers/lgpd-export-worker.ts` → `@react-pdf/renderer`, que estoura
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` em Node puro. O worker herdado
 * (`workers/agent-worker/main.ts`) sobe porque o grafo dele não passa por ali.
 * O conserto é extrair aqueles quatro ajudantes para um módulo-folha — arquivo
 * de outra frente, não tocado aqui.
 *
 * Modos:
 *   --once   executa UM ciclo, imprime a contagem e sai (0 = ciclo completo).
 *   default  laço com intervalo de `OUTBOUND_WORKER_INTERVAL_MS` (5 s), até
 *            SIGTERM/SIGINT.
 *
 * Nenhum segredo é lido aqui. A conexão vem do `TenantContext`
 * (`src/tenant-context/db.ts`), que é o único módulo que sabe de onde ela sai.
 */
import path from "node:path";

import { rodarCicloDeSaida } from "@/src/jobs/outbound-worker";

/**
 * O caminho com que ESTE processo foi chamado. Vem de `argv[1]` e não de
 * `import.meta.url` porque o runner pode carregar o arquivo como CJS, onde
 * `import.meta` não existe — e um worker que quebra ao se apresentar é pior que
 * um worker calado.
 */
const CAMINHO_ABSOLUTO = path.resolve(process.argv[1] ?? "workers/saida-worker.ts");

/** Intervalo entre ciclos no modo laço. Milissegundos. */
const INTERVALO_PADRAO_MS = 5_000;

function intervaloDoAmbiente(): number {
  const bruto = Number.parseInt(process.env.OUTBOUND_WORKER_INTERVAL_MS ?? "", 10);
  return Number.isFinite(bruto) && bruto > 0 ? bruto : INTERVALO_PADRAO_MS;
}

function imprimirCiclo(r: {
  reivindicados: number;
  entregues: number;
  falhas: number;
  bloqueados: number;
}): void {
  console.info(
    `outbound-worker: claimed=${r.reivindicados} sent=${r.entregues} ` +
      `failed=${r.falhas} blocked=${r.bloqueados}`,
  );
}

async function principal(): Promise<void> {
  console.info(`outbound-worker: iniciando de ${CAMINHO_ABSOLUTO}`);
  const umaVez = process.argv.includes("--once");

  if (umaVez) {
    imprimirCiclo(await rodarCicloDeSaida());
    return;
  }

  let parando = false;
  const parar = (): void => {
    parando = true;
    console.info("outbound-worker: sinal recebido, encerrando após o ciclo atual");
  };
  process.on("SIGTERM", parar);
  process.on("SIGINT", parar);

  const intervalo = intervaloDoAmbiente();
  while (!parando) {
    imprimirCiclo(await rodarCicloDeSaida());
    if (parando) break;
    await new Promise((resolva) => setTimeout(resolva, intervalo));
  }
}

principal().then(
  () => process.exit(0),
  (erro: unknown) => {
    // Erro de ciclo NÃO é silencioso e NÃO sai 0: cron que sai 0 com falha
    // dentro é cron que ninguém descobre estar parado (G-27).
    console.error("outbound-worker: ciclo falhou", erro);
    process.exit(1);
  },
);
