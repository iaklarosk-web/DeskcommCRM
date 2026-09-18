/**
 * Marcar, remarcar e cancelar pela FACHADA SaaS (F14-T03, ADR-038 §2 T03).
 *
 * Sobre o modelo herdado, sem redesenho (D41): as mesmas tabelas
 * (`calendar_appointments`, `calendar_event_types`), a mesma RPC de mudança
 * (`fn_appointment_change`: revisão, lock por contato, cascata no follow-up e
 * no inbox do agente, `needs_google_push` — tudo no banco) e o mesmo motor de
 * horários (`src/agenda/consulta.ts`). O que a fachada acrescenta:
 *
 *  - CONFLITO com nome: `detectarConflito` é pura (alvo do mutante 76) e devolve
 *    o compromisso que colide — a resposta diz QUAL, como a ADR-034/§B da agenda
 *    herdada exige ("409 dizendo qual compromisso está ali");
 *  - o horário tem de estar entre os OFERECIDOS pelo motor (jornada, exceções,
 *    Google, buffers, aviso mínimo): marcar fora da jornada não é conflito, é
 *    `slot_unavailable`;
 *  - auditoria em `audit_events` (§5.17) pelo mesmo `recordIn` das ações;
 *  - o compromisso nasce ligado ao contato e à conversa que o pediram.
 *
 * O que NÃO faz (declarado): mover a etapa do funil e escrever a timeline do
 * lead — isso continua na rota herdada da tela (`_handler.ts`, Supabase); a
 * fachada é o caminho da IA (T04) e da prova. Espelho no Google: o compromisso
 * entra na fila de push do banco (`needs_google_push`) como qualquer outro.
 */
import { randomUUID } from "node:crypto";

import { recordIn } from "@/src/actions/audit";
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";

import { horariosLivresIn, type AgendaDeps, type MotivoDeRecusaDaConsulta } from "./consulta";

export interface CompromissoExistente {
  readonly id: string;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly status: string;
}

const LIBERAM = new Set(["cancelled", "no_show", "completed"]);

/** PURA: o primeiro compromisso VIVO do dono que se sobrepõe a [inicio, fim). */
export function detectarConflito(existentes: readonly CompromissoExistente[], inicio: Date, fim: Date): CompromissoExistente | null {
  for (const c of existentes) {
    if (LIBERAM.has(c.status)) continue;
    const ci = new Date(c.starts_at).getTime();
    const cf = new Date(c.ends_at).getTime();
    if (inicio.getTime() < cf && fim.getTime() > ci) return c;
  }
  return null;
}

export type AtorDaAgenda = { readonly kind: "human"; readonly user_id: string } | { readonly kind: "ai"; readonly request_id?: string } | { readonly kind: "automation" };

export interface PedidoDeMarcacao {
  readonly event_type_id: string;
  readonly starts_at: string;
  /** Fuso em que a pessoa combinou ("quinta às 14h"); default: o da jornada do responsável. */
  readonly timezone?: string | null;
  readonly owner_user_id?: string | null;
  readonly contact_id?: string | null;
  readonly conversation_id?: string | null;
  readonly title?: string | null;
  readonly notes?: string | null;
  /** `pending` força aprovação humana (a IA propõe; a política da F15 decide antes). */
  readonly status?: "pending" | "confirmed";
}

export type MotivoDeRecusaDaMarcacao = MotivoDeRecusaDaConsulta | "invalid_start" | "invalid_timezone" | "contact_not_found" | "conflict" | "slot_unavailable";

export interface CompromissoMarcado {
  readonly id: string;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly time_zone: string;
  readonly status: string;
  readonly owner_user_id: string;
  readonly revision: number;
}

export type ResultadoDaMarcacao =
  | { readonly ok: true; readonly compromisso: CompromissoMarcado }
  | { readonly ok: false; readonly reason: MotivoDeRecusaDaMarcacao; readonly detalhe: string; readonly conflicting_id?: string };

