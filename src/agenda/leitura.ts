/**
 * As leituras de agenda que viram ação do catálogo (F18-T02, ADR-040 §2).
 *
 * `crm_list_event_types` e `crm_list_appointments` eram ferramentas MCP do
 * motor herdado, sem política, sem teto e sem auditoria. Aqui elas passam a
 * ler pelo pool de serviço, como o resto da fachada da F14 — as tabelas e as
 * regras continuam as herdadas.
 *
 * `crm_find_free_slots` não precisa de nada novo: `horariosLivresDaOrganizacao`
 * (F14-T03) já é exatamente essa leitura.
 */
import { withTenant, type TenantCtx } from "@/src/tenant-context";

import type { AgendaDeps } from "./consulta";

/** Teto de linhas: o contexto do modelo não é relatório (G-14). */
export const MAX_LINHAS_DA_AGENDA = 50;

export interface TipoDeAtendimento {
  readonly id: string;
  readonly name: string;
  readonly duration_minutes: number;
  readonly requires_confirmation: boolean;
  readonly location_kind: string;
}

export async function listarTiposDeAtendimento(
  ctx: TenantCtx,
  deps: AgendaDeps = {},
): Promise<readonly TipoDeAtendimento[]> {
  return withTenant(
    ctx,
    async (db) => {
      const { rows } = await db.query<TipoDeAtendimento>(
        `select id, name, duration_minutes, requires_confirmation, location_kind
           from public.calendar_event_types
          where organization_id = $1 and is_active = true
          order by name asc
          limit $2`,
        [ctx.organization_id, MAX_LINHAS_DA_AGENDA],
      );
      return rows;
    },
    { ...(deps.pool === undefined ? {} : { pool: deps.pool }) },
  );
}

export interface CompromissoListado {
  readonly id: string;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly time_zone: string;
  readonly status: string;
  readonly revision: number;
  readonly contact_id: string | null;
  readonly event_type_id: string;
}

/**
 * Compromissos de um contato, ou de um dia da equipe.
 *
 * Cancelados ficam de fora por padrão: quem pergunta "quais são meus horários"
 * não está perguntando o que foi desmarcado, e mandar o cancelado junto é
 * convite para o modelo confirmar um horário que não existe mais.
 */
export async function listarCompromissos(
  ctx: TenantCtx,
  filtro: {
    readonly contact_id?: string;
    readonly de?: string;
    readonly ate?: string;
    readonly incluir_cancelados?: boolean;
  },
  deps: AgendaDeps = {},
): Promise<readonly CompromissoListado[]> {
  return withTenant(
    ctx,
    async (db) => {
      const { rows } = await db.query<CompromissoListado>(
        `select id, starts_at::text as starts_at, ends_at::text as ends_at, time_zone,
                status, revision, contact_id, event_type_id
           from public.calendar_appointments
          where organization_id = $1
            and ($2::uuid is null or contact_id = $2::uuid)
            and ($3::timestamptz is null or starts_at >= $3::timestamptz)
            and ($4::timestamptz is null or starts_at <= $4::timestamptz)
            and ($5::boolean or status <> 'cancelled')
          order by starts_at asc
          limit $6`,
        [
          ctx.organization_id,
          filtro.contact_id ?? null,
          filtro.de ?? null,
          filtro.ate ?? null,
          filtro.incluir_cancelados === true,
          MAX_LINHAS_DA_AGENDA,
        ],
      );
      return rows;
    },
    { ...(deps.pool === undefined ? {} : { pool: deps.pool }) },
  );
}
