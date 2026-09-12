/**
 * AS CINCO AÇÕES DO INBOX, DITAS COMO EVENTOS D16 (F03-T09).
 *
 * Assumir, responder, transferir, resolver e reabrir deixam de escrever estado
 * por conta própria e passam a atravessar `transition()` — a única autoridade de
 * evento da conversa (§5.6, ADR-016). Nada de revisão de serviço, demanda ou
 * coerência de assignee é reimplementado aqui: `transition()` já delega o lado
 * legado do movimento a `fn_service_status` e `fn_conversation_assign`.
 *
 * ## O caso que exigiu desenho: Assumir a partir do automático
 *
 * A tabela D16 só admite `human.claimed` de `open` e de `waiting_human`. O botão
 * "Assumir" herdado também funciona com a conversa em `ai_handling` — e isso não
 * é um par ilegal, é uma SEQUÊNCIA: um atendente tomando a conversa da IA é o
 * gatilho "pedido explícito" de D19. Então, de `ai_handling` ou
 * `waiting_customer`, Assumir emite primeiro `handoff.requested` (que leva a
 * `waiting_human`) e em seguida `human.claimed`. Duas transições legais, mesma
 * UX, nenhuma linha nova na tabela D16.
 *
 * ## O que continua fora daqui
 *
 * `pause-ai`, `reactivate-bot` e `release` não são movimentos D16 desta fase:
 * `human.return_to_ai` já cobre o retorno e mexer no silêncio herdado sem prova é
 * o que a ADR-016 recusa. Eles seguem escrevendo `status` pelo caminho legado — e
 * a projeção `trg_saas_state_project` espelha essa escrita para `saas_state`, que
 * é exatamente para isso que ela existe.
 */
import { ApiError } from "@/lib/api/types";
import {
  ConversationNotFound,
  IllegalTransition,
  isConversationState,
  transition,
  type ConversationState,
  type TransitionActorRef,
  type TransitionEffect,
  type TransitionResult,
} from "@/src/conversation";
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";

export type AcaoDoInbox = "assumir" | "responder" | "transferir" | "resolver" | "reabrir";

/**
 * A ação da tela -> o evento da tabela. Uma linha por ação, e nenhuma ação sem
 * evento: o `Record` fechado impede que uma sexta ação nasça sem dizer que
 * movimento ela é.
 */
const EVENTO_DA_ACAO: Record<AcaoDoInbox, string> = {
  assumir: "human.claimed",
  responder: "human.reply_sent",
  transferir: "human.transferred",
  resolver: "human.resolved",
  reabrir: "human.reopened",
};

/**
 * Estados de onde Assumir precisa do handoff antes (ver o cabeçalho). São os
 * dois estados de origem da linha `handoff.requested` na tabela D16 — escritos
 * aqui porque é esta função que decide QUANDO emitir o gatilho, não a tabela.
 */
const ESTADOS_QUE_PEDEM_HANDOFF: readonly ConversationState[] = ["ai_handling", "waiting_customer"];

/** O evento no barramento que registra o handoff enquanto `handoffs` não existe. */
const EVENTO_DE_HANDOFF = "conversation.handoff_requested";

/**
 * Executor do efeito `create_handoff`.
 *
 * A tabela `handoffs` de §5.11 é da F05-T01 e ainda não existe; até lá o REGISTRO
 * do handoff é a linha no barramento — o mesmo `event_log` que a entrada SaaS já
 * usa. Devolver `true` sem escrever nada seria engolir o efeito, que é o que
 * `EffectNotImplemented` existe para impedir.
 *
 * O motivo viaja como enum (`customer_request`, um dos oito de §5.11), nunca como
 * frase (G-78): quem tomou a conversa da IA o fez a pedido explícito.
 */
