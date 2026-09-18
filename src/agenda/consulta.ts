/**
 * Horários livres pela FACHADA SaaS (F14-T03, ADR-038 §2 T03; D41 fechado —
 * agenda herdada adotada, conexão Google por membro).
 *
 * Reproduz a leitura de `lib/agenda/consulta.ts` (`horariosLivresDaOrg`) com o
 * pool de serviço + `withTenant` em vez do cliente Supabase/PostgREST — o
 * gate de integração (Postgres descartável) não tem PostgREST, e a ferramenta
 * da IA (T04) roda no worker, pelo pool. O MOTOR é o mesmo: `lerJornadaDoBanco`,
 * `ocupadosDoDono`, `horariosLivres` — funções puras herdadas, chamadas com as
 * mesmas linhas das mesmas tabelas. Nenhuma regra de agenda nasce aqui.
 */
import { horariosLivres, type ExcecaoDeData, type Slot } from "@/lib/agenda/horarios-livres";
import { lerJornadaDoBanco } from "@/lib/agenda/jornada";
import { agendaExternaNuncaLida, ocupadosDoDono, type LinhaDeAgendamento, type LinhaDeEventoExterno } from "@/lib/agenda/ocupados";
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";

export interface AgendaDeps {
  pool?: ServicePool;
  agora?: () => Date;
}

export type MotivoDeRecusaDaConsulta = "event_type_not_found" | "event_type_inactive" | "owner_missing" | "schedule_invalid";

export interface TipoLido {
  readonly id: string;
  readonly name: string;
  readonly is_active: boolean;
  readonly duration_minutes: number;
  readonly buffer_before_minutes: number;
  readonly buffer_after_minutes: number;
  readonly minimum_notice_minutes: number;
  readonly slot_interval_minutes: number | null;
  readonly booking_window_days: number;
  readonly default_owner_user_id: string | null;
  readonly requires_confirmation: boolean;
  readonly location_kind: string;
  readonly location_details: string | null;
}

export type ResultadoDaConsulta =
  | { readonly ok: true; readonly slots: Slot[]; readonly fuso: string; readonly owner_user_id: string; readonly tipo: TipoLido; readonly agenda_externa_nunca_lida: boolean }
  | { readonly ok: false; readonly reason: MotivoDeRecusaDaConsulta; readonly detalhe: string };

export async function lerTipo(db: TenantDb, ctx: TenantCtx, eventTypeId: string): Promise<TipoLido | null> {
  const linha = await db.query<TipoLido>(
    `select id, name, is_active, duration_minutes, buffer_before_minutes, buffer_after_minutes, minimum_notice_minutes,
            slot_interval_minutes, booking_window_days, default_owner_user_id, requires_confirmation, location_kind, location_details
       from public.calendar_event_types where organization_id = $1 and id = $2`,
    [ctx.organization_id, eventTypeId],
  );
  return linha.rows[0] ?? null;
}

export interface ParametrosDaConsulta {
  readonly event_type_id: string;
  readonly owner_user_id?: string | null;
  readonly de: Date;
  readonly ate: Date;
}

