/**
 * O ESTADO D16 EM PORTUGUÊS — um mapa, nenhuma segunda lista.
 *
 * A tela precisa dizer em que estado a conversa está (§7.4, F03-T09: "estado
 * exibido na lista e no cabeçalho"). O vocabulário é o de `src/conversation`,
 * e este arquivo só lhe dá rótulo.
 *
 * ## Por que `Record<ConversationState, string>` e não um array de nomes
 *
 * Escrever os oito nomes numa SEGUNDA lista é o defeito que a tabela D16 existe
 * para impedir: duas listas divergem em silêncio, e a tela passa a nomear um
 * conjunto de estados que a máquina não tem. Aqui os nomes aparecem uma vez, como
 * CHAVES de um `Record` fechado pelo tipo — estado novo na tabela quebra o
 * compilador aqui, e chave que não exista na tabela também. A ORDEM de exibição
 * vem de `CONVERSATION_STATES`, nunca de uma cópia local.
 *
 * ## Por que o import é do módulo `transitions` e não do índice
 *
 * Este arquivo é importado por componentes `"use client"`. O índice de
 * `src/conversation` reexporta `transition()`, que arrasta `pg`, o pool de
 * service-role e `@/lib/env` para o grafo — tudo isso é servidor. `transitions.ts`
 * é dado puro: a tabela e os nomes, sem nenhuma dependência de runtime.
 */
import {
  CONVERSATION_STATES,
  type ConversationState,
} from "@/src/conversation/transitions";

export type { ConversationState };

export const ROTULO_DO_ESTADO_D16: Record<ConversationState, string> = {
  open: "Aberta",
  ai_handling: "Atendimento automático",
  waiting_customer: "Aguardando o cliente",
  waiting_confirmation: "Aguardando confirmação",
  waiting_human: "Aguardando atendente",
  human_handling: "Em atendimento humano",
  resolved: "Resolvida",
  archived: "Arquivada",
};

/** A ordem da tabela D16, sem cópia: o filtro da lista usa exatamente esta. */
export const ESTADOS_D16: readonly ConversationState[] = CONVERSATION_STATES;

export function ehEstadoD16(valor: unknown): valor is ConversationState {
  return typeof valor === "string" && (CONVERSATION_STATES as readonly string[]).includes(valor);
}

/**
 * O rótulo do estado, ou `null` quando a conversa veio de uma resposta em cache
 * anterior à coluna. `null` não é "sem estado": é "não sei", e a tela omite o
 * selo em vez de afirmar um estado que ela não leu.
 */
export function rotuloDoEstadoD16(valor: unknown): string | null {
  return ehEstadoD16(valor) ? ROTULO_DO_ESTADO_D16[valor] : null;
}

/**
 * Estados em que não há mais o que responder. Derivado da tabela, não digitado:
 * são os estados de onde `human.reply_sent` é ilegal E que a tabela alcança como
 * desfecho. Mantido curto de propósito — quem decide o que é responder é
 * `transitions.ts`, e o composer só evita oferecer o que a máquina vai recusar.
 */
export const ESTADOS_D16_ENCERRADOS: readonly ConversationState[] = ["resolved", "archived"];
