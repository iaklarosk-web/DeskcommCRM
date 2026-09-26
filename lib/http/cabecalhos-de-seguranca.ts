/**
 * Os cabeçalhos de segurança que o `next.config.ts` emite — num módulo
 * próprio para que a suíte de unidade os meça com o casador de rotas do
 * próprio Next (`tests/unit/f24-t00-origem-publica-e-moldura.test.ts`).
 *
 * `X-Frame-Options: DENY` vale para o produto inteiro MENOS a página do chat
 * do site (`/chat/<slug>`) e o script de embed (`/embed/<slug>.js`), que
 * existem para viver dentro de um iframe no site do cliente (F14, ADR-038).
 * Quem decide QUAIS sites podem embutir a página é o
 * `Content-Security-Policy: frame-ancestors` que a própria rota emite por
 * organização (`webchat.allowed_origins`). Antes desta exclusão a página
 * saía com o DENY (duas vezes, medido em 25/09/2026) ao lado de
 * `frame-ancestors *`, e só embutia porque os navegadores modernos dão
 * precedência ao CSP — regra que um navegador antigo ou um proxy não honra.
 * `X-Frame-Options` não sabe dizer "estes sites"; o CSP sabe. Tirar o DENY
 * dessas duas rotas é o que faz a política declarada ser a política aplicada.
 *
 * O `(?!chat/|embed/)` é um lookahead do path-to-regexp que o Next usa nos
 * matchers; o teste valida a regra com `checkCustomRoutes`, o mesmo
 * validador do `next build`.
 */
export interface RegraDeCabecalhos {
  readonly source: string;
  readonly headers: readonly { readonly key: string; readonly value: string }[];
}

/** Todo caminho, exceto a página do chat e o script de embed. */
export const TUDO_MENOS_O_CHAT_EMBUTIDO = "/((?!chat/|embed/).*)";

export const CABECALHOS_DE_SEGURANCA: readonly RegraDeCabecalhos[] = [
  {
    source: "/notify-sw.js",
    headers: [
      { key: "Cache-Control", value: "no-cache" },
      { key: "Service-Worker-Allowed", value: "/" },
    ],
  },
  {
    source: "/(.*)",
    headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // microphone=(self): o gravador de voz do composer (PTT estilo WhatsApp)
      // usa getUserMedia({audio}); microphone=() bloquearia em TODA origem,
      // inclusive a própria — daria "microphone is not allowed in this document".
      // Câmera e geolocalização seguem bloqueadas (não usadas).
      // notifications=(self): bandeja do SO quando a janela está minimizada.
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(self), geolocation=(), notifications=(self)",
      },
    ],
  },
  {
    source: TUDO_MENOS_O_CHAT_EMBUTIDO,
    headers: [{ key: "X-Frame-Options", value: "DENY" }],
  },
];
