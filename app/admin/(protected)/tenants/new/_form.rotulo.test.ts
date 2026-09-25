/**
 * O MENU DE PLANOS TEM DE DIZER O QUE ESTÁ SENDO VENDIDO.
 *
 * Até 24/09/2026 a tela de criar tenant oferecia `PLAN_A (placeholder)` com
 * rótulo FIXO no código, enquanto a produção já vendia Essencial R$ 197,
 * Profissional R$ 597 e Empresarial R$ 1.497 com Stripe LIVE (D58). Quem criasse
 * um cliente pagante escolhia de uma lista que mentia o nome e escondia o preço.
 */
import { describe, expect, it } from "vitest";

import { rotuloDoPlano } from "./_form";

describe("rótulo do plano no menu de criar tenant", () => {
  it("plano decidido pelo dono mostra nome e preço, sem a palavra placeholder", () => {
    const r = rotuloDoPlano({ code: "PLAN_A", name: "Essencial", price_cents: 19700, currency: "BRL", source: "owner" });

    expect(r).toContain("Essencial");
    expect(r).toMatch(/197/);
    expect(r).not.toMatch(/placeholder/i);
    expect(r).not.toBe("PLAN_A");
  });

  it("CONTROLE — plano ainda não decidido continua avisando que é placeholder", () => {
    // Sem este caso, tirar o aviso viraria a mentira oposta: vender como
    // decidido um plano que o proprietário ainda não definiu.
    const r = rotuloDoPlano({ code: "PLAN_B", name: "PLAN_B", price_cents: 0, currency: "BRL", source: "placeholder" });

    expect(r).toMatch(/placeholder/i);
  });

  it("CONTROLE — o preço sai em reais, não em centavos", () => {
    const r = rotuloDoPlano({ code: "PLAN_C", name: "Empresarial", price_cents: 149700, currency: "BRL", source: "owner" });

    expect(r).not.toMatch(/149700/);
    expect(r).toMatch(/1\.497/);
  });
});
