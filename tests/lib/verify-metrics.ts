/**
 * Ponte teste → verify.sh (F01-T11): o reporter do vitest engole console.log
 * de teste que passa, então cada suíte que produz uma linha do VERIFY SUMMARY
 * a grava TAMBÉM em .verify-logs/metrics/<nome>.line — verify.sh lê dali,
 * sempre do run que ele mesmo acabou de disparar. Best-effort de propósito:
 * teste nunca falha por não conseguir gravar métrica.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export function gravarLinhaDoVerify(nome: string, linha: string): void {
  try {
    const dir = path.resolve(__dirname, "../../.verify-logs/metrics");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${nome}.line`), `${linha}\n`);
  } catch {
    /* métrica é conveniência do verify; o veredito é dos asserts */
  }
}
