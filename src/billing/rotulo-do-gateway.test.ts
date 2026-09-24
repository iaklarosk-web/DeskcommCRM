/**
 * A TELA NÃO PODE DIZER "NÃO COBRA" QUANDO COBRA.
 *
 * Achado em 24/09/2026 na varredura de promessas vazias: `/admin/billing`
 * afirmava "Gateway em modo de teste: nenhuma cobrança real acontece" com texto
 * FIXO, enquanto a produção rodava `billing_gateway=stripe/live` havia quatro
 * dias. Nenhum dos 8.603 testes falhava, porque teste nenhum perguntava se a
 * tela dizia a verdade.
 */
import { describe, expect, it } from "vitest";

import { rotuloDoGateway } from "./rotulo-do-gateway";

describe("rótulo do gateway — a tela repete a configuração, não a inventa", () => {
  it("stripe + live AVISA que o dinheiro é real", () => {
    const r = rotuloDoGateway({ gateway: "stripe", modo: "live" });

    expect(r.cobra_de_verdade).toBe(true);
    expect(r.texto).not.toMatch(/nenhuma cobrança real/i);
    expect(r.texto).toMatch(/real|verdade/i);
  });

  it("CONTROLE — stripe + test continua dizendo que não cobra", () => {
    const r = rotuloDoGateway({ gateway: "stripe", modo: "test" });

    expect(r.cobra_de_verdade).toBe(false);
    expect(r.texto).toMatch(/nenhuma cobrança real/i);
  });

  it("CONTROLE — mock não cobra, mesmo com STRIPE_MODE=live sobrando no ambiente", () => {
    // O modo do Stripe é irrelevante quando o gateway nem é o Stripe; sem este
    // caso, um `modo === "live"` solto faria a tela gritar sem motivo.
    const r = rotuloDoGateway({ gateway: "mock", modo: "live" });

    expect(r.cobra_de_verdade).toBe(false);
    expect(r.texto).toMatch(/simulado/i);
  });
});
