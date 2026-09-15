/**
 * Contadores nomeados da DIRETRIZ §5.17 (tenant_ctx_rejected, settings_rejected,
 * conversation_illegal_transition, unknown_fields, actions_denied, …).
 *
 * Registro em memória, por processo: o valor sai em /api/v1/health (F06-T04) e
 * no VERIFY SUMMARY — não é métrica de série temporal, é o "quantas vezes desde
 * o boot" que faz zero-por-3-execuções virar hipótese de bug (G-03). Quem
 * precisar de histórico usa audit_events; este módulo é de propósito o menor
 * mecanismo que cumpre o contrato.
 */

const registro = new Map<string, number>();

type Labels = Record<string, string>;

function chave(nome: string, labels?: Labels): string {
  if (!labels || Object.keys(labels).length === 0) return nome;
  const pares = Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(",");
  return `${nome}{${pares}}`;
}

export function incrementCounter(nome: string, labels?: Labels): void {
  const k = chave(nome, labels);
  registro.set(k, (registro.get(k) ?? 0) + 1);
}

/** Valor de uma combinação exata nome+labels. */
export function counterValue(nome: string, labels?: Labels): number {
  return registro.get(chave(nome, labels)) ?? 0;
}

/** Soma de todas as combinações de labels de um contador (o número do VERIFY). */
export function counterTotal(nome: string): number {
  let total = 0;
  for (const [k, v] of registro) {
    if (k === nome || k.startsWith(`${nome}{`)) total += v;
  }
  return total;
}

/** Retrato imutável para o health endpoint. */
export function snapshotCounters(): Readonly<Record<string, number>> {
  return Object.fromEntries(registro);
}

/** Só para testes: cada arquivo parte do zero. */
export function resetCounters(): void {
  registro.clear();
}
