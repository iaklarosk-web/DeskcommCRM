/**
 * entitlement / recordUsage / withEntitlement (§5.3, D14).
 *
 * Fase 1 respondia sempre sim (`phase1_unlimited`). Desde a F12-T02 (ADR-030
 * §3) o resolver PADRÃO é o por plano (`./plano.ts`): lê a assinatura, o plano
 * e o uso do período e devolve `{allowed, remaining, reason}` com `reason`
 * enum. A ASSINATURA das funções não mudou — só passou a ser assíncrona, que
 * `withEntitlement` já era. O seam `deps.resolver` continua: os testes o usam
 * para provar o caminho negado sem banco (o dublê de saldo zero do `ai:eval`).
 * Esconde planos, flags, limites e saldo — `grep -rniE "plan|quota|credit|allowance"
 * src/` fora daqui e de `src/billing/` = 0 (invariante 1, ampliado em ADR-030).
 */
import { incrementCounter } from "@/src/obs/counters";
import type { ServicePool } from "@/src/tenant-context/db";
import { withTenant, type TenantCtx } from "@/src/tenant-context";

import { CAPABILITIES, type Capability, type EntitlementResposta } from "./capability";
import { resolverComLimiteDiario } from "@/src/ai/limite";

import { resolverPorPlano } from "./plano";
import { estimatedCostCents } from "./pricing";

export class EntitlementDenied extends Error {
  constructor(
    public readonly capability: Capability,
    public readonly reason: string,
  ) {
    super(`capability ${capability} negada: ${reason}`);
    this.name = "EntitlementDenied";
  }
}

/**
 * F15-T02 (ADR-036): o resolver padrão é o plano (F12) e, para `ai.reply`, o
 * limite diário da organização por cima. Quem injeta `resolver` (o dublê de
 * D36, `provider_calls_at_zero_balance`) continua mandando.
 */
let resolverPadraoCache: Resolver | null = null;
const resolverPadrao: Resolver = (ctx, capability, deps) => {
  resolverPadraoCache ??= resolverComLimiteDiario(resolverPorPlano);
  return resolverPadraoCache(ctx, capability, deps);
};

export type Resolver = (
  ctx: TenantCtx,
  capability: Capability,
  deps: { pool?: ServicePool },
) => EntitlementResposta | Promise<EntitlementResposta>;

interface Deps {
  pool?: ServicePool;
  /** Seam de resolver; os testes o usam para provar o caminho negado sem banco. */
  resolver?: Resolver;
}

export async function entitlement(
  ctx: TenantCtx,
  capability: Capability,
  deps: Deps = {},
): Promise<EntitlementResposta> {
  if (!CAPABILITIES.includes(capability)) {
    throw new Error(`capability desconhecida: ${String(capability)}`);
  }
  return (deps.resolver ?? resolverPadrao)(ctx, capability, { pool: deps.pool });
}

export interface Usage {
  conversation_id?: string | null;
  model: string;
  operation: "chat" | "embedding" | "summary";
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms?: number | null;
  provider_request_id?: string | null;
}

export async function recordUsage(ctx: TenantCtx, usage: Usage, deps: Deps = {}): Promise<void> {
  await withTenant(
    ctx,
    async (db) => {
      await db.query(
        `insert into public.ai_usage_events
           (organization_id, conversation_id, model, operation,
            prompt_tokens, completion_tokens, estimated_cost_cents,
            latency_ms, provider_request_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          ctx.organization_id,
          usage.conversation_id ?? null,
          usage.model,
          usage.operation,
          usage.prompt_tokens,
          usage.completion_tokens,
          estimatedCostCents(usage.model, usage.prompt_tokens, usage.completion_tokens),
          usage.latency_ms ?? null,
          usage.provider_request_id ?? null,
        ],
      );
    },
    deps,
  );
}

/**
 * O único caminho para exercer uma capability que chama provedor (§5.3
 * invariante 3): entitlement() ANTES — negado lança EntitlementDenied sem
 * tocar o provedor —, fn no meio, recordUsage() DEPOIS para cada uso que o fn
 * devolver. A F04 instancia o cliente de IA exclusivamente aqui dentro.
 */
export async function withEntitlement<T>(
  ctx: TenantCtx,
  capability: Capability,
  fn: () => Promise<{ result: T; usage?: Usage | Usage[] }>,
  deps: Deps = {},
): Promise<T> {
  const resposta = await entitlement(ctx, capability, deps);
  if (!resposta.allowed) {
    incrementCounter("entitlement_denied", { capability });
    throw new EntitlementDenied(capability, resposta.reason);
  }
  const { result, usage } = await fn();
  const usos = usage === undefined ? [] : Array.isArray(usage) ? usage : [usage];
  for (const u of usos) {
    await recordUsage(ctx, u, deps);
  }
  return result;
}
