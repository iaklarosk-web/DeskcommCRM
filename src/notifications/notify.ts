/**
 * `notify(db, ctx, event, recipients[], payload) → count` (§5.16, F05-T05).
 *
 * ─── Por que recebe `db` e não abre `withTenant` ────────────────────────────
 *
 * Todo chamador da Fase 1 já está DENTRO de uma transação de `withTenant` quando
 * o fato acontece: o efeito `create_handoff` da `transition()`, a pendência de
 * D33, o worker ao bloquear um job, a tarefa ao ganhar dono. O aviso tem de
 * entrar na MESMA transação — ou entram o fato e o aviso, ou nenhum. Abrir uma
 * segunda conexão aqui daria um aviso órfão quando a transação do fato voltasse
 * atrás, e um impasse de pool quando não voltasse. `notifyFora()` existe para o
 * único chamador que não está em transação nenhuma (o cron do lembrete): ela
 * abre a sua e delega para esta.
 *
 * ─── In-app SEMPRE; e-mail se o tenant ligou ───────────────────────────────
 *
 * §5.16, literalmente. A Setting `notifications.email.enabled` é lida na mesma
 * transação (`getSettingIn`), e `notifications.email.to`, quando configurada, é
 * a caixa da organização que recebe TUDO — senão o e-mail é o do próprio
 * usuário (`auth.users.email`). Usuário sem e-mail e sem caixa configurada não
 * gera linha em `email_outbox`: inventar um destinatário seria dado falso na
 * caixa de saída, e o aviso in-app já existe.
 *
 * ─── O payload é dado, e é só ids ──────────────────────────────────────────
 *
 * Nenhum chamador passa corpo de mensagem do cliente, e o CHECK
 * `notifications_payload_objeto` recusa o que não for objeto. Quem lê o aviso
 * abre a conversa; o aviso não é a conversa.
 *
 * `recipients` é deduplicada: o mesmo usuário citado duas vezes (dono da conversa
 * E membro da fila) recebe UM aviso — "+1 por destinatário" (§5.16) é por
 * pessoa, não por caminho que a nomeou.
 */
import { incrementCounter } from "@/src/obs/counters";
import { getSettingIn } from "@/src/tenant-config";
import type { ServicePool } from "@/src/tenant-context/db";
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";

import { criarEmailAdapterMock, type EmailAdapter } from "./email";
import { ehEventoDeNotificacao, type EventoDeNotificacao } from "./eventos";

export interface NotifyDeps {
  /** Seam de teste; produção usa o mock até haver provedor (D12). */
  email?: EmailAdapter;
}

export interface ResultadoDoNotify {
  /** Linhas em `notifications` — uma por destinatário distinto. */
  readonly count: number;
  /** Linhas em `email_outbox` — 0 quando o tenant não ligou o e-mail. */
  readonly emails: number;
  readonly notification_ids: readonly string[];
}

/** Evento fora da lista única de §5.16 — defeito do chamador, não recusa. */
export class EventoDesconhecido extends Error {
  constructor(public readonly evento: unknown) {
    super(`evento de notificação fora da lista de §5.16: ${String(evento)}`);
    this.name = "EventoDesconhecido";
  }
}

function destinatariosDistintos(recipients: readonly string[]): readonly string[] {
  return [...new Set(recipients.filter((id) => typeof id === "string" && id.length > 0))];
}

async function emailsDosUsuarios(
  db: TenantDb,
  usuarios: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (usuarios.length === 0) return new Map();
  const linhas = await db.query<{ id: string; email: string | null }>(
    `select id, lower(email) as email from auth.users where id = any($1::uuid[])`,
    [usuarios],
  );
  const mapa = new Map<string, string>();
  for (const linha of linhas.rows) {
    if (linha.email !== null && linha.email.trim().length > 0) mapa.set(linha.id, linha.email);
  }
  return mapa;
}

