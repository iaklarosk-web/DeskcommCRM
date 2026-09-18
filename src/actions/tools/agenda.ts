/**
 * `schedule_appointment` (F14-T04, ADR-038 §2 T04): a IA marca horário pela
 * fachada SaaS da agenda (`src/agenda`), pelo caminho ÚNICO `execute()` — é
 * ele que consulta a política por ação da F15 ANTES de chegar aqui: `approve`
 * (default por D33, risco `medium`) pendura em `pending_actions` e a pessoa
 * aprova; `allow` chega direto; `block`/`transfer` nem chegam.
 *
 * O contato é o da CONVERSA (nunca o que o modelo disser): a tool recebe
 * `conversation_id` e lê o `contact_id` no banco. O compromisso nasce ligado
 * aos dois. Recusas do domínio viram `domain_rejected` com o motivo curto —
 * conflito com o id do compromisso que colide, horário fora dos oferecidos,
 * tipo desconhecido — para o modelo propor OUTRO horário, não inventar.
 */
import { marcar } from "@/src/agenda";
import { withTenant } from "@/src/tenant-context";

import { scheduleAppointmentInputSchema } from "../schemas";
import { bind, type ToolRunner } from "./contrato";

export const scheduleAppointment: ToolRunner = bind(
  scheduleAppointmentInputSchema,
  async ({ ctx, actor, deps, requestId }, input) => {
    const conversa = await withTenant(
      ctx,
      async (db) =>
        (await db.query<{ contact_id: string }>(`select contact_id from public.conversations where id = $1 and organization_id = $2`, [input.conversation_id, ctx.organization_id])).rows[0] ?? null,
      { pool: deps.pool },
    );
    if (conversa === null) return { ok: false, reason: "domain_rejected", resourceId: null, detalhe: "conversation_not_found" };
    const ator = actor.kind === "human" && actor.user_id ? { kind: "human" as const, user_id: actor.user_id } : actor.kind === "automation" ? { kind: "automation" as const } : { kind: "ai" as const, request_id: requestId };
    const r = await marcar(
      ctx,
      ator,
      { event_type_id: input.event_type_id, starts_at: input.starts_at, timezone: input.timezone, contact_id: conversa.contact_id, conversation_id: input.conversation_id, notes: input.notes },
      { pool: deps.pool, requestId },
    );
    if (!r.ok) {
      return { ok: false, reason: "domain_rejected", resourceId: r.conflicting_id ?? null, detalhe: r.conflicting_id ? `conflict:${r.conflicting_id}` : r.reason };
    }
    return {
      ok: true,
      output: { appointment_id: r.compromisso.id, starts_at: r.compromisso.starts_at, ends_at: r.compromisso.ends_at, time_zone: r.compromisso.time_zone, status: r.compromisso.status === "pending" ? "pending" : "confirmed" },
      resourceId: r.compromisso.id,
    };
  },
);
