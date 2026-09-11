/**
 * O efeito `create_handoff` de D16 — DUAS escritas, na mesma transação.
 *
 * ─── O que mudou na F05-T01/T02, e o que NÃO mudou ─────────────────────────
 *
 * Até a F04 aqui havia UMA escrita: o aviso da organização em
 * `agent_inbox_items(kind='handoff')`, herdado, com tela e uso. O comentário
 * desta ponte dizia que `handoffs` era de F05 e que, quando ela nascesse,
 * "esta ponte vira uma linha a menos".
 *
 * Virou uma linha a MAIS, e a diferença é deliberada: o aviso herdado continua
 * exatamente como estava. Apagá-lo tiraria da Central de avisos uma linha que
 * hoje aparece, e o dossiê de §5.11 é outra coisa — não é o aviso "chamaram uma
 * pessoa", é o que a pessoa lê para assumir. Os dois convivem porque respondem a
 * perguntas diferentes, e escrevê-los na MESMA transação de `transition()` é o
 * que faz "a conversa foi para a fila", "alguém foi avisado" e "há o que ler"
 * serem o mesmo fato — uma conversa em `waiting_human` sem as duas linhas é uma
 * conversa que ninguém vai ver.
 *
 * ─── O que AINDA não está aqui ─────────────────────────────────────────────
 *
 * LIMITE DECLARADO: `notify(handoff.created)` por USUÁRIO (a tabela
 * `notifications` de §5.16) é F05-T05. O aviso de ORGANIZAÇÃO abaixo é o que
 * existe hoje, e nenhum aviso existente deixou de aparecer.
 */
import type { MotivoDeHandoff } from "@/src/handoff/motivos";
import { gravarHandoff } from "@/src/handoff/registro";
import { montarResumo, type ResumoDoHandoff } from "@/src/handoff/resumo";
import type { TenantCtx, TenantDb } from "@/src/tenant-context";

export interface PedidoDeHandoff {
  readonly conversation_id: string;
  readonly reason: MotivoDeHandoff;
  readonly summary: string;
  readonly intent?: string | undefined;
  readonly pending_action?: string | null | undefined;
  /** Quem puxou o gatilho, no vocabulário de `handoffs.created_by` (§5.11). */
  readonly created_by: "ai" | "system" | "human";
}

export interface HandoffGravado {
  readonly handoff_id: string;
  readonly inbox_item_id: string;
  readonly resumo: ResumoDoHandoff;
}

/**
 * Monta o dossiê, grava-o e cria o aviso da organização — tudo DENTRO da
 * transação de `transition()`.
 *
 * A ordem importa: o resumo é montado ANTES das escritas porque ele LÊ o
 * histórico, e lê-lo depois de o estado mudar daria um dossiê de um instante
 * diferente do da passagem.
 *
 * O corpo do aviso herdado passa a ser o `summary` do dossiê, e não mais o
 * texto cru do chamador: quem lê a Central e quem lê a fila passam a ver a
 * mesma frase, em vez de duas versões do mesmo fato.
 */
export async function gravarItemDeHandoff(
  db: TenantDb,
  ctx: TenantCtx,
  pedido: PedidoDeHandoff,
): Promise<HandoffGravado> {
  const resumo = await montarResumo(db, ctx, {
    conversation_id: pedido.conversation_id,
    reason: pedido.reason,
    intent: pedido.intent,
    summary: pedido.summary,
    pending_action: pedido.pending_action,
  });

  const handoffId = await gravarHandoff(db, ctx, {
    conversation_id: pedido.conversation_id,
    created_by: pedido.created_by,
    resumo,
  });

  const gravado = await db.query<{ id: string }>(
    `insert into public.agent_inbox_items
       (organization_id, kind, severity, title, body, ref_kind, ref_id, status)
     values ($1::uuid,'handoff','warn',$2::text,$3::text,'conversation',$4::uuid,'open')
    returning id`,
    [ctx.organization_id, `handoff: ${pedido.reason}`, resumo.summary, pedido.conversation_id],
  );
  const inboxItemId = gravado.rows[0]?.id;
  if (inboxItemId === undefined) {
    throw new Error("agent_inbox_items não devolveu id do handoff");
  }
  return { handoff_id: handoffId, inbox_item_id: inboxItemId, resumo };
}
