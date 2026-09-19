/**
 * Paths that bypass auth check in middleware.
 * Match precedence: array order. First match wins.
 */
export const PUBLIC_PATHS: RegExp[] = [
  /^\/$/,
  /^\/login(\/.*)?$/,
  /^\/signup$/,
  /^\/auth\/confirm$/,
  /^\/403$/,
  /^\/admin\/forbidden$/,
  /^\/404$/,
  /^\/500$/,
  /^\/503$/,
  /^\/api\/v1\/health$/,
  /^\/api\/v1\/webhooks\//,
  // (O webhook do gateway de cobrança, F12-T03, mora em /api/v1/webhooks/billing-mock
  // e entra pela linha acima: a autoridade é a assinatura HMAC conferida
  // DENTRO da rota, `src/billing/webhook-mock.ts`.)
  /^\/api\/v1\/cron\//,
  // F19 (ADR-042 §5): o cockpit da KN, `Authorization: Bearer ADMIN_SUMMARY_TOKEN`
  // conferido DENTRO da rota, em tempo constante — sem cookie, como /cron/.
  /^\/api\/admin\/summary$/,
  // Heartbeat do agente do host (bearer INTERNAL_SECRET/INTERNAL_CRON_SECRET,
  // checado dentro da própria rota) — sem cookie de sessão, igual /cron/.
  /^\/api\/v1\/system\/agent$/,
  // Relógio Hobby (GitHub Actions / cron-job.org). Auth é Bearer na própria
  // rota — sem isto o proxy devolve 401 e o follow-up waiting_reply nunca anda.
  /^\/api\/v1\/system\/relogio\/tick$/,
  // VOLTAS DE CONSENTIMENTO OAuth. O provedor devolve o NAVEGADOR para cá, e
  // essa navegação vem de outro site — o cookie de sessão é `sameSite: "strict"`
  // e, por definição, não viaja nela. Sem estas duas linhas o `proxy` responde
  // 401 antes de a rota existir, e o fluxo NUNCA completa: medido na v1.8.0, em
  // produção, `GET /api/v1/agenda/google/callback` → 401 `unauthenticated`.
  //
  // A identidade não vem da sessão e sim do `state` assinado (HMAC de
  // `INTERNAL_SECRET`), com nonce de uso único; no caso do Google, somado a um
  // cookie de vínculo `SameSite=Lax` (`lib/agenda/google/vinculo.ts`) que prova
  // que o navegador que volta é o que saiu. Mesma natureza de
  // `/api/v1/system/relogio/tick`, logo acima: a auth mora DENTRO da rota.
  //
  // Ancorados com `$` de propósito — `/^\/api\/v1\/agenda\/google\// deixaria
  // qualquer sub-path futuro nascer público de carona.
  /^\/api\/v1\/agenda\/google\/callback$/,
  /^\/api\/v1\/integrations\/nuvemshop\/callback$/,
  // CHAT DO SITE (F14, ADR-038): o visitante não tem cookie de sessão. A
  // autoridade é o token da sessão do visitante, conferido DENTRO das rotas
  // (`app/api/public/webchat/[slug]/_comum.ts`); a página e o script de embed
  // são públicos por natureza — vivem no site do cliente. Ancorados: um
  // sub-path novo de /chat ou /embed não nasce público de carona.
  /^\/api\/public\/webchat\/[a-z0-9-]+\/(session|identify|messages)$/,
  /^\/chat\/[a-z0-9-]+$/,
  /^\/embed\/[a-z0-9-]+\.js$/,
  /^\/api\/internal\//,
  /^\/api\/mcp(\/.*)?$/,
  /^\/_next\//,
  /^\/favicon\.ico$/,
  // O ícone da aba (`app/icon.tsx`), que o `<head>` de TODA página pede —
  // inclusive o do `/login`, antes de existir sessão. Precisa de entrada
  // própria porque o matcher do `proxy.ts:128` só dispensa caminho COM
  // extensão: `/favicon.ico` passa por ele, `/icon` não. Medido em produção
  // antes desta linha: `GET /icon` → 307 para `/login?next=%2Ficon`, enquanto
  // `/icon.png` (inexistente) devolvia 404 — a diferença é só a extensão.
  /^\/icon$/,
  /^\/manifest\.webmanifest$/,
  /^\/team\/accept-invite\/.+$/,
  /^\/account-suspended$/,
  // Documentos legais. O checkbox obrigatório de `/onboarding/welcome` linka os
  // dois, e o aceite acontece antes de a pessoa ter qualquer coisa no sistema —
  // exigir sessão para LER o que se está aceitando inverte a ordem. Âncorado nos
  // dois nomes de propósito: `/^\/legal/` deixaria qualquer sub-path futuro
  // nascer público de carona.
  /^\/legal\/(terms|privacy)$/,
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((re) => re.test(pathname));
}
