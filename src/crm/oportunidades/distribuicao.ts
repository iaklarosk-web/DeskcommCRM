/**
 * F13-T03 (ADR-034 §2) — o RODÍZIO da fila de oportunidades, puro.
 *
 * Reusa `selectRoundRobin` de `lib/routing/decide.ts` (a fila de CONVERSAS):
 * entre os elegíveis, quem recebeu atribuição há mais tempo (ou nunca) vem
 * primeiro; desempate por id. A cada atribuição o escolhido passa a ser "o
 * mais recente", então a N-ésima oportunidade cai no N-ésimo elegível —
 * `balanced=1` (max − min ≤ 1) é consequência, não configuração.
 *
 * Sabotar a escolha é o mutante 68 (ADR-035 §4).
 */
import { selectRoundRobin, type RoutingCandidate } from "@/lib/routing/decide";

export interface OportunidadeNaFila {
  id: string;
  /** ISO; a ordem da fila é a de chegada. */
  created_at: string;
}

export type Elegivel = RoutingCandidate;

export interface Atribuicao {
  opportunity_id: string;
  user_id: string;
}

export function distribuirPorRodizio(
  fila: readonly OportunidadeNaFila[],
  elegiveis: readonly Elegivel[],
  agora: Date,
): Atribuicao[] {
  if (elegiveis.length === 0) return [];
  const estado: Elegivel[] = elegiveis.map((e) => ({ ...e }));
  const ordenada = [...fila].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const saida: Atribuicao[] = [];
  for (const [i, o] of ordenada.entries()) {
    const escolhido = selectRoundRobin(estado);
    if (!escolhido) break;
    saida.push({ opportunity_id: o.id, user_id: escolhido });
    const e = estado.find((c) => c.userId === escolhido)!;
    e.lastAssignedAt = agora.getTime() + i;
    e.currentLoad += 1;
  }
  return saida;
}

/** `true` quando a diferença entre o mais e o menos carregado é ≤ 1. */
export function equilibrada(atribuicoes: readonly Atribuicao[], elegiveis: readonly Pick<Elegivel, "userId">[]): boolean {
  if (elegiveis.length === 0) return atribuicoes.length === 0;
  const porUsuario = new Map<string, number>(elegiveis.map((e) => [e.userId, 0]));
  for (const a of atribuicoes) porUsuario.set(a.user_id, (porUsuario.get(a.user_id) ?? 0) + 1);
  const valores = [...porUsuario.values()];
  return Math.max(...valores) - Math.min(...valores) <= 1;
}
