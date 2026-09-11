/**
 * O REGISTRO do handoff: gravar o dossiê, listar a fila e fazer o claim
 * (F05-T01/T02/T03; §5.11, §5.2 grupo `handoff`, D34/D35).
 *
 * ═══ O que este arquivo NÃO faz ═══════════════════════════════════════════
 *
 * Não move conversa (quem move é `transition()`, §5.6/ADR-016), não silencia o
 * bot (quem silencia é `performHumanHandoff`, herdado), não cria aviso de
 * organização (quem cria é `src/actions/handoff-bridge.ts`, em
 * `agent_inbox_items`, que continua existindo) e — o principal — NÃO INVENTA
 * TRAVA DE CLAIM.
 *
 * O segundo claim é recusado por duas autoridades que já existiam, nesta ordem:
 *
 *  1. `transition()` trava a linha da conversa (`for no key update`) e recusa o
 *     par `human_handling -human.claimed->`, que não está na tabela D16. Dois
 *     atendentes clicando ao mesmo tempo serializam nessa trava, e o segundo
 *     encontra a conversa já em `human_handling`;
 *  2. o `update … where claimed_at is null` deste arquivo, dentro da MESMA
 *     transação, que devolve zero linhas se alguém chegou antes.
 *
 * A segunda existe porque a primeira não cobre o caso do handoff ANTIGO: uma
 * conversa que voltou para a IA (`resume_ai`, D34) e foi para a fila de novo tem
 * dois dossiês, e sem a guarda o claim do novo carimbaria o velho.
 *
 * ═══ Recusa é RESULTADO, não exceção ══════════════════════════════════════
 *
 * Mesma doutrina de §5.8 invariante 4: `claim` devolve `{ok:false, reason}` com
 * o motivo em ETIQUETA, nunca frase (G-78). Exceção fica para defeito — banco
 * fora do ar, invariante violado.
 */
import {
  IllegalTransition,
  transition,
  type ConversationState,
  type TransitionEffect,
} from "@/src/conversation";
import { incrementCounter } from "@/src/obs/counters";
import { papelD15DoHerdado, type PapelD15 } from "@/src/rbac/matrix";
import { getSetting } from "@/src/tenant-config/settings";
import type { ServicePool } from "@/src/tenant-context/db";
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";

import {
  camposAusentes,
  ResumoIncompleto,
  type ResumoDoHandoff,
} from "./resumo";

/**
 * O único valor de `handoff.assignment` da Fase 1 (§5.2, §5.11): todo
 * `attendant` vê o handoff e um faz o claim. `round_robin` é Fase 2 e não tem
 * código aqui — entrada de vocabulário sem implementação é uma fila que promete
 * distribuir e não distribui.
 */
export const ATRIBUICAO_DA_FASE_1 = "queue" as const;

/** O default de §5.2 para `handoff.queue_roles`. */
export const PAPEIS_DA_FILA_PADRAO: readonly PapelD15[] = Object.freeze(["attendant"]);

export interface DepsDoHandoff {
  pool?: ServicePool;
}

// ─── 1 · Gravar o dossiê ────────────────────────────────────────────────────

/**
 * Grava o dossiê DENTRO da transação de `transition()` e devolve o id.
 *
 * Deduplica por EPISÓDIO, exatamente como o aviso herdado
 * (`human-handoff.ts:173-186`, "dedup por episódio ABERTO"): o índice parcial
 * `handoffs_um_aberto_por_conversa` faz do segundo `handoff.requested` da mesma
 * conversa um no-op que devolve o id do dossiê que já estava aberto. Sem isso,
 * um handoff repetido (o mesmo turno reprocessado pela fila) daria à pessoa dois
 * cartões para a mesma conversa.
 *
 * O resumo é conferido ANTES da escrita: dossiê incompleto gravado é uma pessoa
 * abrindo a fila e não sabendo o que fazer. O banco também recusa (CHECKs da
 * 9020) — as duas réguas são de propósito, porque só uma delas fala português.
 */
