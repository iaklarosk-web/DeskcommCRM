/**
 * F15-T04 — `assign_owner`: a tool que entrega uma oportunidade (ADR-036 §2 T04).
 *
 * Delega ao módulo da fila da F13 (`src/crm/oportunidades`): o mesmo
 * `atribuir` que a tela e o claim usam, a mesma linha `owner_assigned` na linha
 * do tempo. Recusas do domínio viram `denied: domain_rejected` com o código
 * (já atribuída, sem elegível, oportunidade inexistente) — nunca exceção.
 */
import { atribuirPorRodizio, JaAtribuida, OportunidadeNaoEncontrada, SemElegivel } from "@/src/crm/oportunidades";

import { assignOwnerInputSchema } from "../schemas";
import { bind, type ToolRunner } from "./contrato";

export const assignOwner: ToolRunner = bind(
  assignOwnerInputSchema,
  async ({ ctx, deps }, input) => {
    try {
      const r = await atribuirPorRodizio(ctx, input.opportunity_id, input.user_id, { pool: deps.pool });
      return { ok: true, output: { opportunity_id: r.opportunity_id, user_id: r.user_id, mode: r.mode }, resourceId: r.opportunity_id };
    } catch (erro) {
      if (erro instanceof JaAtribuida) return { ok: false, reason: "domain_rejected", resourceId: input.opportunity_id, detalhe: "already_assigned" };
      if (erro instanceof SemElegivel) return { ok: false, reason: "domain_rejected", resourceId: input.opportunity_id, detalhe: "no_eligible_member" };
      if (erro instanceof OportunidadeNaoEncontrada) return { ok: false, reason: "domain_rejected", resourceId: null, detalhe: "opportunity_not_found" };
      throw erro;
    }
  },
);
