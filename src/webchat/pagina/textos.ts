/**
 * Os textos da página do visitante (F14, ADR-038 §2 T02), em pt-BR e es —
 * a página não é `.tsx` (é HTML servido por Route Handler, para poder emitir
 * `Content-Security-Policy: frame-ancestors` por organização), então o
 * dicionário do produto não a alcança; os dois idiomas do produto vivem aqui.
 *
 * F24 (Suporte KN, 25/09/2026):
 *  - `retornoCombinado` é o que o visitante lê na fila quando a organização
 *    escolhe `webchat.handoff_mode = retorno`: `{empresa}`, `{contato}` (o que
 *    ele informou na identificação) e `{prazo}` (`webchat.return_deadline_text`).
 *    `seuContato` é o que entra em `{contato}` se a sessão não o trouxer.
 *  - `semRede` e `recusada` distinguem "a rede falhou" de "o servidor recusou":
 *    o texto antigo (`erro`) dizia a mesma coisa para os dois, e o visitante
 *    do site http lia "tente de novo" para um 422 que nunca ia passar.
 */
export type IdiomaDaPagina = "pt-BR" | "es";

export const TEXTOS_DA_PAGINA: Record<IdiomaDaPagina, Record<string, string>> = {
  "pt-BR": {
    titulo: "Fale com a gente",
    boasVindas: "Olá! Escreva a sua mensagem. Para responder, precisamos do seu nome e de um contato.",
    nome: "Seu nome",
    contato: "E-mail ou telefone",
    continuar: "Continuar",
    escrever: "Escreva a sua mensagem…",
    enviar: "Enviar",
    assistente: "Assistente",
    atendente: "Atendente",
    voce: "Você",
    foraDoHorario: "Estamos fora do horário de atendimento. A assistente responde agora; um atendente continua a partir de {hora}.",
    aguardandoHumano: "Sua conversa está na fila para um atendente.",
    retornoCombinado: "Recebemos sua pergunta. {empresa} responde por {contato} em até {prazo}.",
    seuContato: "e-mail ou telefone informado",
    indisponivel: "O chat não está disponível agora.",
    muitasMensagens: "Muitas mensagens em pouco tempo. Aguarde um instante.",
    erro: "Não foi possível enviar. Confira o nome e o contato e tente de novo.",
    semRede: "Sem conexão. Verifique a internet e tente de novo.",
    recusada: "A mensagem não foi aceita. Recarregue a página e tente de novo.",
  },
  es: {
    titulo: "Habla con nosotros",
    boasVindas: "¡Hola! Escribe tu mensaje. Para responder, necesitamos tu nombre y un contacto.",
    nome: "Tu nombre",
    contato: "Correo o teléfono",
    continuar: "Continuar",
    escrever: "Escribe tu mensaje…",
    enviar: "Enviar",
    assistente: "Asistente",
    atendente: "Agente",
    voce: "Tú",
    foraDoHorario: "Estamos fuera del horario de atención. La asistente responde ahora; un agente continúa a partir de las {hora}.",
    aguardandoHumano: "Tu conversación está en la fila para un agente.",
    retornoCombinado: "Recibimos tu pregunta. {empresa} responde por {contato} en hasta {prazo}.",
    seuContato: "correo o teléfono informado",
    indisponivel: "El chat no está disponible ahora.",
    muitasMensagens: "Demasiados mensajes en poco tiempo. Espera un momento.",
    erro: "No se pudo enviar. Revisa el nombre y el contacto e inténtalo de nuevo.",
    semRede: "Sin conexión. Revisa tu internet e inténtalo de nuevo.",
    recusada: "El mensaje no fue aceptado. Recarga la página e inténtalo de nuevo.",
  },
};

export function idiomaDaPagina(bruto: string | null | undefined): IdiomaDaPagina {
  return bruto?.toLowerCase().startsWith("es") ? "es" : "pt-BR";
}
