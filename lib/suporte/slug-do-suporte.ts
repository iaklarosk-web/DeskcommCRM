/**
 * `slugDoSuporte` — só um slug de organização válido liga o chat de suporte
 * embutido em `/app` (F24-T03, ADR-050). Vazio, indefinido ou lixo = desligado.
 *
 * Mora AQUI, num módulo sem `"use client"`, porque quem a chama é o layout de
 * `/app` (servidor). Ela nasceu dentro de `SuporteEmbutido.tsx` (cliente) e o
 * `next start` recusou na hora: "Attempted to call slugDoSuporte() from the
 * server but slugDoSuporte is on the client" — TODA render de `/app` caía, o
 * f24-gate-02 reprovou 94/96 no navegador, e `next dev` e o jsdom não tinham
 * acusado nada. Função pura chamada pelos dois lados fica num módulo neutro.
 */
const SLUG_VALIDO = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function slugDoSuporte(bruto: string | null | undefined): string | null {
  const slug = (bruto ?? "").trim();
  return SLUG_VALIDO.test(slug) ? slug : null;
}
