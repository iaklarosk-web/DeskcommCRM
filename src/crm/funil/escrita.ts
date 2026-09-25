/**
 * Escrita no funil pela FACHADA SaaS (F18-T02, ADR-040 §2).
 *
 * As três escritas que o agente publicado declara (`crm_create_lead`,
 * `crm_update_lead`, `crm_move_lead_stage`) viram ação do catálogo. O que o
 * banco já garante continua no banco e NÃO é reimplementado aqui:
 *
 *   - `trg_crm_lead_close_on_stage` fecha/reabre o lead ao mudar de estágio;
 *   - `trg_validate_lost_reason_required` exige motivo na perda;
 *   - `trg_stamp_stage_changed_at` carimba a mudança;
 *   - `trg_emit_event_on_lead_change` emite o evento que a automação escuta.
 *
 * Restam três regras que são DESTA fachada, porque nenhuma delas cabe num
 * gatilho: mudança de funil é proibida (mover entre funis é clonar, não mover),
 * estágio que exige gente não recebe lead movido pela IA, e toda escrita é
 * auditada pelo mesmo `recordIn` das outras ações.
 */
import { randomUUID } from "node:crypto";

import { recordIn } from "@/src/actions/audit";
import { withTenant, type TenantCtx } from "@/src/tenant-context";

import type { DepsDoFunil, LeadDoFunil } from "./leitura";

export type AtorDoFunil =
  | { readonly kind: "human"; readonly user_id: string }
  | { readonly kind: "ai" }
  | { readonly kind: "automation" };

export type MotivoDeRecusaDoFunil =
  | "lead_not_found"
  | "stage_not_found"
  | "cross_pipeline"
  | "stage_requires_human"
  | "pipeline_not_found"
  | "contact_not_found";

export type ResultadoDoFunil =
  | { readonly ok: true; readonly lead: LeadDoFunil }
  | { readonly ok: false; readonly reason: MotivoDeRecusaDoFunil; readonly detalhe: string };

const COLUNAS = `l.id, l.title, l.status, l.pipeline_id, l.stage_id, s.name as stage_name,
                 l.contact_id, l.value_cents, l.owner_user_id, l.updated_at::text as updated_at`;

const quemDoAtor = (actor: AtorDoFunil) => ({
  actor_type: actor.kind === "human" ? ("user" as const) : actor.kind === "ai" ? ("ai" as const) : ("system" as const),
  actor_id: actor.kind === "human" ? actor.user_id : null,
});

interface DepsComRequest extends DepsDoFunil {
  readonly requestId?: string;
}

/** Cria uma oportunidade no estágio inicial do funil pedido. */
export async function criarLead(
  ctx: TenantCtx,
  actor: AtorDoFunil,
  pedido: {
    readonly pipeline_id: string;
    readonly title: string;
    readonly contact_id?: string;
    readonly value_cents?: number;
    readonly description?: string;
  },
  deps: DepsComRequest = {},
): Promise<ResultadoDoFunil> {
  return withTenant(
    ctx,
    async (db) => {
      const estagio = await db.query<{ id: string }>(
        `select id from public.crm_stages
          where organization_id=$1 and pipeline_id=$2 and is_archived=false
          order by position asc limit 1`,
        [ctx.organization_id, pedido.pipeline_id],
      );
      const primeiro = estagio.rows[0];
      if (primeiro === undefined) {
        return { ok: false, reason: "pipeline_not_found", detalhe: pedido.pipeline_id } as const;
      }
      if (pedido.contact_id !== undefined) {
        const contato = await db.query<{ id: string }>(
          `select id from public.contacts where organization_id=$1 and id=$2 limit 1`,
          [ctx.organization_id, pedido.contact_id],
        );
        if (contato.rows[0] === undefined) {
          return { ok: false, reason: "contact_not_found", detalhe: pedido.contact_id } as const;
        }
      }
      const criado = await db.query<{ id: string }>(
        // `owner_kind` fica NULO: o lead nasce SEM dono, e quem o assume é
        // decisão do produto (`assign_owner`, F15-T04) — o CHECK
        // `crm_leads_owner_kind_coherence` exige dono de verdade ao lado do
        // tipo, e inventar um aqui seria dar a oportunidade a quem não pediu.
        `insert into public.crm_leads
           (organization_id, pipeline_id, stage_id, contact_id, title, description,
            value_cents, source)
         values ($1,$2,$3,$4,$5,$6,$7,'ai_agent')
         returning id`,
        [
          ctx.organization_id,
          pedido.pipeline_id,
          primeiro.id,
          pedido.contact_id ?? null,
          pedido.title,
          pedido.description ?? null,
          pedido.value_cents ?? null,
        ],
      );
      const id = criado.rows[0]?.id;
      if (id === undefined) throw new Error("insert de crm_leads não devolveu linha");
      await recordIn(db, ctx, {
        ...quemDoAtor(actor),
        action_name: "crm.lead_created",
        risk: "medium",
        result: "executed",
        resource_type: "crm_leads",
        resource_id: id,
        request_id: deps.requestId ?? randomUUID(),
        payload: { actor_kind: actor.kind, pipeline_id: pedido.pipeline_id, stage_id: primeiro.id },
      });
      const lido = await db.query<LeadDoFunil>(
        `select ${COLUNAS} from public.crm_leads l
           join public.crm_stages s on s.id=l.stage_id and s.organization_id=l.organization_id
          where l.organization_id=$1 and l.id=$2`,
        [ctx.organization_id, id],
      );
      return { ok: true, lead: lido.rows[0]! } as const;
    },
    deps,
  );
}

