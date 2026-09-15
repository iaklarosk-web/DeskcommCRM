/**
 * Emissor ÚNICO dos eventos de domínio da F15 no `event_log` (ADR-036 §2 T00).
 *
 * O barramento herdado (`public.emit_event`, §5.13) já é o que o motor de
 * regras consome (`lib/automation/engine.ts` lê `event_type` por organização).
 * Só `lead.stage_changed`/`lead.created` existiam; as três regras de §7.9 que
 * o proprietário aprovou (4×4, D54) precisam de `conversation.resolved`,
 * `order.confirmed` e `task.overdue` — e um evento sem emissor é uma regra
 * que nunca dispara (objeção 1 do contraponto).
 *
 * Regras:
 *  - sempre dentro do TenantDb da transação que fez o efeito (o evento nasce
 *    junto do fato, ou não nasce);
 *  - `organization_id` explícito (D20: job/webhook sem tenant é rejeitado —
 *    aqui a função SQL levanta se faltar);
 *  - payload só com ids e valores escalares; texto de cliente nunca (D18).
 */
import type { TenantCtx, TenantDb } from "@/src/tenant-context";

/** Os três tipos que a F15 acrescenta ao barramento, mais os dois herdados de lead. */
export const EVENTOS_DA_F15 = ["conversation.resolved", "order.confirmed", "task.overdue"] as const;
export type EventoDaF15 = (typeof EVENTOS_DA_F15)[number];

/** `entity_kind` por tipo — o motor confere (`EXPECTED_ENTITY_KIND`). */
export const ENTIDADE_DO_EVENTO: Record<EventoDaF15, "conversation" | "crm_order" | "crm_task"> = {
  "conversation.resolved": "conversation",
  "order.confirmed": "crm_order",
  "task.overdue": "crm_task",
};

export interface EmissaoDeEvento {
  readonly type: EventoDaF15;
  readonly entity_id: string;
  readonly payload: Record<string, string | number | boolean | null>;
  /** `source` vai para `metadata` — quem emitiu, para a auditoria e o motor. */
  readonly source: string;
}

export async function emitirEvento(db: TenantDb, ctx: TenantCtx, emissao: EmissaoDeEvento): Promise<string> {
  const resultado = await db.query<{ id: string }>(
    `select public.emit_event($1::text,$2::text,$3::uuid,$4::jsonb,$5::jsonb,$6::uuid) as id`,
    [
      emissao.type,
      ENTIDADE_DO_EVENTO[emissao.type],
      emissao.entity_id,
      JSON.stringify({ organization_id: ctx.organization_id, ...emissao.payload }),
      JSON.stringify({ source: emissao.source }),
      ctx.organization_id,
    ],
  );
  const id = resultado.rows[0]?.id;
  if (typeof id !== "string") throw new Error(`emit_event não devolveu id para ${emissao.type}`);
  return id;
}