function executorDoHandoff(
  organizationId: string,
  conversationId: string,
  actorUserId: string | null,
) {
  return async (
    db: TenantDb,
    _ctx: TenantCtx,
    _conversationId: string,
    effect: TransitionEffect,
  ): Promise<boolean> => {
    if (effect !== "create_handoff") return false;
    await db.query(
      `select public.emit_event($1::text,$2::text,$3::uuid,$4::jsonb,$5::jsonb,$6::uuid)`,
      [
        EVENTO_DE_HANDOFF,
        "conversation",
        conversationId,
        JSON.stringify({
          organization_id: organizationId,
          conversation_id: conversationId,
          reason: "customer_request",
          requested_by_user_id: actorUserId,
        }),
        JSON.stringify({ source: "inbox", severity: "info" }),
        organizationId,
      ],
    );
    return true;
  };
}

/**
 * O `TenantCtx` da ação do inbox.
 *
 * A org NÃO vem do corpo da requisição: `requireRole` já resolveu o usuário pelo
 * JWT e a organização ativa pelo cookie validado contra memberships — a MESMA
 * cadeia (`loadAuthUser` + `resolveActiveOrg`) que `fromSession()` embrulha.
 * Chamar `fromSession()` aqui repetiria as duas leituras por ação sem acrescentar
 * nenhuma verificação; o que ele garante é que a org é de fonte confiável, e ela
 * já é.
 */
export function ctxDoInbox(organizationId: string, userId: string, role?: string): TenantCtx {
  return { organization_id: organizationId, user_id: userId, role, source: "session" };
}

/** O estado D16 da conversa, ou `null` quando ela não existe neste tenant. */
export async function estadoD16DaConversa(
  ctx: TenantCtx,
  conversationId: string,
): Promise<ConversationState | null> {
  return withTenant(ctx, async (db) => {
    const leitura = await db.query<{ saas_state: string }>(
      `select saas_state from public.conversations
        where id = $1 and organization_id = $2`,
      [conversationId, ctx.organization_id],
    );
    const bruto = leitura.rows[0]?.saas_state;
    if (bruto === undefined) return null;
    if (!isConversationState(bruto)) {
      // Valor fora do CHECK é defeito de banco, não estado desconhecido da tela.
      throw new Error(`saas_state fora do vocabulário D16: ${bruto}`);
    }
    return bruto;
  });
}

/**
 * Move a conversa pela ação do inbox. Devolve `{from, to}` do movimento FINAL —
 * no caminho de Assumir a partir do automático, o `from` é o do `human.claimed`,
 * porque é ele que a tela acabou de pedir.
 */
export async function moverPeloInbox(
  ctx: TenantCtx,
  conversationId: string,
  acao: AcaoDoInbox,
  ator: TransitionActorRef,
): Promise<TransitionResult> {
  if (acao === "assumir") {
    const estado = await estadoD16DaConversa(ctx, conversationId);
    if (estado === null) throw new ConversationNotFound(conversationId);
    if (ESTADOS_QUE_PEDEM_HANDOFF.includes(estado)) {
      await transition(
        ctx,
        conversationId,
        "handoff.requested",
        { kind: "system" },
        {
          effects: executorDoHandoff(
            ctx.organization_id,
            conversationId,
            ator.userId ?? ctx.user_id ?? null,
          ),
        },
      );
    }
  }

  return transition(ctx, conversationId, EVENTO_DA_ACAO[acao], ator);
}

/**
 * A recusa da máquina traduzida para HTTP.
 *
 * Par ilegal é 409 com o motivo do ENUM (`pair`, `actor`, `guard`) — nunca 500 e
 * nunca sucesso silencioso. Conversa fora do tenant é 404, o mesmo que a leitura
 * devolve. Qualquer outro erro sobe: 500 genérico para uma falha de máquina de
 * estados esconderia o defeito.
 */
export function erroDeApiDaTransicao(
  erro: unknown,
  requestId: string,
  mensagem: (texto: string) => string,
): ApiError | null {
  if (erro instanceof IllegalTransition) {
    return new ApiError(
      409,
      "illegal_transition",
      { from: erro.from, event: erro.event, reason: erro.reason },
      requestId,
      mensagem("Esta ação não é possível no estado atual da conversa."),
    );
  }
  if (erro instanceof ConversationNotFound) {
    return new ApiError(404, "not_found", undefined, requestId, mensagem("Conversa não encontrada."));
  }
  return null;
}
