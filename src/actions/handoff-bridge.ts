/**
 * O efeito `create_handoff` de D16 — TRÊS escritas, na mesma transação.
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
 * ─── O que a F05-T05 acrescentou: o aviso POR USUÁRIO ──────────────────────
 *
 * `notify(handoff.created)` (§5.16) para as MESMAS pessoas que veem a fila
 * (`handoff.queue_roles`, §5.11) — uma linha em `notifications` por attendant
 * ativo, e e-mail mock se o tenant ligou. Sai UMA vez por episódio: quando o
 * dossiê já existia (`criado=false`, reprocessamento do mesmo turno) ninguém é
 * avisado de novo. É a terceira escrita, na mesma transação das outras duas.
 */
import type { MotivoDeHandoff } from "@/src/handoff/motivos";
import { gravarHandoff, papeisDaFila } from "@/src/handoff/registro";
import { montarResumo, type ResumoDoHandoff } from "@/src/handoff/resumo";
import { membrosPorPapel, notify } from "@/src/notifications";
import { getSettingIn } from "@/src/tenant-config";
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
  /** Quantas pessoas receberam `handoff.created` (0 quando o episódio já tinha dossiê). */
  readonly notificados: number;
}

/**
 * Monta o dossiê, grava-o, cria o aviso da organização e avisa as pessoas da
 * fila — tudo DENTRO da transação de `transition()`.
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

  const dossie = await gravarHandoff(db, ctx, {
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

  let notificados = 0;
  if (dossie.criado) {
    const fila = await membrosPorPapel(
      db,
      ctx,
      papeisDaFila(await getSettingIn(db, ctx, "handoff.queue_roles")),
    );
    // Só ids e rótulos no payload (§5.16): o resumo fica no dossiê, que a
    // pessoa abre pela fila.
    const aviso = await notify(db, ctx, "handoff.created", fila, {
      handoff_id: dossie.id,
      conversation_id: pedido.conversation_id,
      reason: pedido.reason,
      created_by: pedido.created_by,
    });
    notificados = aviso.count;
  }

  return { handoff_id: dossie.id, inbox_item_id: inboxItemId, resumo, notificados };
}