/** A mesma consulta de `horariosLivresDaOrg`, sobre o pool — dentro de uma transação já aberta. */
export async function horariosLivresIn(db: TenantDb, ctx: TenantCtx, params: ParametrosDaConsulta, agora: Date): Promise<ResultadoDaConsulta> {
  const tipo = await lerTipo(db, ctx, params.event_type_id);
  if (tipo === null) return { ok: false, reason: "event_type_not_found", detalhe: "Tipo de agendamento não encontrado." };
  if (!tipo.is_active) return { ok: false, reason: "event_type_inactive", detalhe: `"${tipo.name}" está desativado.` };
  const donoId = params.owner_user_id ?? tipo.default_owner_user_id;
  if (!donoId) return { ok: false, reason: "owner_missing", detalhe: `"${tipo.name}" não tem responsável definido.` };

  const disponibilidade = await db.query<{ schedule: unknown }>(
    `select schedule from public.attendant_availability where organization_id = $1 and user_id = $2`,
    [ctx.organization_id, donoId],
  );
  const leitura = lerJornadaDoBanco(disponibilidade.rows[0]?.schedule ?? null);
  if (!leitura.ok) return { ok: false, reason: "schedule_invalid", detalhe: `A disponibilidade deste responsável ${leitura.motivoParaOperador}` };

  const diaISO = (d: Date) => d.toISOString().slice(0, 10);
  const [excecoes, agendamentos, conexoes, externos] = await Promise.all([
    db.query<{ exception_date: string; is_unavailable: boolean; start_minute: number; end_minute: number }>(
      `select exception_date::text, is_unavailable, start_minute, end_minute from public.calendar_availability_exceptions
        where organization_id = $1 and user_id = $2 and exception_date between $3::date and $4::date`,
      [ctx.organization_id, donoId, diaISO(params.de), diaISO(params.ate)],
    ),
    db.query<LinhaDeAgendamento>(
      `select starts_at::text, ends_at::text, status from public.calendar_appointments
        where organization_id = $1 and owner_user_id = $2 and starts_at < $3 and ends_at > $4`,
      [ctx.organization_id, donoId, params.ate.toISOString(), params.de.toISOString()],
    ),
    db.query<{ status: string; last_sync_at: string | null }>(
      `select status, last_sync_at::text from public.calendar_connections where organization_id = $1 and user_id = $2`,
      [ctx.organization_id, donoId],
    ),
    db.query<{ starts_at: string; ends_at: string; transparency: string; status: string; situacao: string }>(
      `select e.starts_at::text, e.ends_at::text, e.transparency, e.status, c.status as situacao
         from public.calendar_selected_external_events e
         join public.calendar_connections c on c.id = e.connection_id and c.organization_id = e.organization_id
        where e.organization_id = $1 and c.user_id = $2 and e.starts_at < $3 and e.ends_at > $4`,
      [ctx.organization_id, donoId, params.ate.toISOString(), params.de.toISOString()],
    ),
  ]);
  const excecoesLidas: ExcecaoDeData[] = excecoes.rows.map((l) => ({
    data: String(l.exception_date).slice(0, 10),
    indisponivel: l.is_unavailable,
    inicioMinuto: l.start_minute,
    fimMinuto: l.end_minute,
  }));
  const { ocupados } = ocupadosDoDono(
    agendamentos.rows,
    externos.rows.map((l): LinhaDeEventoExterno => ({ starts_at: l.starts_at, ends_at: l.ends_at, transparency: l.transparency, status: l.status, situacaoDaConexao: l.situacao })),
  );
  const slots = horariosLivres({
    jornada: leitura.jornada,
    excecoes: excecoesLidas,
    ocupados,
    tipo: {
      duracaoMin: tipo.duration_minutes,
      bufferAntesMin: tipo.buffer_before_minutes,
      bufferDepoisMin: tipo.buffer_after_minutes,
      avisoMinimoMin: tipo.minimum_notice_minutes,
      intervaloMin: tipo.slot_interval_minutes,
      janelaDias: tipo.booking_window_days,
    },
    de: params.de,
    ate: params.ate,
    agora,
  });
  return { ok: true, slots, fuso: leitura.jornada.timezone, owner_user_id: donoId, tipo, agenda_externa_nunca_lida: agendaExternaNuncaLida(conexoes.rows) };
}

export async function horariosLivresDaOrganizacao(ctx: TenantCtx, params: ParametrosDaConsulta, deps: AgendaDeps = {}): Promise<ResultadoDaConsulta> {
  const agora = (deps.agora ?? (() => new Date()))();
  return withTenant(ctx, (db) => horariosLivresIn(db, ctx, params, agora), { pool: deps.pool });
}