export async function gravarHandoff(
  db: TenantDb,
  ctx: TenantCtx,
  entrada: {
    readonly conversation_id: string;
    readonly created_by: "ai" | "system" | "human";
    readonly resumo: ResumoDoHandoff;
  },
): Promise<string> {
  const faltando = camposAusentes(entrada.resumo);
  if (faltando.length > 0) throw new ResumoIncompleto(faltando);

  const gravado = await db.query<{ id: string }>(
    `insert into public.handoffs
       (organization_id, conversation_id, reason, customer, intent, summary,
        last_messages, pending_action, suggested_next_step, created_by)
     values ($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::jsonb,$8::text,$9::text,$10::text)
     on conflict (organization_id, conversation_id) where claimed_at is null
     do nothing
     returning id`,
    [
      ctx.organization_id,
      entrada.conversation_id,
      entrada.resumo.reason,
      entrada.resumo.customer,
      entrada.resumo.intent,
      entrada.resumo.summary,
      JSON.stringify(entrada.resumo.last_messages),
      entrada.resumo.pending_action,
      entrada.resumo.suggested_next_step,
      entrada.created_by,
    ],
  );
  const criado = gravado.rows[0]?.id;
  if (criado !== undefined) {
    incrementCounter("handoff_registrado", { reason: entrada.resumo.reason });
    return criado;
  }

  // `do nothing` não devolve linha: o episódio já tinha dossiê aberto.
  const existente = await db.query<{ id: string }>(
    `select id from public.handoffs
      where organization_id = $1 and conversation_id = $2 and claimed_at is null`,
    [ctx.organization_id, entrada.conversation_id],
  );
  const id = existente.rows[0]?.id;
  if (id === undefined) {
    throw new Error("handoffs não devolveu id nem tinha dossiê aberto para o episódio");
  }
  incrementCounter("handoff_deduplicado", { reason: entrada.resumo.reason });
  return id;
}

// ─── 2 · A fila (§5.11, `assignment = queue`) ───────────────────────────────

/** Um handoff aberto, como o atendente o vê na fila. */
export interface HandoffNaFila {
  readonly id: string;
  readonly conversation_id: string;
  readonly reason: string;
  readonly customer: string;
  readonly intent: string;
  readonly summary: string;
  readonly pending_action: string | null;
  readonly suggested_next_step: string;
  readonly created_at: string;
}

/** A linha como o driver a devolve: `timestamptz` chega como `Date`. */
interface LinhaDaFila extends Omit<HandoffNaFila, "created_at"> {
  created_at: Date | string;
}

/** `handoff.assignment` fora do vocabulário da Fase 1 — falha FECHADA. */
export class AtribuicaoNaoSuportada extends Error {
  constructor(public readonly valor: unknown) {
    super(
      `handoff.assignment=${String(valor)} não existe na Fase 1 (§5.11: só ` +
        `${ATRIBUICAO_DA_FASE_1}); round_robin é Fase 2`,
    );
    this.name = "AtribuicaoNaoSuportada";
  }
}

function papeisDaFila(valor: unknown): readonly PapelD15[] {
  if (!Array.isArray(valor)) return PAPEIS_DA_FILA_PADRAO;
  const lidos = valor.filter(
    (item): item is PapelD15 =>
      typeof item === "string" &&
      (["platform_admin", "tenant_admin", "attendant"] as readonly string[]).includes(item),
  );
  // Lista configurada só com lixo NÃO vira "ninguém vê": a fila ficaria muda e
  // o handoff, invisível. Cai no default declarado de §5.2.
  return lidos.length > 0 ? lidos : PAPEIS_DA_FILA_PADRAO;
}

/**
 * A modalidade de atribuição do tenant, conferida contra o vocabulário da fase.
 *
 * Valor fora do vocabulário LANÇA em vez de cair no default: `assignment` é a
 * chave que decide QUEM vê a conversa de um cliente, e adivinhar ali é escolher
 * em silêncio por quem configurou outra coisa.
 */
