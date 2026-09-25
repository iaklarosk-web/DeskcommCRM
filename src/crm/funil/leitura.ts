/**
 * Leitura do funil pela FACHADA SaaS (F18-T02, ADR-040 §2).
 *
 * As quatro leituras que o agente publicado declara (`crm_list_leads`,
 * `crm_get_lead`, `crm_list_pipelines`, `crm_list_stages`) viram ação do
 * catálogo — com política por ação, auditoria e teto diário — em vez de
 * ferramenta MCP sem nenhum dos três.
 *
 * A fachada é FINA de propósito: as tabelas são as herdadas (`crm_leads`,
 * `crm_pipelines`, `crm_stages`), as regras continuam no banco (gatilhos de
 * fechamento por estágio, `lost_reason` obrigatório, `stage_changed_at`), e
 * aqui só existe o que o pool de serviço precisa para ler o que o PostgREST
 * leria. Mesmo movimento da agenda na F14: adotar, não reescrever.
 */
import { withTenant, type TenantCtx } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";

export interface DepsDoFunil {
  pool?: ServicePool;
}

/** Teto de linhas por leitura: contexto de modelo não é relatório (G-14). */
export const MAX_LINHAS_DO_FUNIL = 50;

export interface LeadDoFunil {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly pipeline_id: string;
  readonly stage_id: string;
  readonly stage_name: string;
  readonly contact_id: string | null;
  readonly value_cents: number | null;
  readonly owner_user_id: string | null;
  readonly updated_at: string;
}

const COLUNAS = `l.id, l.title, l.status, l.pipeline_id, l.stage_id, s.name as stage_name,
                 l.contact_id, l.value_cents, l.owner_user_id, l.updated_at::text as updated_at`;

export async function listarLeads(
  ctx: TenantCtx,
  filtro: { readonly pipeline_id?: string; readonly stage_id?: string; readonly contact_id?: string; readonly limite?: number },
  deps: DepsDoFunil = {},
): Promise<readonly LeadDoFunil[]> {
  const limite = Math.min(Math.max(filtro.limite ?? 20, 1), MAX_LINHAS_DO_FUNIL);
  return withTenant(
    ctx,
    async (db) => {
      const { rows } = await db.query<LeadDoFunil>(
        `select ${COLUNAS}
           from public.crm_leads l
           join public.crm_stages s on s.id = l.stage_id and s.organization_id = l.organization_id
          where l.organization_id = $1
            and ($2::uuid is null or l.pipeline_id = $2::uuid)
            and ($3::uuid is null or l.stage_id = $3::uuid)
            and ($4::uuid is null or l.contact_id = $4::uuid)
          order by l.updated_at desc
          limit $5`,
        [ctx.organization_id, filtro.pipeline_id ?? null, filtro.stage_id ?? null, filtro.contact_id ?? null, limite],
      );
      return rows;
    },
    deps,
  );
}

export async function lerLead(
  ctx: TenantCtx,
  leadId: string,
  deps: DepsDoFunil = {},
): Promise<LeadDoFunil | null> {
  return withTenant(
    ctx,
    async (db) => {
      const { rows } = await db.query<LeadDoFunil>(
        `select ${COLUNAS}
           from public.crm_leads l
           join public.crm_stages s on s.id = l.stage_id and s.organization_id = l.organization_id
          where l.organization_id = $1 and l.id = $2
          limit 1`,
        [ctx.organization_id, leadId],
      );
      return rows[0] ?? null;
    },
    deps,
  );
}

export interface FunilLido {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly is_default: boolean;
}

export async function listarFunis(ctx: TenantCtx, deps: DepsDoFunil = {}): Promise<readonly FunilLido[]> {
  return withTenant(
    ctx,
    async (db) => {
      const { rows } = await db.query<FunilLido>(
        `select id, name, slug, is_default
           from public.crm_pipelines
          where organization_id = $1 and is_archived = false
          order by position asc, name asc
          limit $2`,
        [ctx.organization_id, MAX_LINHAS_DO_FUNIL],
      );
      return rows;
    },
    deps,
  );
}

export interface EstagioLido {
  readonly id: string;
  readonly pipeline_id: string;
  readonly name: string;
  readonly position: number;
  readonly is_won: boolean;
  readonly is_lost: boolean;
  /** O estágio que exige gente: a IA não move lead para cá sozinha (ADR-040). */
  readonly requires_human: boolean;
}

export async function listarEstagios(
  ctx: TenantCtx,
  pipelineId: string,
  deps: DepsDoFunil = {},
): Promise<readonly EstagioLido[]> {
  return withTenant(
    ctx,
    async (db) => {
      const { rows } = await db.query<EstagioLido>(
        `select id, pipeline_id, name, position, is_won, is_lost, requires_human
           from public.crm_stages
          where organization_id = $1 and pipeline_id = $2 and is_archived = false
          order by position asc
          limit $3`,
        [ctx.organization_id, pipelineId, MAX_LINHAS_DO_FUNIL],
      );
      return rows;
    },
    deps,
  );
}
