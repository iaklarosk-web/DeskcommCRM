/**
 * F13-T03/T04 (ADR-034 §2) — a FILA de oportunidades e o vínculo com o pedido.
 *
 * "Oportunidade" é o `crm_leads` herdado (§1 da ADR). Fila = oportunidades
 * `open` sem dono (nem humano nem agente). Distribuição por rodízio entre os
 * membros aceitos cujo papel D15 está em `crm.queue_roles`, só quando
 * `crm.distribution = round_robin`; claim por quem puxa da fila (o segundo
 * perde: 409); vínculo com pedido da MESMA organização (`crm_lead_links`,
 * ADR-012 intocado). Toda escrita passa por `withTenant` e deixa linha em
 * `crm_lead_activities` (`owner_assigned`, `order_linked`).
 */
import { papelD15DoHerdado } from "@/src/rbac/matrix";
import { getSetting } from "@/src/tenant-config/settings";
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";

import { distribuirPorRodizio, equilibrada, type Atribuicao, type Elegivel, type OportunidadeNaFila } from "./distribuicao";

export { distribuirPorRodizio, equilibrada, type Atribuicao, type Elegivel, type OportunidadeNaFila } from "./distribuicao";

export interface DepsDasOportunidades {
  pool?: ServicePool;
  agora?: () => Date;
}

export class DistribuicaoManual extends Error {
  readonly status = 409;
  readonly code = "distribution_manual";
  constructor() {
    super("crm.distribution=manual: a organização não distribui por rodízio");
    this.name = "DistribuicaoManual";
  }
}
export class JaAtribuida extends Error {
  readonly status = 409;
  readonly code = "already_assigned";
  constructor(public readonly opportunity_id: string) {
    super(`oportunidade ${opportunity_id} já tem dono ou não está aberta`);
    this.name = "JaAtribuida";
  }
}
export class OportunidadeNaoEncontrada extends Error {
  readonly status = 404;
  readonly code = "not_found";
  constructor(public readonly opportunity_id: string) {
    super(`oportunidade ${opportunity_id} não existe nesta organização`);
    this.name = "OportunidadeNaoEncontrada";
  }
}
export class PedidoDeOutraOrganizacao extends Error {
  readonly status = 404;
  readonly code = "order_not_found";
  constructor(public readonly order_id: string) {
    super(`pedido ${order_id} não existe nesta organização`);
    this.name = "PedidoDeOutraOrganizacao";
  }
}

export interface LinhaDaFila extends OportunidadeNaFila {
  title: string;
  pipeline_id: string;
  stage_id: string;
  value_cents: number | null;
  contact_id: string | null;
}

interface LinhaCrua extends Omit<LinhaDaFila, "created_at"> {
  created_at: Date | string;
}

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : v);

/** As oportunidades abertas SEM dono, na ordem de chegada. */
export async function fila(ctx: TenantCtx, pipelineId?: string, deps: DepsDasOportunidades = {}): Promise<LinhaDaFila[]> {
  return withTenant(
    ctx,
    async (db) => {
      const r = await db.query<LinhaCrua>(
        `select id, title, pipeline_id, stage_id, value_cents, contact_id, created_at
           from public.crm_leads
          where organization_id = $1 and status = 'open'
            and owner_user_id is null and owner_agent_id is null
            and ($2::uuid is null or pipeline_id = $2::uuid)
          order by created_at asc, id asc`,
        [ctx.organization_id, pipelineId ?? null],
      );
      return r.rows.map((l) => ({ ...l, created_at: iso(l.created_at) }));
    },
    deps,
  );
}

/** Membros aceitos cujo papel D15 está em `crm.queue_roles`, com a carga e a última atribuição lidas de `crm_leads`. */
export async function elegiveis(ctx: TenantCtx, deps: DepsDasOportunidades = {}): Promise<Elegivel[]> {
  const papeis = papeisDaFila(await getSetting(ctx, "crm.queue_roles", deps));
  return withTenant(
    ctx,
    async (db) => {
      const r = await db.query<{ user_id: string; role: string; carga: string; ultima: Date | null }>(
        `select uo.user_id, uo.role,
                (select count(*) from public.crm_leads l
                  where l.organization_id = uo.organization_id and l.owner_user_id = uo.user_id and l.status = 'open') as carga,
                (select max(l.assigned_at) from public.crm_leads l
                  where l.organization_id = uo.organization_id and l.owner_user_id = uo.user_id) as ultima
           from public.user_organizations uo
          where uo.organization_id = $1 and uo.accepted_at is not null and uo.revoked_at is null
          order by uo.user_id`,
        [ctx.organization_id],
      );
      return r.rows
        .filter((m) => {
          const papel = papelD15DoHerdado(m.role, false);
          return papel !== null && papeis.includes(papel);
        })
        .map((m) => ({ userId: m.user_id, currentLoad: Number(m.carga), lastAssignedAt: m.ultima ? new Date(m.ultima).getTime() : null }));
    },
    deps,
  );
}

function papeisDaFila(valor: unknown): readonly string[] {
  if (!Array.isArray(valor)) return ["attendant"];
  const lidos = valor.filter((v): v is string => typeof v === "string");
  return lidos.length > 0 ? lidos : ["attendant"];
}

