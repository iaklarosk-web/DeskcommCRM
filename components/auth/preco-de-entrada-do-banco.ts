import { menorPrecoAnunciavel, type PrecoDeEntrada } from "@/components/auth/preco-de-entrada";
import { logger } from "@/lib/logger";
import { listarPlanos } from "@/src/billing/planos";

/**
 * O preço que a fachada anuncia, lido de `plans` (D14 — a tela e o Stripe
 * nascem da mesma linha). Separado de `preco-de-entrada.ts` (a regra pura,
 * testada sem banco) e de `PainelDeApresentacao` (que é síncrono para poder
 * ser renderizado por `renderToStaticMarkup` em `marca-na-fachada-de-acesso`).
 *
 * É a única leitura de banco da casca pública, e ela falha FECHADA para o
 * painel — sem preço — e nunca para a tela de entrar: derrubar o login por
 * causa de uma frase promocional seria o pior negócio possível.
 */
export async function precoDeEntradaDoBanco(): Promise<PrecoDeEntrada | null> {
  try {
    return menorPrecoAnunciavel(await listarPlanos());
  } catch (erro) {
    logger.warn("fachada: preço dos planos indisponível; painel sai sem preço", {
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return null;
  }
}
