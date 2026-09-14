/**
 * O ACESSO OPERACIONAL que a assinatura permite (ADR-030 §3 "Acesso"; D38,
 * D44). Um leitor só, para três consumidores: o layout de `/app/*` (redireciona
 * para a cobrança), o guarda de rota `requireRole` (nega escrita) e o
 * entitlement (nega capability). Se os três lessem estados diferentes, D38 e
 * D44 teriam três versões.
 *
 * Organização SEM assinatura → `full` com `reason=legacy_without_subscription`:
 * é a regra para as organizações herdadas das suítes (ADR-030 §3 explica por
 * quê e por que D38 não depende dela). O smoke do staging mede quantas existem.
 */
import type { ServicePool } from "@/src/tenant-context/db";
import { getServicePool } from "@/src/tenant-context/db";

import { MODO_POR_ESTADO, type EstadoDaAssinatura, type ModoDeAcesso } from "./estados";

export type MotivoDoAcesso =
  | "ok"
  | "legacy_without_subscription"
  | "subscription_pending_payment"
  | "subscription_past_due"
  | "subscription_blocked"
  | "subscription_cancelled";

export interface EstadoDeAcesso {
  readonly mode: ModoDeAcesso;
  readonly status: EstadoDaAssinatura | null;
  readonly reason: MotivoDoAcesso;
  readonly plan_code: string | null;
  readonly grace_until: string | null;
}

interface Deps {
  pool?: ServicePool;
}

export function motivoDe(status: EstadoDaAssinatura | null): MotivoDoAcesso {
  switch (status) {
    case null:
      return "legacy_without_subscription";
    case "active":
      return "ok";
    case "pending_payment":
      return "subscription_pending_payment";
    case "past_due":
      return "subscription_past_due";
    case "blocked":
      return "subscription_blocked";
    case "cancelled":
      return "subscription_cancelled";
  }
}

/** Estado → acesso, sem banco: é o que os testes de unidade exercitam. */
export function acessoDe(
  linha: { status: EstadoDaAssinatura; plan_code: string; grace_until: string | null } | null,
): EstadoDeAcesso {
  if (linha === null) {
    return { mode: "full", status: null, reason: "legacy_without_subscription", plan_code: null, grace_until: null };
  }
  return {
    mode: MODO_POR_ESTADO[linha.status],
    status: linha.status,
    reason: motivoDe(linha.status),
    plan_code: linha.plan_code,
    grace_until: linha.grace_until,
  };
}

/**
 * Lê a assinatura da organização com o pool de serviço (uma consulta, sem
 * transação: leitura pura, fora do `withTenant` porque o layout e o guarda
 * rodam por requisição e não têm transação a abrir).
 */
export async function estadoDeAcesso(organizationId: string, deps: Deps = {}): Promise<EstadoDeAcesso> {
  const pool = deps.pool ?? (await getServicePool());
  const { rows } = await pool.query<{ status: EstadoDaAssinatura; plan_code: string; grace_until: Date | string | null }>(
    `select status, plan_code, grace_until from public.subscriptions where organization_id = $1`,
    [organizationId],
  );
  const linha = rows[0];
  if (!linha) return acessoDe(null);
  const grace = linha.grace_until instanceof Date ? linha.grace_until.toISOString() : linha.grace_until;
  return acessoDe({ status: linha.status, plan_code: linha.plan_code, grace_until: grace ?? null });
}

const METODOS_DE_LEITURA = new Set(["GET", "HEAD", "OPTIONS"]);
/** Rotas que continuam abertas em qualquer modo: a pessoa precisa pagar e sair. */
const PREFIXOS_SEMPRE_ABERTOS = ["/api/v1/billing/", "/api/v1/auth/"];

/**
 * A regra de D44 numa função: `read_only` e `billing_only` negam método que
 * escreve fora de `/api/v1/billing/*` e `/api/v1/auth/*`; `billing_only` nega
 * também a LEITURA fora desses prefixos (assinatura pendente/cancelada não
 * opera). Sem caminho (teste de unidade que chama o guarda direto) a regra é a
 * do método.
 */
export function escritaPermitida(acesso: Pick<EstadoDeAcesso, "mode">, metodo: string | null, caminho: string | null): boolean {
  if (acesso.mode === "full") return true;
  const aberto = caminho !== null && PREFIXOS_SEMPRE_ABERTOS.some((p) => caminho.startsWith(p));
  if (aberto) return true;
  const leitura = METODOS_DE_LEITURA.has((metodo ?? "GET").toUpperCase());
  if (acesso.mode === "read_only") return leitura;
  return false;
}
