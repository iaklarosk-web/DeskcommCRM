/**
 * A assinatura que NASCE junto com uma organização provisionada pelo produto
 * (F11-T03/T04, ADR-030 §3): cadastro self-service (`pending_payment`,
 * `self_service`) e criação pelo administrador da plataforma (`active`,
 * `operator`). Seam fino sobre `src/billing/assinatura.ts`, pelo mesmo motivo
 * de `acesso-da-assinatura.ts`: os testes de unidade dos caminhos de
 * provisionamento não têm banco e o substituem por dublê; o caminho real é
 * medido em `tests/integration/f11-entrada-e-suporte.test.ts`.
 */
import { criarAssinatura, type Assinatura } from "@/src/billing/assinatura";
import type { OrigemDaAssinatura } from "@/src/billing/estados";

/** Plano em que uma organização provisionada nasce (placeholder, D14): configuração, não fato. */
export const PLANO_DEFAULT_PROVISIONADO = "PLAN_A";

export async function provisionarAssinatura(
  organizationId: string,
  entrada: { plan_code?: string; origin: OrigemDaAssinatura; status: "active" | "pending_payment" },
): Promise<Assinatura> {
  return criarAssinatura(
    { organization_id: organizationId, source: "session" },
    { plan_code: entrada.plan_code ?? PLANO_DEFAULT_PROVISIONADO, origin: entrada.origin, status: entrada.status },
  );
}
