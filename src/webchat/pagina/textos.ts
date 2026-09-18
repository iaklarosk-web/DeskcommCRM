/**
 * Os textos da página do visitante (F14, ADR-038 §2 T02), em pt-BR e es —
 * a página não é `.tsx` (é HTML servido por Route Handler, para poder emitir
 * `Content-Security-Policy: frame-ancestors` por organização), então o
 * dicionário do produto não a alcança; os dois idiomas do produto vivem aqui.
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
    indisponivel: "O chat não está disponível agora.",
    muitasMensagens: "Muitas mensagens em pouco tempo. Aguarde um instante.",
    erro: "Não foi possível enviar. Tente de novo.",
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
    indisponivel: "El chat no está disponible ahora.",
    muitasMensagens: "Demasiados mensajes en poco tiempo. Espera un momento.",
    erro: "No se pudo enviar. Inténtalo de nuevo.",
  },
};

export function idiomaDaPagina(bruto: string | null | undefined): IdiomaDaPagina {
  return bruto?.toLowerCase().startsWith("es") ? "es" : "pt-BR";
}