export async function notify(
  db: TenantDb,
  ctx: TenantCtx,
  event: EventoDeNotificacao,
  recipients: readonly string[],
  payload: Readonly<Record<string, unknown>>,
  deps: NotifyDeps = {},
): Promise<ResultadoDoNotify> {
  if (!ehEventoDeNotificacao(event)) throw new EventoDesconhecido(event);
  const destinatarios = destinatariosDistintos(recipients);
  if (destinatarios.length === 0) {
    // Fato sem ninguém para avisar é contado, não escondido: um tenant sem
    // attendant ativo tem handoffs que ninguém vê, e esse zero precisa aparecer.
    incrementCounter("notify_sem_destinatario", { event });
    return { count: 0, emails: 0, notification_ids: [] };
  }

  const ids: string[] = [];
  for (const userId of destinatarios) {
    const gravado = await db.query<{ id: string }>(
      `insert into public.notifications (organization_id, user_id, event, payload)
       values ($1::uuid,$2::uuid,$3::text,$4::jsonb)
       returning id`,
      [ctx.organization_id, userId, event, JSON.stringify(payload)],
    );
    const id = gravado.rows[0]?.id;
    if (id === undefined) throw new Error("notifications não devolveu id do aviso");
    ids.push(id);
  }
  incrementCounter("notify_in_app", { event });

  let emails = 0;
  const ligado = await getSettingIn(db, ctx, "notifications.email.enabled");
  if (ligado === true) {
    const caixa = await getSettingIn(db, ctx, "notifications.email.to");
    const caixaDaOrganizacao =
      typeof caixa === "string" && caixa.trim().length > 0 ? caixa.trim().toLowerCase() : null;
    const porUsuario =
      caixaDaOrganizacao === null ? await emailsDosUsuarios(db, destinatarios) : new Map();
    const adapter = deps.email ?? criarEmailAdapterMock();

    for (const [indice, userId] of destinatarios.entries()) {
      const para = caixaDaOrganizacao ?? porUsuario.get(userId) ?? null;
      if (para === null) {
        incrementCounter("notify_email_sem_endereco", { event });
        continue;
      }
      await adapter.enviar(db, ctx, {
        notification_id: ids[indice]!,
        user_id: userId,
        event,
        to_email: para,
        payload,
      });
      emails += 1;
    }
    incrementCounter("notify_email", { event, provider: adapter.provider });
  }

  return { count: ids.length, emails, notification_ids: ids };
}

/**
 * `notify` para quem NÃO está em transação (o cron do lembrete, §5.12). Abre a
 * sua por `withTenant` e delega. Chamador que já tem `db` NÃO usa esta.
 */
export async function notifyFora(
  ctx: TenantCtx,
  event: EventoDeNotificacao,
  recipients: readonly string[],
  payload: Readonly<Record<string, unknown>>,
  deps: NotifyDeps & { pool?: ServicePool } = {},
): Promise<ResultadoDoNotify> {
  return withTenant(
    ctx,
    async (db) => notify(db, ctx, event, recipients, payload, deps),
    { pool: deps.pool },
  );
}

/**
 * A lista in-app de UM usuário — o que ele ainda não leu, do mais novo para o
 * mais antigo. Servida pelo servidor (a tabela é `service_only`).
 */
export interface AvisoNaoLido {
  readonly id: string;
  readonly event: EventoDeNotificacao;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly created_at: string;
}

export async function naoLidas(
  ctx: TenantCtx,
  userId: string,
  deps: { pool?: ServicePool; limite?: number } = {},
): Promise<readonly AvisoNaoLido[]> {
  return withTenant(
    ctx,
    async (db) => {
      const linhas = await db.query<{
        id: string;
        event: string;
        payload: Record<string, unknown>;
        created_at: Date | string;
      }>(
        `select id, event, payload, created_at from public.notifications
          where organization_id = $1 and user_id = $2 and read_at is null
          order by created_at desc, id desc
          limit $3`,
        [ctx.organization_id, userId, deps.limite ?? 50],
      );
      return linhas.rows.map((linha) => ({
        id: linha.id,
        event: linha.event as EventoDeNotificacao,
        payload: linha.payload,
        created_at:
          linha.created_at instanceof Date
            ? linha.created_at.toISOString()
            : String(linha.created_at),
      }));
    },
    { pool: deps.pool },
  );
}

/** Marca como lido. Só o DONO do aviso marca; devolve quantas linhas mudaram. */
export async function marcarLida(
  ctx: TenantCtx,
  userId: string,
  notificationId: string,
  deps: { pool?: ServicePool } = {},
): Promise<number> {
  return withTenant(
    ctx,
    async (db) => {
      const r = await db.query(
        `update public.notifications set read_at = now()
          where id = $1 and organization_id = $2 and user_id = $3 and read_at is null`,
        [notificationId, ctx.organization_id, userId],
      );
      return r.rowCount ?? 0;
    },
    { pool: deps.pool },
  );
}
