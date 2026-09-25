/**
 * Ponte teste → verify.sh (F01-T11): o reporter do vitest engole console.log
 * de teste que passa, então cada suíte que produz uma linha do VERIFY SUMMARY
 * a grava TAMBÉM em .verify-logs/metrics/<nome>.line — verify.sh lê dali,
 * sempre do run que ele mesmo acabou de disparar. Quando VERIFY_LOG_DIR está
 * presente, escrever é obrigatório: ausência de evidência reprova o gate.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export function gravarLinhaDoVerify(nome: string, linha: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(nome)) throw new Error("Nome de métrica inválido");
  try {
    const raiz = process.env.VERIFY_LOG_DIR
      ? path.resolve(process.env.VERIFY_LOG_DIR)
      : path.resolve(__dirname, "../../.verify-logs");
    const dir = path.join(raiz, "metrics");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${nome}.line`), `${linha}\n`);
  } catch (error) {
    if (process.env.VERIFY_LOG_DIR) throw error;
    /* Fora da bateria, os asserts continuam independentes do artifact local. */
  }
}
