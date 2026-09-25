/**
 * Executa a página do visitante (`/chat/<slug>`) dentro do jsdom da suíte de
 * unidade — o HTML servido, com o script inline rodando de verdade contra um
 * `fetch` dublado. É o que permite provar comportamento de NAVEGADOR (id da
 * mensagem, aviso de rede, texto da fila, pré-preenchimento) sem Playwright.
 *
 * Só o `<body>` entra no documento; o `<script>` é extraído e executado com
 * `new Function`, porque `innerHTML` não executa script (por especificação).
 */
import { vi } from "vitest";

export const TOKEN_DA_SESSAO = "a".repeat(64);

export interface ChamadaDeRede {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

export type RespostaDublada = { status: number; json?: unknown } | Error;

/** O que a API responde por padrão: sessão nova, visitante já identificado, sem mensagens. */
export function respostaPadrao(chamada: ChamadaDeRede, extra: Record<string, unknown> = {}): RespostaDublada {
  if (chamada.url.endsWith("/session")) {
    return { status: 201, json: { data: { token: TOKEN_DA_SESSAO, session_id: "s1", identified: false } } };
  }
  if (chamada.url.endsWith("/identify")) {
    return { status: 200, json: { data: { identified: true, conversation_id: "c1", created_contact: true } } };
  }
  if (chamada.method === "GET") {
    return {
      status: 200,
      json: {
        data: {
          identified: true,
          messages: [],
          waiting_human: false,
          human_available: true,
          next_human_at: null,
          window: { start_hour: 7, end_hour: 22, timezone: "America/Sao_Paulo" },
          visitor_contact: "ana@exemplo.test",
          ...extra,
        },
      },
    };
  }
  return { status: 202, json: { data: { status: "ingerido" } } };
}

/** Instala um `fetch` dublado e devolve a lista viva das chamadas feitas. */
export function dublarRede(responder: (chamada: ChamadaDeRede) => RespostaDublada): ChamadaDeRede[] {
  const chamadas: ChamadaDeRede[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const chamada: ChamadaDeRede = {
        method: init?.method ?? "GET",
        url,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      };
      chamadas.push(chamada);
      const r = responder(chamada);
      if (r instanceof Error) throw r;
      return { status: r.status, json: async () => r.json ?? {} };
    }),
  );
  return chamadas;
}

/** Monta o `<body>` da página e executa o script inline. Polling desligado (sem `setInterval`). */
export function abrirPagina(html: string): void {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  const corpo = /<body>([\s\S]*?)<\/body>/.exec(html)?.[1];
  if (script === undefined || corpo === undefined) throw new Error("HTML da página sem <script> ou sem <body>");
  vi.stubGlobal("setInterval", () => 0);
  try {
    localStorage.clear();
  } catch {
    /* jsdom sem storage */
  }
  document.body.innerHTML = corpo;
  new Function(script)();
}

/** Aguarda o formulário de mensagem ficar visível (a página leu `identified: true`). */
export async function aguardarIdentificado(): Promise<void> {
  await vi.waitFor(() => {
    const form = document.querySelector<HTMLFormElement>("[data-form-msg]");
    if (form === null || form.hidden) throw new Error("formulário de mensagem ainda oculto");
  });
}

/** Escreve e envia uma mensagem como o visitante faria. */
export function enviarMensagem(texto: string): void {
  const campo = document.querySelector<HTMLTextAreaElement>("[data-corpo]");
  const form = document.querySelector<HTMLFormElement>("[data-form-msg]");
  if (campo === null || form === null) throw new Error("formulário de mensagem ausente");
  campo.value = texto;
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

export function avisos(nome: string): string[] {
  return Array.from(document.querySelectorAll(`[data-aviso="${nome}"]`)).map((el) => el.textContent ?? "");
}
