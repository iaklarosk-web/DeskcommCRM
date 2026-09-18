/**
 * As sete ações de lead/funil e a proposta de campo (F18-T02, ADR-040 §2).
 *
 * Saíram do MCP herdado, onde a IA as usava sem política, sem teto diário e
 * sem auditoria por ação; entram pelo caminho único `execute()`, que consulta
 * a política ANTES de chegar aqui. Cada uma só monta argumento e lê resultado:
 * a consulta parametrizada vive na fachada (`src/crm/funil`, `src/crm/proposta`).
 *
 * Recusa do domínio vira `domain_rejected` com um motivo curto — o modelo
 * precisa saber que não deu e por quê, para propor outra coisa em vez de
 * inventar que deu certo.
 */
import { atualizarLead, criarLead, lerLead, listarEstagios, listarFunis, listarLeads, moverLead, type AtorDoFunil } from "@/src/crm/funil";
import { proporCampoDoContato } from "@/src/crm/proposta";

import {
  createLeadInputSchema,
  getLeadInputSchema,
  listLeadsInputSchema,
  listPipelinesInputSchema,
  listStagesInputSchema,
  moveLeadStageInputSchema,
  proposeContactFieldInputSchema,
  updateLeadInputSchema,
} from "../schemas";
import { bind, type ToolRunner } from "./contrato";

const atorDoFunil = (actor: { kind: string; user_id?: string }): AtorDoFunil =>
  actor.kind === "human" && actor.user_id
    ? { kind: "human", user_id: actor.user_id }
    : actor.kind === "automation"
      ? { kind: "automation" }
      : { kind: "ai" };

export const listLeads: ToolRunner = bind(listLeadsInputSchema, async ({ ctx, deps }, input) => {
  const leads = await listarLeads(
    ctx,
    {
      ...(input.pipeline_id === null ? {} : { pipeline_id: input.pipeline_id }),
      ...(input.stage_id === null ? {} : { stage_id: input.stage_id }),
      ...(input.contact_id === null ? {} : { contact_id: input.contact_id }),
      limite: input.limit,
    },
    { pool: deps.pool },
  );
  return { ok: true, resourceId: null, output: { leads } };
});

export const getLead: ToolRunner = bind(getLeadInputSchema, async ({ ctx, deps }, input) => {
  const lead = await lerLead(ctx, input.lead_id, { pool: deps.pool });
  if (lead === null) {
    return { ok: false, reason: "domain_rejected", resourceId: null, detalhe: "lead_not_found" };
  }
  return { ok: true, resourceId: lead.id, output: { lead } };
});

export const listPipelines: ToolRunner = bind(listPipelinesInputSchema, async ({ ctx, deps }) => {
  const pipelines = await listarFunis(ctx, { pool: deps.pool });
  return { ok: true, resourceId: null, output: { pipelines } };
});

export const listStages: ToolRunner = bind(listStagesInputSchema, async ({ ctx, deps }, input) => {
  const stages = await listarEstagios(ctx, input.pipeline_id, { pool: deps.pool });
  return { ok: true, resourceId: null, output: { stages } };
});

export const createLead: ToolRunner = bind(createLeadInputSchema, async ({ ctx, actor, deps, requestId }, input) => {
  const r = await criarLead(
    ctx,
    atorDoFunil(actor),
    {
      pipeline_id: input.pipeline_id,
      title: input.title,
      ...(input.contact_id === null ? {} : { contact_id: input.contact_id }),
      ...(input.value_cents === null ? {} : { value_cents: input.value_cents }),
      ...(input.description === null ? {} : { description: input.description }),
    },
    { pool: deps.pool, requestId },
  );
  if (!r.ok) return { ok: false, reason: "domain_rejected", resourceId: null, detalhe: r.reason };
  return { ok: true, resourceId: r.lead.id, output: { lead: r.lead } };
});

export const updateLead: ToolRunner = bind(updateLeadInputSchema, async ({ ctx, actor, deps, requestId }, input) => {
  const r = await atualizarLead(
    ctx,
    atorDoFunil(actor),
    input.lead_id,
    {
      ...(input.title === null ? {} : { title: input.title }),
      ...(input.value_cents === null ? {} : { value_cents: input.value_cents }),
      ...(input.description === null ? {} : { description: input.description }),
    },
    { pool: deps.pool, requestId },
  );
  if (!r.ok) return { ok: false, reason: "domain_rejected", resourceId: null, detalhe: r.reason };
  return { ok: true, resourceId: r.lead.id, output: { lead: r.lead } };
});

export const moveLeadStage: ToolRunner = bind(moveLeadStageInputSchema, async ({ ctx, actor, deps, requestId }, input) => {
  const r = await moverLead(ctx, atorDoFunil(actor), input.lead_id, input.to_stage_id, {
    pool: deps.pool,
    requestId,
  });
  if (!r.ok) return { ok: false, reason: "domain_rejected", resourceId: null, detalhe: r.reason };
  return { ok: true, resourceId: r.lead.id, output: { lead: r.lead } };
});

export const proposeContactField: ToolRunner = bind(proposeContactFieldInputSchema, async ({ ctx, deps }, input) => {
  const r = await proporCampoDoContato(
    ctx,
    { contact_id: input.contact_id, field: input.field, value: input.value },
    { pool: deps.pool },
  );
  if (!r.ok) return { ok: false, reason: "domain_rejected", resourceId: null, detalhe: r.reason };
  return { ok: true, resourceId: r.proposal_id, output: { proposal_id: r.proposal_id, field: r.field } };
});
