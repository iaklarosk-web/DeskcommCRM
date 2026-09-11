/**
 * O efeito `create_handoff` de D16, com o portador que existe HOJE.
 *
 * §5.11 (F05) vai criar `handoffs(organization_id, conversation_id, reason,
 * customer, intent, summary, last_messages[5], pending_action,
 * suggested_next_step, created_by, claimed_by, claimed_at)` e o resumo de sete
 * campos de D19. Essa tabela é de lá, e inventá-la aqui para uma task de
 * catálogo criaria um schema que F05 teria de desfazer.
 *
 * O que existe hoje e já significa "chamaram uma pessoa" é
 * `agent_inbox_items(kind='handoff')`, herdado e em uso. `transfer_to_human`
 * grava ali, com `ref_kind='conversation'` e o motivo do enum de §5.11 no
 * título. Quando `handoffs` nascer, esta ponte vira uma linha a menos — e até
 * lá a alternativa era `EffectNotImplemented` subindo de dentro de uma tool que
 * a IA precisa ter.
 *
 * LIMITE DECLARADO: o resumo de sete campos, o `notify(handoff.created)` e o
 * `claim` são F05-T01. Aqui há UM texto de resumo e um item de inbox aberto.
 */
import type { TenantCtx, TenantDb } from "@/src/tenant-context";

export interface PedidoDeHandoff {
  readonly conversation_id: string;
  readonly reason: string;
  readonly summary: string;
}

/**
 * Grava o item de inbox DENTRO da transação de `transition()`. É o que faz o
 * movimento e o aviso serem a mesma coisa: uma conversa em `waiting_human` sem
 * item de inbox é uma conversa que ninguém vai ver.
 */
export async function gravarItemDeHandoff(
  db: TenantDb,
  ctx: TenantCtx,
  pedido: PedidoDeHandoff,
): Promise<string> {
  const gravado = await db.query<{ id: string }>(
    `insert into public.agent_inbox_items
       (organization_id, kind, severity, title, body, ref_kind, ref_id, status)
     values ($1::uuid,'handoff','warn',$2::text,$3::text,'conversation',$4::uuid,'open')
    returning id`,
    [
      ctx.organization_id,
      `handoff: ${pedido.reason}`,
      pedido.summary,
      pedido.conversation_id,
    ],
  );
  const id = gravado.rows[0]?.id;
  if (id === undefined) throw new Error("agent_inbox_items não devolveu id do handoff");
  return id;
}
