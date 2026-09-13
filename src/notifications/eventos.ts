/**
 * Os SEIS eventos de notificação da Fase 1 (§5.16, "lista única") — e o texto
 * determinístico de cada um.
 *
 * Enum e nunca frase (G-78): o valor é etiqueta de contador, filtro da lista
 * in-app e CHECK no banco (`notifications_event_check`, migration 9021). Evento
 * novo = 1 valor aqui + 1 valor no CHECK, no mesmo commit — o teste de schema
 * confere os dois lados contra esta lista.
 *
 * Os textos de e-mail vivem aqui, ao lado do evento, porque são PARTE do
 * evento: o assunto de `job.blocked` não muda por tenant, e um template por
 * chamador faria o mesmo fato chegar com duas frases. Nenhum texto carrega
 * conteúdo de mensagem do cliente — só rótulos e ids, que é o que o `payload`
 * também carrega.
 */

export const EVENTOS_DE_NOTIFICACAO = [
  "handoff.created",
  "task.assigned",
  "confirmation.requested",
  "customer.replied_while_human",
  "reminder.no_reply",
  "job.blocked",
] as const;

export type EventoDeNotificacao = (typeof EVENTOS_DE_NOTIFICACAO)[number];

export function ehEventoDeNotificacao(valor: unknown): valor is EventoDeNotificacao {
  return (
    typeof valor === "string" &&
    (EVENTOS_DE_NOTIFICACAO as readonly string[]).includes(valor)
  );
}

/** Assunto e corpo do e-mail, por evento. `{{campo}}` lê do payload. */
export const TEXTO_DO_EMAIL: Record<
  EventoDeNotificacao,
  { readonly assunto: string; readonly corpo: string }
> = {
  "handoff.created": {
    assunto: "Uma conversa precisa de você",
    corpo:
      "Uma conversa saiu da IA e está na fila (motivo: {{reason}}). Abra o inbox para assumir. Conversa: {{conversation_id}}.",
  },
  "task.assigned": {
    assunto: "Uma tarefa foi atribuída a você",
    corpo: "A tarefa {{task_id}} foi atribuída a você. Abra o CRM para ver os detalhes.",
  },
  "confirmation.requested": {
    assunto: "Uma ação da IA aguarda a sua confirmação",
    corpo:
      "A IA pediu para executar {{action_name}} e aguarda confirmação no inbox. Conversa: {{conversation_id}}.",
  },
  "customer.replied_while_human": {
    assunto: "O cliente respondeu na conversa que é sua",
    corpo: "Chegou uma mensagem nova na conversa {{conversation_id}}, que está com uma pessoa.",
  },
  "reminder.no_reply": {
    assunto: "Cliente sem resposta ao lembrete do pedido",
    corpo:
      "O cliente {{customer_id}} não respondeu ao lembrete do período {{period_key}} dentro do prazo. Verifique o pedido.",
  },
  "job.blocked": {
    assunto: "Um envio ficou bloqueado",
    corpo:
      "O job {{job_id}} falhou {{attempts}} vezes e foi bloqueado ({{error}}). Nada mais roda sozinho até alguém olhar.",
  },
};

/**
 * Preenche `{{campo}}` com o valor do payload. Campo ausente vira `?` de
 * propósito — e não string vazia: um assunto com um buraco visível denuncia o
 * chamador que esqueceu o id; um assunto perfeito com o id apagado não.
 */
export function preencher(template: string, payload: Readonly<Record<string, unknown>>): string {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (_tudo, campo: string) => {
    const valor = payload[campo];
    return valor === undefined || valor === null ? "?" : String(valor);
  });
}
