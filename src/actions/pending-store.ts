/**
 * `pending_actions` — a ação que espera o `attendant` (§5.8, D33, migration
 * 9017).
 *
 * ⚠️ ESTE MÓDULO NÃO IMPORTA `src/conversation`. É deliberado: as três guardas
 * de `src/conversation/guards.ts` leem daqui, e `src/actions/execute.ts` chama
 * `transition()`. Se este arquivo conhecesse Conversation, o ciclo
 * `conversation → actions → conversation` existiria de verdade em tempo de
 * módulo. Mantendo-o folha, a seta é única: guards → pending-store.
 *
 * O formato de `pending_actions` é ESCONDIDO por §5.8 ("Esconde: … o formato de
 * `pending_actions`"). Ninguém fora de `src/actions/` e das guardas o lê.
 */
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";

/** Os quatro desfechos do CHECK da 9017. */
export const PENDING_STATUSES = ["pending", "approved", "rejected", "timeout"] as const;
export type PendingStatus = (typeof PENDING_STATUSES)[number];

/** O desfecho que `confirm()` pode escrever — `pending` é só o nascimento. */
export type PendingDecision = Exclude<PendingStatus, "pending">;

export interface PendingAction {
  readonly id: string;
  readonly conversation_id: string | null;
  readonly action_name: string;
  readonly input: Record<string, unknown>;
  readonly requested_by: string;
  readonly expires_at: Date;
  readonly status: PendingStatus;
}

const COLUNAS =
  "id, conversation_id, action_name, input, requested_by, expires_at, status";

export interface CriarPendencia {
  readonly conversation_id: string;
  readonly action_name: string;
  readonly input: Record<string, unknown>;
  readonly requested_by: string;
  readonly expires_at: Date;
}

/**
 * Nasce `pending`. O índice único parcial `pending_actions_uma_por_conversa`
 * é quem garante UMA por conversa — e é do BANCO de propósito: entre um
 * `select` e um `insert` cabe o segundo pedido, e essa janela é exatamente o
 * caso que a unicidade existe para cobrir.
 */
export async function criarPendencia(
  db: TenantDb,
  ctx: TenantCtx,
  pedido: CriarPendencia,
): Promise<PendingAction> {
  const gravada = await db.query<PendingAction>(
    `insert into public.pending_actions
       (organization_id, conversation_id, action_name, input, requested_by, expires_at)
     values ($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text,$6::timestamptz)
    returning ${COLUNAS}`,
    [
      ctx.organization_id,
      pedido.conversation_id,
      pedido.action_name,
      JSON.stringify(pedido.input),
      pedido.requested_by,
      pedido.expires_at.toISOString(),
    ],
  );
  const linha = gravada.rows[0];
  if (linha === undefined) throw new Error("pending_actions não devolveu a linha gravada");
  return linha;
}

/**
 * Lê e TRAVA a pendência (`for update`). O lock é o que impede que dois
 * atendentes aprovem a mesma pendência ao mesmo tempo e o efeito aconteça duas
 * vezes — a transição seria recusada na segunda, mas o pedido já teria sido
 * criado.
 */
export async function travarPendencia(
  db: TenantDb,
  ctx: TenantCtx,
  pendingId: string,
): Promise<PendingAction | null> {
  const lida = await db.query<PendingAction>(
    `select ${COLUNAS} from public.pending_actions
      where id = $1 and organization_id = $2
      for update`,
    [pendingId, ctx.organization_id],
  );
  return lida.rows[0] ?? null;
}

/**
 * Fecha a pendência. O `where status = 'pending'` é a catraca: `rowCount = 0`
 * significa "alguém já resolveu esta", e o chamador trata como recusa em vez de
 * executar de novo.
 */
export async function resolverPendencia(
  db: TenantDb,
  ctx: TenantCtx,
  pendingId: string,
  decisao: PendingDecision,
  resolvedBy: string | null,
): Promise<boolean> {
  const fechada = await db.query(
    `update public.pending_actions
        set status = $3, resolved_by = $4::uuid, resolved_at = now()
      where id = $1 and organization_id = $2 and status = 'pending'`,
    [pendingId, ctx.organization_id, decisao, resolvedBy],
  );
  return fechada.rowCount === 1;
}

