/**
 * Entrypoint do cron do LEMBRETE recorrente PJ (§5.12, F05-T06/T08).
 *
 * G-71: caminho ABSOLUTO e nenhuma dependência de `process.cwd()` no código.
 * A forma de chamada é a mesma do worker de saída:
 *
 *   cd /tmp && TSX_TSCONFIG_PATH=/abs/tsconfig.json \
 *     node --import /abs/node_modules/tsx/dist/loader.mjs \
 *          /abs/workers/lembrete-worker.ts --once
 *
 * Modos:
 *   --once     executa UM ciclo (disparo + corte), imprime as contagens e sai.
 *   default    laço com intervalo de `REMINDER_WORKER_INTERVAL_MS` (1 h), até
 *              SIGTERM/SIGINT. §5.12: "disparado de hora em hora".
 *
 * O ciclo faz DUAS coisas, nesta ordem: o disparo dos tenants cuja hora local
 * bate a janela (`rodarLembretes`) e o corte dos lembretes que passaram do
 * prazo sem resposta (`rodarCortes`). Nenhum segredo é lido aqui; a conexão
 * vem do `TenantContext`.
 */
import path from "node:path";

import { logger } from "@/lib/logger";
import { capturarErro } from "@/src/obs/erros";
import { rodarCortes } from "@/src/reminder/corte";
import { rodarLembretes } from "@/src/reminder/envio";

const CAMINHO_ABSOLUTO = path.resolve(process.argv[1] ?? "workers/lembrete-worker.ts");

/** De hora em hora (§5.12). Milissegundos. */
const INTERVALO_PADRAO_MS = 3_600_000;

function intervaloDoAmbiente(): number {
  const bruto = Number.parseInt(process.env.REMINDER_WORKER_INTERVAL_MS ?? "", 10);
  return Number.isFinite(bruto) && bruto > 0 ? bruto : INTERVALO_PADRAO_MS;
}

async function umCiclo(): Promise<void> {
  const disparo = await rodarLembretes();
  // F06-T01: ciclo em JSON de uma linha. As linhas POR tenant/job, com o
  // `organization_id`, saem de `src/reminder/envio.ts` (`job.run`).
  logger.info("worker.cycle", {
    worker: "reminder",
    request_id: `cycle-${process.pid}-${Date.now()}`,
    organization_id: null,
    tenants_eligible: disparo.tenants_eligible,
    fired: disparo.tenants_fired,
    failed: disparo.tenants_failed,
    sent: disparo.sent,
    duplicates_avoided: disparo.duplicates_avoided,
  });
  const corte = await rodarCortes();
  logger.info("worker.cycle", {
    worker: "reminder-cutoff",
    request_id: `cycle-${process.pid}-${Date.now()}`,
    organization_id: null,
    tenants_eligible: corte.tenants_eligible,
    runs_cut: corte.runs_cut,
    notified: corte.notified,
    tasks_created: corte.tasks_created,
    tasks_denied: corte.tasks_denied,
  });
}

async function principal(): Promise<void> {
  logger.info("worker.start", { worker: "reminder", path: CAMINHO_ABSOLUTO });
  if (process.argv.includes("--once")) {
    await umCiclo();
    return;
  }

  let parando = false;
  const parar = (): void => {
    parando = true;
    logger.info("worker.stop", { worker: "reminder", reason: "signal" });
  };
  process.on("SIGTERM", parar);
  process.on("SIGINT", parar);

  const intervalo = intervaloDoAmbiente();
  while (!parando) {
    await umCiclo();
    if (parando) break;
    await new Promise((resolva) => setTimeout(resolva, intervalo));
  }
}

principal().then(
  () => process.exit(0),
  (erro: unknown) => {
    // Cron que sai 0 com falha dentro é cron que ninguém descobre parado (G-27).
    logger.error("worker.cycle_failed", { worker: "reminder", error_code: erro instanceof Error ? erro.name : "unknown" });
    capturarErro(erro, { job_type: "recurring_reminder", error_code: erro instanceof Error ? erro.name : "unknown" });
    process.exit(1);
  },
);
