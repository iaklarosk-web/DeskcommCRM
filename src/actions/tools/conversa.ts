/**
 * As quatro tools que tocam a CONVERSA: `transfer_to_human`,
 * `request_confirmation`, `send_message` e `resume_ai`.
 *
 * Nenhuma escreve `conversations.saas_state`: quem move conversa é
 * `transition()` (§5.6, ADR-016), e é ela que estas chamam. O texto que sai
 * para o cliente vai pelo caminho de saída de `src/actions/outbound.ts` — o
 * único do produto que fala com `adapter.send`.
 */
import { IllegalTransition, transition } from "@/src/conversation";

import { gravarItemDeHandoff } from "../handoff-bridge";
import { enviarMensagem } from "../outbound";
import {
  requestConfirmationInputSchema,
  resumeAiInputSchema,
  sendMessageInputSchema,
  transferToHumanInputSchema,
} from "../schemas";
import { bind, type ToolOutcome, type ToolRunner } from "./contrato";

/**
 * `IllegalTransition` é RECUSA, não defeito: pedir `resume_ai` numa conversa
 * que não está em `human_handling` é um erro do chamador, e §5.8 diz que recusa
 * vira `denied` contável. Qualquer outra exceção sobe.
 */
function recusaDeTransicao(erro: unknown, resourceId: string): ToolOutcome {
  if (erro instanceof IllegalTransition) {
    return {
      ok: false,
      reason: "illegal_transition",
      resourceId,
      detalhe: `${erro.from}:${erro.event}:${erro.reason}`,
    };
  }
  throw erro;
}

export const transferToHuman: ToolRunner = bind(
  transferToHumanInputSchema,
  async ({ ctx, actor, deps }, input) => {
    let itemDeInbox = "";
    let dossie = "";
    try {
      // O ator da TABELA D16 para `handoff.requested` é `ai` ou `system`. Um
      // humano que empurra a conversa para a fila entra como `system` (o
      // "gatilho D19" da linha); QUEM puxou o gatilho fica em
      // `audit_events.actor_id`, que é onde identidade mora.
      //
      // `created_by` do dossiê (§5.11) é OUTRA pergunta e por isso tem outro
      // valor: ali interessa se o dossiê nasceu da IA, de um gatilho de sistema
      // ou de uma pessoa — e `automation` vira `system`, porque o cron também é
      // gatilho e não é gente.
      const movimento = await transition(
        ctx,
        input.conversation_id,
        "handoff.requested",
        { kind: actor.kind === "ai" ? "ai" : "system" },
        {
          pool: deps.pool,
          effects: async (db, ctxEfeito, conversationId, efeito) => {
            if (efeito !== "create_handoff") return false;
            const gravado = await gravarItemDeHandoff(db, ctxEfeito, {
              conversation_id: conversationId,
              reason: input.reason,
              summary: input.summary,
              intent: input.intent,
              pending_action: input.pending_action,
              created_by: actor.kind === "automation" ? "system" : actor.kind,
            });
            itemDeInbox = gravado.inbox_item_id;
            dossie = gravado.handoff_id;
            return true;
          },
        },
      );
      return {
        ok: true,
        output: {
          from: movimento.from,
          to: movimento.to,
          inbox_item_id: itemDeInbox,
          handoff_id: dossie,
        },
        resourceId: input.conversation_id,
      };
    } catch (erro) {
      return recusaDeTransicao(erro, input.conversation_id);
    }
  },
);

/**
 * `request_confirmation` pergunta AO CLIENTE e deixa o estado como está (§5.8).
 *
 * Não confundir com a confirmação `by_risk` de D33, que é a pendência para o
 * ATENDENTE e move a conversa para `waiting_confirmation`. São duas perguntas
 * diferentes, para duas pessoas diferentes: uma checa o que o cliente quis
 * dizer; a outra pede autorização humana para um efeito comercial.
 */
export const requestConfirmation: ToolRunner = bind(
  requestConfirmationInputSchema,
  async ({ ctx, actor, deps }, input) => {
    const enviada = await enviarMensagem(
      ctx,
      actor.kind,
      actor.user_id ?? null,
      {
        conversation_id: input.conversation_id,
        body: input.question,
        idempotency_key: input.idempotency_key,
      },
      deps,
    );
    if (!enviada.ok) {
      return { ok: false, reason: enviada.reason, resourceId: enviada.resourceId };
    }
    return {
      ok: true,
      output: { ...enviada.output },
      resourceId: enviada.output.message_id,
    };
  },
);

export const sendMessage: ToolRunner = bind(
  sendMessageInputSchema,
  async ({ ctx, actor, deps }, input) => {
    const enviada = await enviarMensagem(
      ctx,
      actor.kind,
      actor.user_id ?? null,
      input,
      deps,
    );
    if (!enviada.ok) {
      return { ok: false, reason: enviada.reason, resourceId: enviada.resourceId };
    }
    return {
      ok: true,
      output: { ...enviada.output },
      resourceId: enviada.output.message_id,
    };
  },
);

export const resumeAi: ToolRunner = bind(
  resumeAiInputSchema,
  async ({ ctx, actor, deps }, input) => {
    // D34: só de `human_handling`, e quem devolve é o `attendant`. A guarda
    // `ai_enabled` é da tabela; se a IA estiver desligada o movimento é
    // recusado — e recusado é melhor que devolver para uma IA que não responde.
    if (typeof actor.user_id !== "string") {
      return { ok: false, reason: "actor_without_user", resourceId: input.conversation_id };
    }
    try {
      const movimento = await transition(
        ctx,
        input.conversation_id,
        "human.return_to_ai",
        { kind: "attendant", userId: actor.user_id },
        { pool: deps.pool },
      );
      return {
        ok: true,
        output: { from: movimento.from, to: movimento.to },
        resourceId: input.conversation_id,
      };
    } catch (erro) {
      return recusaDeTransicao(erro, input.conversation_id);
    }
  },
);
