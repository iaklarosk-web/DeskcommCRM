/**
 * O QUE A TELA DE COBRANÇA DA PLATAFORMA PODE AFIRMAR.
 *
 * Até 24/09/2026 `/admin/billing` dizia, sem condição nenhuma, "Gateway em modo
 * de teste: nenhuma cobrança real acontece." A produção está em
 * `BILLING_GATEWAY=stripe` + `STRIPE_MODE=live` desde 20/09 (D58) — cobrança
 * real ACONTECE. A frase não era desatualizada por descuido de texto: ela
 * convidava quem administra a agir como se o sistema fosse bancada.
 *
 * A regra aqui é uma só: a tela nunca afirma "não cobra" por conta própria;
 * ela repete o que a configuração diz.
 */
export type ModoDeCobranca = { gateway: "mock" | "stripe"; modo: "test" | "live" };

export function rotuloDoGateway({ gateway, modo }: ModoDeCobranca): {
  texto: string;
  cobra_de_verdade: boolean;
} {
  if (gateway === "mock") {
    return { texto: "Gateway simulado: nenhuma cobrança real acontece.", cobra_de_verdade: false };
  }
  if (modo === "test") {
    return { texto: "Stripe em modo de teste: nenhuma cobrança real acontece.", cobra_de_verdade: false };
  }
  return { texto: "Stripe em modo REAL: toda cobrança aqui é dinheiro de verdade.", cobra_de_verdade: true };
}
