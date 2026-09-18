/**
 * F14-T03 — o conflito de agenda com nome (ADR-038 §2 T03), sem banco: dois
 * compromissos VIVOS do mesmo responsável não se sobrepõem; cancelado, faltou
 * e concluído liberam o horário; encostar (fim = início) não é conflito.
 * Alvo do mutante 76: "conflito recusa".
 */
import { describe, expect, it } from "vitest";

import { detectarConflito, type CompromissoExistente } from "@/src/agenda";

const as = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 6, h, m));
const c = (id: string, ini: Date, fim: Date, status = "confirmed"): CompromissoExistente => ({ id, starts_at: ini.toISOString(), ends_at: fim.toISOString(), status });

describe("F14-T03 — conflito de agenda", () => {
  // Título curto DE PROPÓSITO: alvo do mutante 76 (`-t` exato).
  it("conflito recusa", () => {
    const existentes = [c("a1", as(14), as(15))];
    // A primeira asserção nomeia o invariante: o mutante 76 tem de derrubá-la.
    expect(detectarConflito(existentes, as(14, 30), as(15, 30))?.id, "sobreposição passou").toBe("a1");
    expect(detectarConflito(existentes, as(13), as(14, 1))?.id).toBe("a1");
    expect(detectarConflito(existentes, as(14), as(15))?.id).toBe("a1");
    console.info("f14-t03-conflito: overlap_denied=3/3");
  });

  it("encostar não conflita; cancelado/no_show/completed liberam; pending e confirmed ocupam", () => {
    expect(detectarConflito([c("a1", as(14), as(15))], as(15), as(16))).toBeNull();
    expect(detectarConflito([c("a1", as(14), as(15))], as(13), as(14))).toBeNull();
    for (const livre of ["cancelled", "no_show", "completed"]) {
      expect(detectarConflito([c("x", as(14), as(15), livre)], as(14), as(15)), `${livre} ocupou`).toBeNull();
    }
    for (const ocupa of ["pending", "confirmed"]) {
      expect(detectarConflito([c("y", as(14), as(15), ocupa)], as(14), as(15))?.id, `${ocupa} liberou`).toBe("y");
    }
  });
});