// ─── As três leituras das guardas de D16 ────────────────────────────────────
//
// Cada uma responde UMA pergunta da tabela de §5.6, e nenhuma devolve a linha:
// a guarda só pode decidir sim/não, e devolver o objeto convidaria quem chama a
// tomar outra decisão com ele.

/** `action_requires_confirmation`: existe pendência aberta nesta conversa? */
export async function existePendenciaAberta(
  ctx: TenantCtx,
  conversationId: string,
  deps: { pool?: ServicePool } = {},
): Promise<boolean> {
  return withTenant(
    ctx,
    async (db) => {
      const r = await db.query(
        `select 1 from public.pending_actions
          where organization_id = $1 and conversation_id = $2 and status = 'pending'
          limit 1`,
        [ctx.organization_id, conversationId],
      );
      return r.rowCount === 1;
    },
    { pool: deps.pool },
  );
}

/**
 * `pending_action_executed`: a pendência desta rodada FOI executada?
 *
 * "Desta rodada" é `resolved_at >= saas_state_entered_at`: a conversa entrou em
 * `waiting_confirmation` naquele instante, e uma aprovação anterior pertence a
 * outra rodada. Sem o recorte, uma conversa que já tivesse aprovado algo no
 * passado passaria a aprovar qualquer coisa para sempre.
 *
 * E exige que NÃO sobre pendência aberta: aprovar com uma ainda de pé seria
 * voltar para `ai_handling` deixando uma ação esperando em silêncio.
 */
export async function pendenciaExecutadaNestaRodada(
  ctx: TenantCtx,
  conversationId: string,
  entradaNoEstado: Date | null,
  deps: { pool?: ServicePool } = {},
): Promise<boolean> {
  if (entradaNoEstado === null) return false;
  return withTenant(
    ctx,
    async (db) => {
      const r = await db.query<{ aprovadas: string; abertas: string }>(
        `select
           count(*) filter (
             where status = 'approved' and resolved_at >= $3::timestamptz
           )::text as aprovadas,
           count(*) filter (where status = 'pending')::text as abertas
           from public.pending_actions
          where organization_id = $1 and conversation_id = $2`,
        [ctx.organization_id, conversationId, entradaNoEstado.toISOString()],
      );
      const linha = r.rows[0];
      if (linha === undefined) return false;
      return Number(linha.aprovadas) > 0 && Number(linha.abertas) === 0;
    },
    { pool: deps.pool },
  );
}

/**
 * `confirmation_timeout_elapsed`: existe pendência aberta VENCIDA?
 *
 * O prazo é o `expires_at` da LINHA, gravado no pedido a partir do Setting
 * `conversation.confirmation_timeout_minutes`. D16 escreve a guarda como
 * `now − entered_at ≥ confirmation_timeout_minutes`, e os dois instantes são o
 * mesmo na prática (a pendência nasce no mesmo movimento que leva a conversa a
 * `waiting_confirmation`). Amarrar o prazo à LINHA é o que faz uma mudança
 * posterior do Setting não expirar — nem desexpirar — retroativamente o que já
 * estava pendente.
 */
export async function pendenciaVencida(
  ctx: TenantCtx,
  conversationId: string,
  agora: Date,
  deps: { pool?: ServicePool } = {},
): Promise<boolean> {
  return withTenant(
    ctx,
    async (db) => {
      const r = await db.query(
        `select 1 from public.pending_actions
          where organization_id = $1 and conversation_id = $2
            and status = 'pending' and expires_at <= $3::timestamptz
          limit 1`,
        [ctx.organization_id, conversationId, agora.toISOString()],
      );
      return r.rowCount === 1;
    },
    { pool: deps.pool },
  );
}

/** As pendências vencidas do tenant — a varredura do Job de timeout. */
export async function listarVencidas(
  ctx: TenantCtx,
  agora: Date,
  deps: { pool?: ServicePool; limite?: number } = {},
): Promise<readonly PendingAction[]> {
  return withTenant(
    ctx,
    async (db) => {
      const r = await db.query<PendingAction>(
        `select ${COLUNAS} from public.pending_actions
          where organization_id = $1 and status = 'pending' and expires_at <= $2::timestamptz
          order by expires_at
          limit $3`,
        [ctx.organization_id, agora.toISOString(), deps.limite ?? 100],
      );
      return r.rows;
    },
    { pool: deps.pool },
  );
}