function fusoValido(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function auditoria(actor: AtorDaAgenda): { actor_type: "user" | "ai" | "automation"; actor_id: string | null } {
  if (actor.kind === "human") return { actor_type: "user", actor_id: actor.user_id };
  if (actor.kind === "ai") return { actor_type: "ai", actor_id: actor.request_id ?? null };
  return { actor_type: "automation", actor_id: null };
}

export async function marcar(ctx: TenantCtx, actor: AtorDaAgenda, pedido: PedidoDeMarcacao, deps: AgendaDeps & { requestId?: string } = {}): Promise<ResultadoDaMarcacao> {
  const inicio = new Date(pedido.starts_at);
  if (Number.isNaN(inicio.getTime())) return { ok: false, reason: "invalid_start", detalhe: "starts_at inválido." };
  if (pedido.timezone && !fusoValido(pedido.timezone)) return { ok: false, reason: "invalid_timezone", detalhe: `Fuso desconhecido: ${pedido.timezone}.` };
  const agora = (deps.agora ?? (() => new Date()))();
  const requestId = deps.requestId ?? randomUUID();
  return withTenant(
    ctx,
    async (db) => {
      if (pedido.contact_id) {
        const contato = await db.query(`select 1 from public.contacts where organization_id = $1 and id = $2`, [ctx.organization_id, pedido.contact_id]);
        if (contato.rowCount === 0) return { ok: false, reason: "contact_not_found", detalhe: "Contato não encontrado." } as const;
      }
      const consulta = await horariosLivresIn(db, ctx, { event_type_id: pedido.event_type_id, owner_user_id: pedido.owner_user_id ?? null, de: inicio, ate: new Date(inicio.getTime() + 24 * 3_600_000) }, agora);
      if (!consulta.ok) return consulta;
      const fim = new Date(inicio.getTime() + consulta.tipo.duration_minutes * 60_000);
      if (pedido.contact_id) await db.query(`select public.fn_service_lock($1::uuid,$2::uuid)`, [ctx.organization_id, pedido.contact_id]);
      // O conflito NOMEADO vem antes da oferta: "14h está ocupado pelo compromisso X" é
      // resposta melhor do que "14h não está entre os horários".
      const existentes = await db.query<CompromissoExistente>(
        `select id, starts_at::text, ends_at::text, status from public.calendar_appointments
          where organization_id = $1 and owner_user_id = $2 and starts_at < $3 and ends_at > $4`,
        [ctx.organization_id, consulta.owner_user_id, fim.toISOString(), inicio.toISOString()],
      );
      const conflito = detectarConflito(existentes.rows, inicio, fim);
      if (conflito !== null) {
        return { ok: false, reason: "conflict", detalhe: `Horário ocupado pelo compromisso ${conflito.id}.`, conflicting_id: conflito.id } as const;
      }
      if (!consulta.slots.some((s) => s.inicio.getTime() === inicio.getTime())) {
        return { ok: false, reason: "slot_unavailable", detalhe: "Este horário não está entre os oferecidos (jornada, aviso mínimo ou intervalo)." } as const;
      }
      const status = pedido.status ?? (consulta.tipo.requires_confirmation ? "pending" : "confirmed");
      const quem = auditoria(actor);
      const criado = await db.query<CompromissoMarcado>(
        `insert into public.calendar_appointments
           (organization_id, event_type_id, title, starts_at, ends_at, time_zone, status, owner_user_id, contact_id, conversation_id,
            location_kind, location_details, notes, created_by_kind, created_by_user_id, source)
         values ($1::uuid, $2::uuid, $3::text, $4::timestamptz, $5::timestamptz, $6::text, $7::text, $8::uuid, $9::uuid, $10::uuid,
                 $11::text, $12::text, $13::text, $14::text, $15::uuid, $16::text)
         returning id, starts_at::text, ends_at::text, time_zone, status, owner_user_id, revision::int`,
        [
          ctx.organization_id, consulta.tipo.id, pedido.title ?? consulta.tipo.name, inicio.toISOString(), fim.toISOString(),
          pedido.timezone ?? consulta.fuso, status, consulta.owner_user_id, pedido.contact_id ?? null, pedido.conversation_id ?? null,
          consulta.tipo.location_kind, consulta.tipo.location_details, pedido.notes ?? null,
          actor.kind === "human" ? "user" : actor.kind === "ai" ? "ai" : "system",
          actor.kind === "human" ? actor.user_id : null,
          actor.kind === "human" ? "ui" : "mcp",
        ],
      );
      const compromisso = criado.rows[0];
      if (compromisso === undefined) throw new Error("insert de calendar_appointments não devolveu linha");
      await recordIn(db, ctx, {
        ...quem,
        action_name: "agenda.appointment_created",
        risk: "medium",
        result: "executed",
        resource_type: "calendar_appointments",
        resource_id: compromisso.id,
        request_id: requestId,
        payload: { actor_kind: actor.kind, event_type_id: consulta.tipo.id, owner_user_id: consulta.owner_user_id, time_zone: compromisso.time_zone, status, conversation_id: pedido.conversation_id ?? null },
      });
      return { ok: true, compromisso } as const;
    },
    { pool: deps.pool },
  );
}

export type MotivoDeRecusaDaMudanca = "not_found" | "stale" | "already_cancelled" | "conflict" | "slot_unavailable" | "forbidden" | "invalid";

export type ResultadoDaMudanca =
  | { readonly ok: true; readonly compromisso: CompromissoMarcado }
  | { readonly ok: false; readonly reason: MotivoDeRecusaDaMudanca; readonly detalhe: string; readonly conflicting_id?: string };

async function mudar(db: TenantDb, ctx: TenantCtx, id: string, revision: number, patch: Record<string, unknown>): Promise<ResultadoDaMudanca> {
  try {
    const r = await db.query<{ fn_appointment_change: Record<string, unknown> }>(`select public.fn_appointment_change($1::uuid, $2::uuid, $3::bigint, $4::jsonb)`, [ctx.organization_id, id, revision, JSON.stringify(patch)]);
    const linha = await db.query<CompromissoMarcado>(`select id, starts_at::text, ends_at::text, time_zone, status, owner_user_id, revision::int from public.calendar_appointments where organization_id = $1 and id = $2`, [ctx.organization_id, id]);
    void r;
    const compromisso = linha.rows[0];
    if (compromisso === undefined) return { ok: false, reason: "not_found", detalhe: "Compromisso não encontrado." };
    return { ok: true, compromisso };
  } catch (erro) {
    const codigo = (erro as { code?: string }).code ?? "";
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    if (codigo === "P0002") return { ok: false, reason: "not_found", detalhe: mensagem };
    if (codigo === "40001") return { ok: false, reason: "stale", detalhe: mensagem };
    if (codigo === "42501") return { ok: false, reason: "forbidden", detalhe: mensagem };
    if (mensagem.includes("appointment_cancelled")) return { ok: false, reason: "already_cancelled", detalhe: mensagem };
    if (codigo === "22023") return { ok: false, reason: "invalid", detalhe: mensagem };
    throw erro;
  }
}

/** Remarcar é a MESMA linha mudando de horário (revisão, timeline e espelho no Google preservados). */
export async function remarcar(ctx: TenantCtx, actor: AtorDaAgenda, pedido: { id: string; revision: number; starts_at: string }, deps: AgendaDeps & { requestId?: string } = {}): Promise<ResultadoDaMudanca> {
  const inicio = new Date(pedido.starts_at);
  if (Number.isNaN(inicio.getTime())) return { ok: false, reason: "invalid", detalhe: "starts_at inválido." };
  const agora = (deps.agora ?? (() => new Date()))();
  const requestId = deps.requestId ?? randomUUID();
  return withTenant(
    ctx,
    async (db) => {
      const atual = await db.query<{ event_type_id: string | null; owner_user_id: string | null; starts_at: string; ends_at: string; status: string }>(
        `select event_type_id, owner_user_id, starts_at::text, ends_at::text, status from public.calendar_appointments where organization_id = $1 and id = $2`,
        [ctx.organization_id, pedido.id],
      );
      const linha = atual.rows[0];
      if (linha === undefined) return { ok: false, reason: "not_found", detalhe: "Compromisso não encontrado." } as const;
      if (linha.status === "cancelled") return { ok: false, reason: "already_cancelled", detalhe: "Compromisso cancelado." } as const;
      if (linha.event_type_id === null || linha.owner_user_id === null) return { ok: false, reason: "invalid", detalhe: "Compromisso sem tipo ou sem responsável." } as const;
      const duracao = new Date(linha.ends_at).getTime() - new Date(linha.starts_at).getTime();
      const fim = new Date(inicio.getTime() + duracao);
      const outros = await db.query<CompromissoExistente>(
        `select id, starts_at::text, ends_at::text, status from public.calendar_appointments
          where organization_id = $1 and owner_user_id = $2 and id <> $3 and starts_at < $4 and ends_at > $5`,
        [ctx.organization_id, linha.owner_user_id, pedido.id, fim.toISOString(), inicio.toISOString()],
      );
      const conflito = detectarConflito(outros.rows, inicio, fim);
      if (conflito !== null) return { ok: false, reason: "conflict", detalhe: `Horário ocupado pelo compromisso ${conflito.id}.`, conflicting_id: conflito.id } as const;
      const consulta = await horariosLivresIn(db, ctx, { event_type_id: linha.event_type_id, owner_user_id: linha.owner_user_id, de: inicio, ate: new Date(inicio.getTime() + 24 * 3_600_000) }, agora);
      // O próprio compromisso ocupa o horário antigo, não o novo: a oferta vale como está.
      if (!consulta.ok) return { ok: false, reason: "invalid", detalhe: consulta.detalhe } as const;
      if (!consulta.slots.some((s) => s.inicio.getTime() === inicio.getTime())) return { ok: false, reason: "slot_unavailable", detalhe: "Este horário não está entre os oferecidos." } as const;
      const mudado = await mudar(db, ctx, pedido.id, pedido.revision, { starts_at: inicio.toISOString(), ends_at: fim.toISOString() });
      if (!mudado.ok) return mudado;
      await recordIn(db, ctx, { ...auditoria(actor), action_name: "agenda.appointment_rescheduled", risk: "medium", result: "executed", resource_type: "calendar_appointments", resource_id: pedido.id, request_id: requestId, payload: { actor_kind: actor.kind, starts_at: inicio.toISOString() } });
      return mudado;
    },
    { pool: deps.pool },
  );
}

/**
 * Compromisso que já aconteceu não é cancelável (F18-T03, ADR-040 §4).
 *
 * Pura e separada porque é a trava que sobra quando `cancel_appointment` está
 * em `allow` (D56 e): sem aprovação humana no caminho, é ela que impede a IA de
 * reescrever o passado da agenda. Comparar `<=` e não `<`: cancelar o
 * compromisso que começa AGORA é cancelar quem já está na sala.
 */
export function podeCancelar(inicio: Date, agora: Date): boolean {
  return inicio.getTime() > agora.getTime(); // MUTANT: cancel-past
}

export async function cancelar(ctx: TenantCtx, actor: AtorDaAgenda, pedido: { id: string; revision: number; reason: string }, deps: AgendaDeps & { requestId?: string } = {}): Promise<ResultadoDaMudanca> {
  const motivo = pedido.reason.trim();
  if (motivo.length === 0) return { ok: false, reason: "invalid", detalhe: "O motivo do cancelamento é obrigatório." };
  const requestId = deps.requestId ?? randomUUID();
  const agora = deps.agora?.() ?? new Date();
  return withTenant(
    ctx,
    async (db) => {
      // F18-T03 (ADR-040 §4): compromisso que JÁ ACONTECEU não é cancelável.
      //
      // Vale para todo ator, e existe por causa da decisão do proprietário de
      // deixar `cancel_appointment` em `allow`: sem aprovação humana no
      // caminho, esta é a trava que impede a IA de reescrever o passado da
      // agenda — "desmarcar" o que já aconteceu apagaria o registro de um
      // atendimento prestado. Para o que já passou existe desfecho
      // (`completed`/`no_show`), que é outra ação.
      const linha = await db.query<{ starts_at: string }>(
        `select starts_at::text as starts_at from public.calendar_appointments
          where organization_id=$1 and id=$2 limit 1`,
        [ctx.organization_id, pedido.id],
      );
      const inicio = linha.rows[0]?.starts_at;
      if (inicio !== undefined && !podeCancelar(new Date(inicio), agora)) {
        return { ok: false, reason: "invalid", detalhe: "appointment_in_the_past" } as const;
      }
      const mudado = await mudar(db, ctx, pedido.id, pedido.revision, { status: "cancelled", cancellation_reason: motivo });
      if (!mudado.ok) return mudado;
      await recordIn(db, ctx, { ...auditoria(actor), action_name: "agenda.appointment_cancelled", risk: "medium", result: "executed", resource_type: "calendar_appointments", resource_id: pedido.id, request_id: requestId, payload: { actor_kind: actor.kind, reason: motivo } });
      return mudado;
    },
    { pool: deps.pool },
  );
}

/**
 * Confirmação do compromisso (`crm_confirm_appointment` no herdado).
 *
 * Só do que ainda não aconteceu, e só a partir de `pending`: confirmar o que já
 * está confirmado é ruído, e confirmar o passado é contar história.
 */
export async function confirmar(
  ctx: TenantCtx,
  actor: AtorDaAgenda,
  pedido: { id: string; revision: number },
  deps: AgendaDeps & { requestId?: string } = {},
): Promise<ResultadoDaMudanca> {
  const requestId = deps.requestId ?? randomUUID();
  return withTenant(
    ctx,
    async (db) => {
      const mudado = await mudar(db, ctx, pedido.id, pedido.revision, { status: "confirmed" });
      if (!mudado.ok) return mudado;
      await recordIn(db, ctx, {
        ...auditoria(actor),
        action_name: "agenda.appointment_confirmed",
        risk: "low",
        result: "executed",
        resource_type: "calendar_appointments",
        resource_id: pedido.id,
        request_id: requestId,
        payload: { actor_kind: actor.kind },
      });
      return mudado;
    },
    { pool: deps.pool },
  );
}

/**
 * O desfecho do que JÁ aconteceu (`crm_set_appointment_outcome` no herdado):
 * `completed` (aconteceu) ou `no_show` (o cliente não veio). É o par do freio
 * do cancelamento: o passado se registra, não se desmarca.
 */
export async function registrarDesfecho(
  ctx: TenantCtx,
  actor: AtorDaAgenda,
  pedido: { id: string; revision: number; outcome: "completed" | "no_show" },
  deps: AgendaDeps & { requestId?: string } = {},
): Promise<ResultadoDaMudanca> {
  const requestId = deps.requestId ?? randomUUID();
  return withTenant(
    ctx,
    async (db) => {
      const mudado = await mudar(db, ctx, pedido.id, pedido.revision, { status: pedido.outcome });
      if (!mudado.ok) return mudado;
      await recordIn(db, ctx, {
        ...auditoria(actor),
        action_name: "agenda.appointment_outcome",
        risk: "low",
        result: "executed",
        resource_type: "calendar_appointments",
        resource_id: pedido.id,
        request_id: requestId,
        payload: { actor_kind: actor.kind, outcome: pedido.outcome },
      });
      return mudado;
    },
    { pool: deps.pool },
  );
}
