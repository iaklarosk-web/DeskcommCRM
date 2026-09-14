/**
 * F13-T03 (ADR-034 §2) — o rodízio da fila de oportunidades, puro. A prova
 * com banco (fila lida de `crm_leads`, claim, `owner_assigned`) é a
 * integração; aqui o contrato do rodízio, com o mutante 68 apontado para
 * "rodízio equilibra".
 */
import { describe, expect, it } from "vitest";

import { distribuirPorRodizio, equilibrada, type Elegivel, type OportunidadeNaFila } from "@/src/crm/oportunidades";

const AGORA = new Date("2026-09-14T12:00:00.000Z");
const fila = (n: number): OportunidadeNaFila[] =>
  Array.from({ length: n }, (_, i) => ({ id: `op-${String(i).padStart(2, "0")}`, created_at: new Date(AGORA.getTime() - (n - i) * 60_000).toISOString() }));
const elegivel = (userId: string, lastAssignedAt: number | null = null, currentLoad = 0): Elegivel => ({ userId, lastAssignedAt, currentLoad });

describe("F13-T03 — distribuirPorRodizio", () => {
  it("rodízio equilibra", () => {
    const elegiveis = [elegivel("u-a"), elegivel("u-b"), elegivel("u-c")];
    const atribuicoes = distribuirPorRodizio(fila(7), elegiveis, AGORA);
    const porUsuario = new Map<string, number>();
    for (const a of atribuicoes) porUsuario.set(a.user_id, (porUsuario.get(a.user_id) ?? 0) + 1);
    const contagens = [...porUsuario.entries()].sort().map(([u, n]) => `${u}=${n}`).join(" ");
    expect(atribuicoes).toHaveLength(7);
    // 7 oportunidades em 3 pessoas: 3/2/2 — max − min = 1. Sempre o primeiro daria 7/0/0.
    expect(equilibrada(atribuicoes, elegiveis), `balanced=0: ${contagens}`).toBe(true);
    expect(Math.max(...porUsuario.values()) - Math.min(...porUsuario.values()), `balanced: ${contagens}`).toBeLessThanOrEqual(1);
  });

  it("quem recebeu há mais tempo (ou nunca) vem primeiro; a ordem da fila é a de chegada", () => {
    const elegiveis = [elegivel("u-a", AGORA.getTime() - 1000), elegivel("u-b", null), elegivel("u-c", AGORA.getTime() - 5000)];
    const atribuicoes = distribuirPorRodizio(fila(3), elegiveis, AGORA);
    expect(atribuicoes.map((a) => a.opportunity_id)).toEqual(["op-00", "op-01", "op-02"]);
    expect(atribuicoes.map((a) => a.user_id)).toEqual(["u-b", "u-c", "u-a"]);
  });

  it("sem elegível ninguém é atribuído; sem fila nada acontece; a entrada não é mutada", () => {
    const elegiveis = [elegivel("u-a", 10)];
    expect(distribuirPorRodizio(fila(2), [], AGORA)).toEqual([]);
    expect(distribuirPorRodizio([], elegiveis, AGORA)).toEqual([]);
    distribuirPorRodizio(fila(2), elegiveis, AGORA);
    expect(elegiveis[0]).toEqual({ userId: "u-a", lastAssignedAt: 10, currentLoad: 0 });
  });

  it("equilibrada: max − min ≤ 1 sobre TODOS os elegíveis, inclusive quem não recebeu nada", () => {
    expect(equilibrada([{ opportunity_id: "x", user_id: "a" }, { opportunity_id: "y", user_id: "a" }], [{ userId: "a" }, { userId: "b" }])).toBe(false);
    expect(equilibrada([{ opportunity_id: "x", user_id: "a" }], [{ userId: "a" }, { userId: "b" }])).toBe(true);
    expect(equilibrada([], [])).toBe(true);
  });
});