/** Atualiza campos editáveis. Estágio NÃO entra aqui: mover é `moverLead`. */
export async function atualizarLead(
  ctx: TenantCtx,
  actor: AtorDoFunil,
  leadId: string,
  campos: { readonly title?: string; readonly description?: string; readonly value_cents?: number },
  deps: DepsComRequest = {},
): Promise<ResultadoDoFunil> {
  return withTenant(
    ctx,
    async (db) => {
      const atual = await db.query<{ id: string }>(
        `select id from public.crm_leads where organization_id=$1 and id=$2 limit 1`,
        [ctx.organization_id, leadId],
      );
      if (atual.rows[0] === undefined) {
        return { ok: false, reason: "lead_not_found", detalhe: leadId } as const;
      }
      await db.query(
        `update public.crm_leads
            set title = coalesce($3, title),
                description = coalesce($4, description),
                value_cents = coalesce($5, value_cents)
          where organization_id=$1 and id=$2`,
        [ctx.organization_id, leadId, campos.title ?? null, campos.description ?? null, campos.value_cents ?? null],
      );
      await recordIn(db, ctx, {
        ...quemDoAtor(actor),
        action_name: "crm.lead_updated",
        risk: "medium",
        result: "executed",
        resource_type: "crm_leads",
        resource_id: leadId,
        request_id: deps.requestId ?? randomUUID(),
        payload: { actor_kind: actor.kind, campos: Object.keys(campos) },
      });
      const lido = await db.query<LeadDoFunil>(
        `select ${COLUNAS} from public.crm_leads l
           join public.crm_stages s on s.id=l.stage_id and s.organization_id=l.organization_id
          where l.organization_id=$1 and l.id=$2`,
        [ctx.organization_id, leadId],
      );
      return { ok: true, lead: lido.rows[0]! } as const;
    },
    deps,
  );
}

/**
 * Move de estágio DENTRO do mesmo funil.
 *
 * Duas recusas nomeadas, porque as duas são decisões de produto e não erro:
 * `cross_pipeline` (mover entre funis é clonar) e `stage_requires_human` — um
 * estágio marcado `requires_human` não recebe lead movido por IA ou automação,
 * e é a IA que mais tenderia a fazer isso sozinha.
 */
export async function moverLead(
  ctx: TenantCtx,
  actor: AtorDoFunil,
  leadId: string,
  paraEstagioId: string,
  deps: DepsComRequest = {},
): Promise<ResultadoDoFunil> {
  return withTenant(
    ctx,
    async (db) => {
      const lead = await db.query<{ id: string; pipeline_id: string; stage_id: string }>(
        `select id, pipeline_id, stage_id from public.crm_leads
          where organization_id=$1 and id=$2 limit 1`,
        [ctx.organization_id, leadId],
      );
      const atual = lead.rows[0];
      if (atual === undefined) return { ok: false, reason: "lead_not_found", detalhe: leadId } as const;

      const destino = await db.query<{ id: string; pipeline_id: string; requires_human: boolean }>(
        `select id, pipeline_id, requires_human from public.crm_stages
          where organization_id=$1 and id=$2 and is_archived=false limit 1`,
        [ctx.organization_id, paraEstagioId],
      );
      const estagio = destino.rows[0];
      if (estagio === undefined) return { ok: false, reason: "stage_not_found", detalhe: paraEstagioId } as const;
      if (estagio.pipeline_id !== atual.pipeline_id) {
        return { ok: false, reason: "cross_pipeline", detalhe: `${atual.pipeline_id}→${estagio.pipeline_id}` } as const;
      }
      if (estagio.requires_human && actor.kind !== "human") {
        return { ok: false, reason: "stage_requires_human", detalhe: paraEstagioId } as const;
      }

      await db.query(
        `update public.crm_leads set stage_id=$3 where organization_id=$1 and id=$2`,
        [ctx.organization_id, leadId, paraEstagioId],
      );
      await recordIn(db, ctx, {
        ...quemDoAtor(actor),
        action_name: "crm.lead_stage_moved",
        risk: "medium",
        result: "executed",
        resource_type: "crm_leads",
        resource_id: leadId,
        request_id: deps.requestId ?? randomUUID(),
        payload: { actor_kind: actor.kind, de: atual.stage_id, para: paraEstagioId },
      });
      const lido = await db.query<LeadDoFunil>(
        `select ${COLUNAS} from public.crm_leads l
           join public.crm_stages s on s.id=l.stage_id and s.organization_id=l.organization_id
          where l.organization_id=$1 and l.id=$2`,
        [ctx.organization_id, leadId],
      );
      return { ok: true, lead: lido.rows[0]! } as const;
    },
    deps,
  );
}
