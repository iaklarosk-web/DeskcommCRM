/**
 * F06-T02 — rate limit do webhook SaaS (§5.18, §7.7).
 *
 * O login já tem o seu (`lib/auth/rate-limit.ts`, `AUTH_LIMITS.login`). O
 * webhook de canal do SaaS não tinha nenhum: um provedor comprometido — ou
 * qualquer um que descubra a URL — podia bater no `recebeEntrada` sem teto,
 * e cada chamada custa uma verificação HMAC e, se assinada, escrita no banco.
 *
 * O balde é por provedor E por IP de origem, ANTES de ler o corpo. O tenant
 * ainda não existe nesse ponto (ele vem de `channel_accounts`, dentro do
 * pipeline), então a chave não pode ser por organização — e nem deveria: o
 * teto protege a máquina, não a cota de um cliente.
 *
 * Reusa `checkRateLimit` herdado (Redis quando configurado, memória do
 * processo quando não — degrada em instalação de nó único, não escancara).
 * Janela FIXA: rajada na virada passa em dobro; é limite de abuso, não de
 * precisão — a mesma escolha documentada no limite de auth.
 */
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";

export interface LimiteDoWebhook {
  /** Requisições por janela, por (provedor, IP). */
  limit: number;
  windowSec: number;
}

const POR_MINUTO_PADRAO = 300;

/** `WEBHOOK_RATE_LIMIT_PER_MIN`: teto por minuto; inválido ou ausente cai no padrão. */
export function limiteDoWebhookDoAmbiente(): LimiteDoWebhook {
  const bruto = process.env.WEBHOOK_RATE_LIMIT_PER_MIN;
  const n = bruto === undefined ? Number.NaN : Number.parseInt(bruto, 10);
  return { limit: Number.isFinite(n) && n > 0 ? n : POR_MINUTO_PADRAO, windowSec: 60 };
}

/**
 * IP de origem, ou `null` quando não dá para saber — e aí NÃO há balde
 * compartilhado: "não sei de onde veio" não pode virar uma origem.
 */
export function ipDeOrigem(headers: Headers): string | null {
  const encaminhado = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (encaminhado) return encaminhado;
  const real = headers.get("x-real-ip")?.trim();
  return real || null;
}

export interface VeredictoDoLimite {
  allowed: boolean;
  /** Segundos até a janela virar — vai no `Retry-After`. */
  retryAfterSec: number;
  count: number;
  limit: number;
}

/** `allowed=false` = responda 429 e não leia o corpo. */
export async function limitarWebhook(
  provider: string,
  headers: Headers,
  limite: LimiteDoWebhook = limiteDoWebhookDoAmbiente(),
): Promise<VeredictoDoLimite> {
  const ip = ipDeOrigem(headers) ?? "sem-ip";
  const resultado = await checkRateLimit(`webhook:saas:${provider}:${ip}`, limite.limit, limite.windowSec);
  const restante = limite.windowSec - (Math.floor(Date.now() / 1000) % limite.windowSec);
  return { allowed: resultado.allowed, retryAfterSec: restante, count: resultado.count, limit: resultado.limit };
}
