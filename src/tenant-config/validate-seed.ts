/**
 * validateSeed (§5.2) — o portão do create-tenant.sh: nenhuma inserção antes
 * de o seed inteiro passar. Recebe o OBJETO já parseado do YAML (quem parseia
 * é o chamador; este módulo não escolhe parser).
 *
 * A regra do placeholder (invariante 3 da §5.2): valor com o prefixo `TODO-`
 * — a forma que a §5.21 fixa para o seed de partida, inclusive a anotada
 * `TODO-<tenant> (perguntado em <data>, não sabe)` — é sentinela de pendência:
 * a chave é ACEITA, a checagem de tipo é pulada e a ocorrência conta em
 * `seed_todos`. Sem isso o seed de partida (que a §5.21 manda existir com
 * placeholders) seria rejeitado por tipo e o create-tenant não criaria os dois
 * tenants da F01-T06. O prefixo é genérico DE PROPÓSITO (D06: nenhum nome de
 * cliente em src/ — o DoD da T06 mede `grep -ril <tenant> src/` = 0); o valor
 * literal nos seeds continua o que a DIRETRIZ fixa. Qualquer outro valor é
 * validado normalmente.
 */
import { incrementCounter } from "@/src/obs/counters";

import { entradaDoSchema } from "./schema";
import { validar } from "./validators";

export interface ResultadoDoSeed {
  errors: string[];
  /** Ocorrências de sentinela TODO- aceitas como pendência. */
  seed_todos: number;
}

function eTodoPendente(v: unknown): boolean {
  return typeof v === "string" && v.startsWith("TODO-");
}

/** Conta sentinelas dentro de um valor-objeto (ex.: campos do reminder). */
function contarTodosInternos(v: unknown): number {
  if (eTodoPendente(v)) return 1;
  if (Array.isArray(v)) return v.reduce<number>((n, x) => n + contarTodosInternos(x), 0);
  if (typeof v === "object" && v !== null) {
    return Object.values(v).reduce<number>((n, x) => n + contarTodosInternos(x), 0);
  }
  return 0;
}

/**
 * Achata o bloco `settings:` do seed para pares (chave-do-schema, valor).
 * A regra de parada: no nível em que o caminho acumulado JÁ é uma chave do
 * schema (ex.: `orders.recurring_reminder`), o valor inteiro é o Setting —
 * não se desce mais (o objeto do reminder é UM valor).
 */
function achatar(
  prefixo: string,
  valor: unknown,
  saida: Array<{ key: string; value: unknown }>,
  errors: string[],
): void {
  if (entradaDoSchema(prefixo)) {
    saida.push({ key: prefixo, value: valor });
    return;
  }
  if (typeof valor === "object" && valor !== null && !Array.isArray(valor)) {
    for (const [k, v] of Object.entries(valor)) {
      achatar(prefixo === "" ? k : `${prefixo}.${k}`, v, saida, errors);
    }
    return;
  }
  incrementCounter("settings_rejected", { reason: "unknown_key" });
  errors.push(`settings.${prefixo}: chave fora do schema (§5.2)`);
}

export function validateSeed(seed: { settings?: unknown }): ResultadoDoSeed {
  const errors: string[] = [];
  let seedTodos = 0;

  const settings = seed.settings;
  if (settings === undefined) {
    return { errors, seed_todos: 0 };
  }
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    return { errors: ["settings: esperava um objeto de grupos"], seed_todos: 0 };
  }

  const pares: Array<{ key: string; value: unknown }> = [];
  achatar("", settings, pares, errors);

  for (const { key, value } of pares) {
    const entrada = entradaDoSchema(key);
    if (!entrada) continue; // já reportado na achatada
    const todosAqui = contarTodosInternos(value);
    if (todosAqui > 0) {
      seedTodos += todosAqui;
      continue; // sentinela: aceita, sem checagem de tipo
    }
    const motivo = validar(entrada, value);
    if (motivo !== null) {
      errors.push(`settings.${key}: ${motivo}`);
    }
  }

  return { errors, seed_todos: seedTodos };
}