export async function modalidadeDeAtribuicao(
  ctx: TenantCtx,
  deps: DepsDoHandoff = {},
): Promise<typeof ATRIBUICAO_DA_FASE_1> {
  const valor = await getSetting(ctx, "handoff.assignment", deps);
  if (valor !== ATRIBUICAO_DA_FASE_1) throw new AtribuicaoNaoSuportada(valor);
  return ATRIBUICAO_DA_FASE_1;
}

/** O papel D15 deste usuário NESTE tenant, ou `null` quando ele não é membro. */
export async function papelNaOrganizacao(
  ctx: TenantCtx,
  userId: string,
  deps: DepsDoHandoff = {},
): Promise<PapelD15 | null> {
  return withTenant(
    ctx,
    async (db) => {
      const linha = await db.query<{ role: string }>(
        `select role from public.user_organizations
          where organization_id = $1 and user_id = $2
            and accepted_at is not null and revoked_at is null`,
        [ctx.organization_id, userId],
      );
      const role = linha.rows[0]?.role;
      return role === undefined ? null : papelD15DoHerdado(role);
    },
    deps,
  );
}

/**
 * O que ESTE usuário vê na fila.
 *
 * Fase 1 = `queue`: TODO usuário cujo papel D15 está em `handoff.queue_roles` vê
 * TODOS os handoffs abertos do tenant — não há recorte por pessoa, e é isso que
 * faz o claim ser uma corrida em vez de uma entrega. Quem não está nos papéis da
 * fila recebe lista vazia (não é erro: ele simplesmente não é da fila).
 */
export async function filaDeHandoffs(
  ctx: TenantCtx,
  userId: string,
  deps: DepsDoHandoff = {},
): Promise<readonly HandoffNaFila[]> {
  await modalidadeDeAtribuicao(ctx, deps);
  const papeis = papeisDaFila(await getSetting(ctx, "handoff.queue_roles", deps));
  const papel = await papelNaOrganizacao(ctx, userId, deps);
  if (papel === null || !papeis.includes(papel)) return [];

  return withTenant(
    ctx,
    async (db) => {
      // O tipo da LINHA é o do driver (`created_at` vem `Date`), e não o da
      // interface de saída (`string`). Intersectar os dois daria
      // `Date & string` = `string`, e o `instanceof` abaixo deixaria de
      // compilar — sintoma de um tipo que mente sobre o que o banco devolve.
      const linhas = await db.query<LinhaDaFila>(
        `select id, conversation_id, reason, customer, intent, summary,
                pending_action, suggested_next_step, created_at
           from public.handoffs
          where organization_id = $1 and claimed_at is null
          order by created_at asc, id asc`,
        [ctx.organization_id],
      );
      return linhas.rows.map((linha) => ({
        ...linha,
        created_at:
          linha.created_at instanceof Date
            ? linha.created_at.toISOString()
            : String(linha.created_at),
      }));
    },
    deps,
  );
}

// ─── 3 · O claim ────────────────────────────────────────────────────────────

/** Etiqueta de recusa — nunca frase (G-78). */
export type MotivoDaRecusaDeClaim =
  | "handoff_not_found"
  | "not_in_queue"
  | "already_claimed"
  | "illegal_transition";

export type ResultadoDoClaim =
  | {
      readonly ok: true;
      readonly handoff_id: string;
      readonly conversation_id: string;
      readonly assignee_id: string;
      readonly from: ConversationState;
      readonly to: ConversationState;
    }
  | {
      readonly ok: false;
      readonly reason: MotivoDaRecusaDeClaim;
      readonly handoff_id: string;
      /** Código do movimento recusado, quando houver. Nunca texto livre. */
      readonly detalhe?: string;
    };

