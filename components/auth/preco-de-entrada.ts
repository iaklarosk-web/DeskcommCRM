import type { Plano } from "@/src/billing/planos";

export interface PrecoDeEntrada {
  readonly price_cents: number;
  readonly currency: string;
}

/**
 * O menor preço que a fachada pode anunciar — ou nenhum.
 *
 * Só plano ATIVO com preço acima de zero entra: os placeholders da F12 nascem
 * com `price_cents = 0`, e "a partir de R$ 0" na tela pública seria a promessa
 * que o Checkout não cumpre. Sem plano anunciável a linha de preço SOME, em vez
 * de mostrar um valor inventado — é a mesma régua de D14 (o preço da tela e o
 * do Stripe nascem da mesma linha do banco).
 */
export function menorPrecoAnunciavel(planos: readonly Plano[]): PrecoDeEntrada | null {
  let menor: PrecoDeEntrada | null = null;
  for (const plano of planos) {
    if (!plano.active || !(plano.price_cents > 0)) continue;
    if (menor === null || plano.price_cents < menor.price_cents) {
      menor = { price_cents: plano.price_cents, currency: plano.currency };
    }
  }
  return menor;
}
