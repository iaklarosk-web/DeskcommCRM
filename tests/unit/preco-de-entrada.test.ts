import { describe, expect, it } from "vitest";

import { menorPrecoAnunciavel } from "@/components/auth/preco-de-entrada";
import type { Plano } from "@/src/billing/planos";

function plano(parcial: Partial<Plano> & Pick<Plano, "code" | "price_cents">): Plano {
  return {
    name: parcial.code,
    currency: "BRL",
    period_days: 30,
    limits: {},
    active: true,
    source: "owner",
    ...parcial,
  };
}

/**
 * F23: a fachada anuncia "a partir de" — e "a partir de R$ 0" seria mentira com
 * cara de promoção. Placeholder (preço 0) e plano desligado não contam.
 */
describe("menorPrecoAnunciavel", () => {
  it("escolhe o menor preço entre os planos ativos com preço acima de zero", () => {
    // Arrange
    const planos = [
      plano({ code: "PLAN_B", price_cents: 59700 }),
      plano({ code: "PLAN_A", price_cents: 19700 }),
      plano({ code: "PLAN_C", price_cents: 149700 }),
    ];
    // Act
    const menor = menorPrecoAnunciavel(planos);
    // Assert
    expect(menor).toEqual({ price_cents: 19700, currency: "BRL" });
  });

  it("ignora placeholder com preço zero e plano inativo", () => {
    const planos = [
      plano({ code: "PLAN_A", price_cents: 0, source: "placeholder" }),
      plano({ code: "PLAN_X", price_cents: 100, active: false }),
      plano({ code: "PLAN_B", price_cents: 59700 }),
    ];
    expect(menorPrecoAnunciavel(planos)).toEqual({ price_cents: 59700, currency: "BRL" });
  });

  it("devolve null quando nenhum plano é anunciável — a linha de preço some", () => {
    expect(menorPrecoAnunciavel([])).toBeNull();
    expect(menorPrecoAnunciavel([plano({ code: "PLAN_A", price_cents: 0 })])).toBeNull();
  });
});
