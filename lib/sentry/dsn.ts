/**
 * DSN do Sentry com opt-IN em runtime — F11-T00 (VARREDURA §B11, D51 d).
 *
 * Antes, SEM `SENTRY_DSN` os erros iam para o Sentry do autor do Deskcomm
 * (DEFAULT_SENTRY_DSN, "telemetria de comunidade"). Num SaaS com dados de
 * tenant, uma instalação que esquecesse a chave exportava erro para uma conta
 * que não é do proprietário (o scrub de PII é denylist). O padrão inverteu:
 * sem DSN, NADA é enviado; a comunidade continua disponível, mas só por
 * escolha explícita. Quem hospeda controla pelo `.env`, SEM rebuild da imagem:
 *
 *   SENTRY_DSN=  (vazio)     → telemetria DESLIGADA (padrão)
 *   SENTRY_DSN=off           → desligada, explicitamente
 *   SENTRY_DSN=<seu-dsn>     → manda os erros pro SEU Sentry
 *   SENTRY_DSN=community     → opt-in no Sentry da comunidade (só erro; ver abaixo)
 *
 * Vale para servidor (process.env) e navegador (window.__PUBLIC_ENV__.SENTRY_DSN,
 * injetado em runtime pelo <PublicEnvScript/>). O DSN não é segredo — DSNs do Sentry
 * são públicos por design.
 */
export const DEFAULT_SENTRY_DSN =
  "https://58fabf8ad54504863d404a3647ef3714@o4509908078559232.ingest.us.sentry.io/4509908083212288";

/** O valor que liga a comunidade de propósito. */
export const COMMUNITY_SENTRY_OPT_IN = "community";

export function resolveSentryDsn(value: string | undefined | null): string | undefined {
  const bruto = (value ?? "").trim();
  const v = bruto.toLowerCase();
  if (v === "" || v === "off" || v === "false" || v === "0") return undefined;
  if (v === COMMUNITY_SENTRY_OPT_IN) return DEFAULT_SENTRY_DSN;
  return bruto;
}

/**
 * Estamos mandando para o Sentry da COMUNIDADE (o nosso), e não para o do operador?
 *
 * Isso decide a amostragem (issue #100). No DSN da comunidade só vai ERRO:
 * `tracesSampleRate` e `replaysSessionSampleRate` vão a 0. O que ajuda a corrigir
 * "bug que afeta todo mundo" é o stack trace — não 100% das transações nem 10% das
 * sessões de um CRM que não é nosso. Quem aponta para o próprio Sentry recebe tudo,
 * porque aí o dado não sai da infraestrutura de quem é dono dele.
 */
export function isCommunityDsn(dsn: string | undefined): boolean {
  return dsn === DEFAULT_SENTRY_DSN;
}

/** Integração default do SDK que emite as sessões de release health do browser. */
export const INTEGRACAO_DE_SESSAO = "BrowserSession";

/**
 * Quais integrações do browser valem para o DSN em uso.
 *
 * A política de `isCommunityDsn` estava DECLARADA e não estava em vigor. As duas
 * amostragens foram a zero (`tracesSampleRate`, `replaysSessionSampleRate`) e o
 * fluxo de SESSÃO ficou de fora da conta: `browserSessionIntegration` entra por
 * default no `@sentry/browser` e o `lifecycle` dela é `"route"`, então cada troca
 * de rota fecha uma sessão e abre outra — duas por navegação, `errors: 0`.
 *
 * Sessão não é stack trace: ela não explica bug de ninguém, e é exatamente o que o
 * comentário do `isCommunityDsn` diz não querer ("não 100% das transações nem 10%
 * das sessões de um CRM que não é nosso"). O custo era invisível porque o dado ia
 * embora sozinho.
 *
 * Medido em 2026-08-10 sobre `dc2f9f96`, um percurso de 7 telas: 17 respostas do
 * ingest, TODAS `429`, com `x-sentry-rate-limits: 60::organization:suspended` —
 * lista de categorias vazia, isto é, todas as categorias. A organização estava
 * suspensa por cota, então nem o erro real de instalação real entrava; e cada
 * tentativa barrada virava erro de console no browser de quem hospeda.
 *
 * Quem aponta para o PRÓPRIO Sentry continua recebendo tudo, sessão inclusive: lá
 * o dado não sai da infraestrutura de quem é dono dele, e release health é
 * legítimo. A assimetria é a mesma das amostragens.
 */
export function integracoesDoCliente<T extends { name: string }>(
  padraoDoSdk: readonly T[],
  paraAComunidade: boolean,
): T[] {
  if (!paraAComunidade) return [...padraoDoSdk];
  return padraoDoSdk.filter((i) => i.name !== INTEGRACAO_DE_SESSAO);
}
