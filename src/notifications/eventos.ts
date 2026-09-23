/**
 * Os SEIS eventos de notificação da Fase 1 (§5.16, "lista única") mais os
 * TRÊS da assinatura (F12-T01, D44, ADR-030 §3) — e o texto determinístico de
 * cada um.
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
  // F12 (D44): aviso, bloqueio e reativação da assinatura. Vão ao
  // `tenant_admin`; nunca carregam valor de fatura — só o estado e o prazo.
  "subscription.payment_failed",
  "subscription.blocked",
  "subscription.activated",
  // F15-T02 (ADR-036 §2, D54 c): a IA da organização bateu o limite diário de
  // turnos e ficou pausada até o dia virar. Vai ao `tenant_admin`; só números.
  "ai.limit_reached",
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
  "subscription.payment_failed": {
    assunto: "Pagamento da assinatura não confirmado",
    corpo:
      "O pagamento da assinatura não foi confirmado. Você tem até {{grace_until}} para regularizar; depois disso novas operações ficam bloqueadas e seus dados continuam preservados. Regularize em /app/billing.",
  },
  "subscription.blocked": {
    assunto: "Assinatura bloqueada por atraso",
    corpo:
      "O prazo de regularização terminou e novas operações estão bloqueadas. Seus dados e o acesso à cobrança continuam disponíveis em /app/billing; o pagamento confirmado reativa a conta.",
  },
  "subscription.activated": {
    assunto: "Assinatura ativa",
    corpo:
      "O pagamento foi confirmado e a assinatura ({{plan_code}}) está ativa até {{current_period_end}}.",
  },
  "ai.limit_reached": {
    assunto: "A IA atingiu o limite diário e está pausada",
    corpo:
      "A IA desta organização usou {{used}} de {{limit}} turnos permitidos em {{day}} e não responde mais sozinha até o dia virar; as conversas seguem para a fila de pessoas. Ajuste o limite em /app/settings/tenant/ia/autonomia.",
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
