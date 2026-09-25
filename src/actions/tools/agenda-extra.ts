/**
 * As cinco leituras/escritas de agenda que saem do MCP herdado (F18-T02,
 * ADR-040 §2) e o cancelamento (T03).
 *
 * `schedule_appointment` (F14-T04) já vive em `agenda.ts`; estas são as que
 * faltavam para o agente publicado não perder capacidade ao trocar de motor:
 * ver os tipos de atendimento, procurar horário livre, listar compromissos,
 * confirmar, registrar desfecho e desmarcar.
 */
import {
  cancelar,
  confirmar,
  horariosLivresDaOrganizacao,
  listarCompromissos,
  listarTiposDeAtendimento,
  registrarDesfecho,
  type AtorDaAgenda,
} from "@/src/agenda";

import {
  cancelAppointmentInputSchema,
  confirmAppointmentInputSchema,
  findFreeSlotsInputSchema,
  listAppointmentsInputSchema,
  listEventTypesInputSchema,
  setAppointmentOutcomeInputSchema,
} from "../schemas";
import { bind, type ToolRunner } from "./contrato";

const atorDaAgenda = (actor: { kind: string; user_id?: string }): AtorDaAgenda =>
  actor.kind === "human" && actor.user_id
    ? { kind: "human", user_id: actor.user_id }
    : actor.kind === "automation"
      ? { kind: "automation" }
      : { kind: "ai" };

export const listEventTypes: ToolRunner = bind(listEventTypesInputSchema, async ({ ctx, deps }) => {
  const tipos = await listarTiposDeAtendimento(ctx, { pool: deps.pool });
  return { ok: true, resourceId: null, output: { event_types: tipos } };
});

export const findFreeSlots: ToolRunner = bind(findFreeSlotsInputSchema, async ({ ctx, deps }, input) => {
  const de = new Date(input.from);
  const ate = new Date(de.getTime() + input.days * 24 * 60 * 60 * 1000);
  const r = await horariosLivresDaOrganizacao(
    ctx,
    { event_type_id: input.event_type_id, de, ate },
    { pool: deps.pool },
  );
  if (!r.ok) return { ok: false, reason: "domain_rejected", resourceId: null, detalhe: r.reason };
  return {
    ok: true,
    resourceId: null,
    output: {
      slots: r.slots.map((s) => ({ starts_at: s.inicio.toISOString(), ends_at: s.fim.toISOString() })),
      time_zone: r.fuso,
    },
  };
});

export const listAppointments: ToolRunner = bind(listAppointmentsInputSchema, async ({ ctx, deps }, input) => {
  const compromissos = await listarCompromissos(
    ctx,
    {
      ...(input.contact_id === null ? {} : { contact_id: input.contact_id }),
      ...(input.from === null ? {} : { de: input.from }),
      ...(input.to === null ? {} : { ate: input.to }),
    },
    { pool: deps.pool },
  );
  return { ok: true, resourceId: null, output: { appointments: compromissos } };
});

export const confirmAppointment: ToolRunner = bind(confirmAppointmentInputSchema, async ({ ctx, actor, deps, requestId }, input) => {
  const r = await confirmar(ctx, atorDaAgenda(actor), { id: input.appointment_id, revision: input.revision }, { pool: deps.pool, requestId });
  if (!r.ok) return { ok: false, reason: "domain_rejected", resourceId: input.appointment_id, detalhe: r.reason };
  return { ok: true, resourceId: r.compromisso.id, output: { appointment: r.compromisso } };
});

export const setAppointmentOutcome: ToolRunner = bind(setAppointmentOutcomeInputSchema, async ({ ctx, actor, deps, requestId }, input) => {
  const r = await registrarDesfecho(
    ctx,
    atorDaAgenda(actor),
    { id: input.appointment_id, revision: input.revision, outcome: input.outcome },
    { pool: deps.pool, requestId },
  );
  if (!r.ok) return { ok: false, reason: "domain_rejected", resourceId: input.appointment_id, detalhe: r.reason };
  return { ok: true, resourceId: r.compromisso.id, output: { appointment: r.compromisso } };
});

/**
 * Desmarcar (F18-T03, ADR-040 §4; D56 e).
 *
 * É a única ação de efeito externo que a IA executa SEM aprovação humana —
 * decisão do proprietário, com o risco declarado. Os freios que ficam vivem na
 * fachada e no banco, não aqui: compromisso passado não é cancelável, motivo é
 * obrigatório, a revisão evita desmarcar o que outra pessoa já mudou, e toda
 * execução é auditada.
 */
export const cancelAppointment: ToolRunner = bind(cancelAppointmentInputSchema, async ({ ctx, actor, deps, requestId }, input) => {
  const r = await cancelar(
    ctx,
    atorDaAgenda(actor),
    { id: input.appointment_id, revision: input.revision, reason: input.reason },
    { pool: deps.pool, requestId },
  );
  if (!r.ok) return { ok: false, reason: "domain_rejected", resourceId: input.appointment_id, detalhe: r.reason };
  return { ok: true, resourceId: r.compromisso.id, output: { appointment: r.compromisso } };
});
