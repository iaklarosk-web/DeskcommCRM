/**
 * O que a ASSINATURA da organização ativa permite nesta requisição
 * (F11-T04/F12-T04, ADR-030 §3; D38, D44). Seam fino sobre
 * `src/billing/acesso.ts` para o guarda de rota e o layout: os testes de
 * unidade que exercitam `requireRole` sem banco o substituem por um dublê
 * (`vi.mock("@/lib/auth/acesso-da-assinatura")`), e é por isso que a leitura
 * mora num módulo próprio em vez de dentro do guarda.
 *
 * Falha na leitura é ERRO (503 no guarda): o guarda nunca supõe `full` quando
 * o banco não respondeu — serviço sem resposta falha fechado (G-27).
 */
import { estadoDeAcesso, type EstadoDeAcesso } from "@/src/billing/acesso";

export async function acessoDaOrganizacao(organizationId: string): Promise<EstadoDeAcesso> {
  return estadoDeAcesso(organizationId);
}
