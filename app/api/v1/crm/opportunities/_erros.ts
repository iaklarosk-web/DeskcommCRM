import { fail } from "@/lib/api/wrappers";
import { DistribuicaoManual, JaAtribuida, OportunidadeNaoEncontrada, PedidoDeOutraOrganizacao } from "@/src/crm/oportunidades";

/** Os erros do módulo de oportunidades viram envelope `{error}` com o status deles. */
export function falhaDaOportunidade(error: unknown, requestId: string): Response | null {
  if (error instanceof DistribuicaoManual) return fail(error.code, "A organização distribui manualmente. Ligue o rodízio em Configurações.", error.status, { requestId });
  if (error instanceof JaAtribuida) return fail(error.code, "Esta oportunidade já tem responsável.", error.status, { requestId });
  if (error instanceof OportunidadeNaoEncontrada) return fail(error.code, "Oportunidade não encontrada.", error.status, { requestId });
  if (error instanceof PedidoDeOutraOrganizacao) return fail(error.code, "Pedido não encontrado.", error.status, { requestId });
  return null;
}