async function atribuir(db: TenantDb, ctx: TenantCtx, opportunityId: string, userId: string, modo: "round_robin" | "claim", agora: Date): Promise<boolean> {
  const r = await db.query(
    `update public.crm_leads
        set owner_user_id = $3, owner_agent_id = null, owner_kind = 'user', assigned_at = $4, updated_at = now()
      where organization_id = $1 and id = $2 and status = 'open'
        and owner_user_id is null and owner_agent_id is null`,
    [ctx.organization_id, opportunityId, userId, agora.toISOString()],
  );
  if ((r.rowCount ?? 0) !== 1) return false;
  await db.query(
    `insert into public.crm_lead_activities
       (organization_id, lead_id, contact_id, source_module, type, payload, performed_by_user_id, performed_at)
     select organization_id, id, contact_id, 'crm', 'owner_assigned',
            jsonb_build_object('user_id', $3::uuid, 'mode', $4::text), $5::uuid, $6::timestamptz
       from public.crm_leads where organization_id = $1 and id = $2`,
    [ctx.organization_id, opportunityId, userId, modo, ctx.user_id ?? null, agora.toISOString()],
  );
  return true;
}

export interface ResultadoDaDistribuicao {
  mode: "round_robin";
  queue_size: number;
  eligible: number;
  assignments: Atribuicao[];
  balanced: boolean;
}

/** Distribui TODA a fila (ou a de um funil) por rodízio; `DistribuicaoManual` quando a organização não ligou o rodízio. */
export async function distribuir(ctx: TenantCtx, pipelineId?: string, deps: DepsDasOportunidades = {}): Promise<ResultadoDaDistribuicao> {
  const modo = await getSetting(ctx, "crm.distribution", deps);
  if (modo !== "round_robin") throw new DistribuicaoManual();
  const agora = (deps.agora ?? (() => new Date()))();
  const [naFila, candidatos] = await Promise.all([fila(ctx, pipelineId, deps), elegiveis(ctx, deps)]);
  const plano = distribuirPorRodizio(naFila, candidatos, agora);
  const feitas: Atribuicao[] = [];
  await withTenant(
    ctx,
    async (db) => {
      for (const a of plano) {
        if (await atribuir(db, ctx, a.opportunity_id, a.user_id, "round_robin", agora)) feitas.push(a);
      }
    },
    deps,
  );
  return { mode: "round_robin", queue_size: naFila.length, eligible: candidatos.length, assignments: feitas, balanced: equilibrada(feitas, candidatos) };
}

/** Quem puxa da fila fica com a oportunidade; a segunda tentativa perde (`JaAtribuida`). */
export async function reivindicar(ctx: TenantCtx, opportunityId: string, userId: string, deps: DepsDasOportunidades = {}): Promise<{ opportunity_id: string; user_id: string }> {
  const agora = (deps.agora ?? (() => new Date()))();
  return withTenant(
    ctx,
    async (db) => {
      const existe = await db.query(`select 1 from public.crm_leads where organization_id = $1 and id = $2`, [ctx.organization_id, opportunityId]);
      if ((existe.rowCount ?? 0) === 0) throw new OportunidadeNaoEncontrada(opportunityId);
      if (!(await atribuir(db, ctx, opportunityId, userId, "claim", agora))) throw new JaAtribuida(opportunityId);
      return { opportunity_id: opportunityId, user_id: userId };
    },
    deps,
  );
}

export const LINK_KIND_PEDIDO = "order_of_opportunity";

/** Vincula um pedido (`crm_orders`) da MESMA organização; único por par; linha `order_linked`. */
export async function vincularPedido(ctx: TenantCtx, opportunityId: string, orderId: string, deps: DepsDasOportunidades = {}): Promise<{ link_id: string; created: boolean }> {
  return withTenant(
    ctx,
    async (db) => {
      const lead = await db.query(`select 1 from public.crm_leads where organization_id = $1 and id = $2`, [ctx.organization_id, opportunityId]);
      if ((lead.rowCount ?? 0) === 0) throw new OportunidadeNaoEncontrada(opportunityId);
      const pedido = await db.query(`select 1 from public.crm_orders where organization_id = $1 and id = $2`, [ctx.organization_id, orderId]);
      if ((pedido.rowCount ?? 0) === 0) throw new PedidoDeOutraOrganizacao(orderId);
      const link = await db.query<{ id: string }>(
        `insert into public.crm_lead_links (organization_id, lead_id, target_kind, target_id, link_kind, created_by_user_id)
         values ($1, $2, 'order', $3, $4, $5)
         on conflict (lead_id, target_kind, target_id, link_kind) do nothing
         returning id`,
        [ctx.organization_id, opportunityId, orderId, LINK_KIND_PEDIDO, ctx.user_id ?? null],
      );
      if ((link.rowCount ?? 0) === 0) {
        const existente = await db.query<{ id: string }>(
          `select id from public.crm_lead_links where lead_id = $1 and target_kind = 'order' and target_id = $2 and link_kind = $3`,
          [opportunityId, orderId, LINK_KIND_PEDIDO],
        );
        return { link_id: existente.rows[0]!.id, created: false };
      }
      await db.query(
        `insert into public.crm_lead_activities (organization_id, lead_id, contact_id, source_module, source_id, type, payload, performed_by_user_id)
         select organization_id, id, contact_id, 'crm', $3::uuid, 'order_linked', jsonb_build_object('order_id', $3::uuid), $4::uuid
           from public.crm_leads where organization_id = $1 and id = $2`,
        [ctx.organization_id, opportunityId, orderId, ctx.user_id ?? null],
      );
      return { link_id: link.rows[0]!.id, created: true };
    },
    deps,
  );
}