/** Sinal interno: alguém chegou antes DENTRO da transação. Não sobe daqui. */
class ClaimPerdido extends Error {
  constructor() {
    super("handoff já assumido");
    this.name = "ClaimPerdido";
  }
}

/**
 * O `claim(ctx, handoff_id)` de §5.11.
 *
 * Reusa `transition(human.claimed)`, que já delega a atribuição a
 * `fn_conversation_assign` (efeito `assign_to_actor` da tabela D16). O executor
 * de efeito injetado carimba `claimed_by`/`claimed_at` e devolve `false` — e o
 * `false` é o ponto: ele DEVOLVE o efeito ao executor interno, para que a RPC
 * herdada continue sendo quem escreve `assigned_to_user_id`, o nome
 * desnormalizado e o evento de atribuição. Devolver `true` teria carimbado o
 * dossiê e deixado a conversa sem dono.
 */
export async function claim(
  ctx: TenantCtx,
  handoffId: string,
  userId: string,
  deps: DepsDoHandoff = {},
): Promise<ResultadoDoClaim> {
  await modalidadeDeAtribuicao(ctx, deps);

  const cabecalho = await withTenant(
    ctx,
    async (db) => {
      const linha = await db.query<{ conversation_id: string; claimed_at: Date | null }>(
        `select conversation_id, claimed_at from public.handoffs
          where id = $1 and organization_id = $2`,
        [handoffId, ctx.organization_id],
      );
      return linha.rows[0] ?? null;
    },
    deps,
  );
  if (cabecalho === null) {
    incrementCounter("handoff_claim_recusado", { reason: "handoff_not_found" });
    return { ok: false, reason: "handoff_not_found", handoff_id: handoffId };
  }
  if (cabecalho.claimed_at !== null) {
    incrementCounter("handoff_claim_recusado", { reason: "already_claimed" });
    return { ok: false, reason: "already_claimed", handoff_id: handoffId };
  }

  const papeis = papeisDaFila(await getSetting(ctx, "handoff.queue_roles", deps));
  const papel = await papelNaOrganizacao(ctx, userId, deps);
  if (papel === null || !papeis.includes(papel)) {
    incrementCounter("handoff_claim_recusado", { reason: "not_in_queue" });
    return { ok: false, reason: "not_in_queue", handoff_id: handoffId };
  }

  try {
    const movimento = await transition(
      ctx,
      cabecalho.conversation_id,
      "human.claimed",
      { kind: "attendant", userId },
      {
        ...deps,
        effects: async (
          db: TenantDb,
          ctxEfeito: TenantCtx,
          _conversationId: string,
          efeito: TransitionEffect,
        ) => {
          if (efeito !== "assign_to_actor") return false;
          const carimbo = await db.query(
            `update public.handoffs
                set claimed_by = $3::uuid, claimed_at = now()
              where id = $1 and organization_id = $2 and claimed_at is null`,
            [handoffId, ctxEfeito.organization_id, userId],
          );
          if (carimbo.rowCount === 0) throw new ClaimPerdido();
          // `false` DE PROPÓSITO: a atribuição da conversa continua sendo de
          // `fn_conversation_assign`, no executor interno de `transition()`.
          return false;
        },
      },
    );
    incrementCounter("handoff_assumido");
    return {
      ok: true,
      handoff_id: handoffId,
      conversation_id: cabecalho.conversation_id,
      assignee_id: userId,
      from: movimento.from,
      to: movimento.to,
    };
  } catch (erro) {
    if (erro instanceof ClaimPerdido) {
      incrementCounter("handoff_claim_recusado", { reason: "already_claimed" });
      return { ok: false, reason: "already_claimed", handoff_id: handoffId };
    }
    if (erro instanceof IllegalTransition) {
      incrementCounter("handoff_claim_recusado", { reason: "illegal_transition" });
      return {
        ok: false,
        reason: "illegal_transition",
        handoff_id: handoffId,
        detalhe: `${erro.from}:${erro.event}:${erro.reason}`,
      };
    }
    throw erro;
  }
}
