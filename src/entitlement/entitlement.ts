/**
 * entitlement / recordUsage / withEntitlement (§5.3, D14).
 *
 * Fase 1: todo tenant pode tudo — {allowed: true, remaining: null,
 * reason: "phase1_unlimited"} para as 6 capabilities. O módulo existe MESMO
 * ASSIM para que a pergunta tenha um dono: a Fase 2 troca o resolver por
 * planos (PLAN_A/B/C) sem mudar nenhuma assinatura. Esconde planos, flags,
 * limites e saldo — `grep -rniE "plan|quota|credit|allowance" src/` fora
 * daqui = 0 (invariante 1).
 */
import { incrementCounter } from "@/src/obs/counters";
import type { ServicePool } from "@/src/tenant-context/db";
import { withTenant, type TenantCtx } from "@/src/tenant-context";

import { CAPABILITIES, type Capability, type EntitlementResposta } from "./capability";
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

interface Deps {
  pool?: ServicePool;
  /** Seam da Fase 2 (planos); os testes o usam para provar o caminho negado. */
  resolver?: (ctx: TenantCtx, capability: Capability) => EntitlementResposta;
}

function resolverFase1(): EntitlementResposta {
  return { allowed: true, remaining: null, reason: "phase1_unlimited" };
}

export function entitlement(
  ctx: TenantCtx,
  capability: Capability,
  deps: Deps = {},
): EntitlementResposta {
  if (!CAPABILITIES.includes(capability)) {
    throw new Error(`capability desconhecida: ${String(capability)}`);
  }
  return (deps.resolver ?? resolverFase1)(ctx, capability);
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
  const resposta = entitlement(ctx, capability, deps);
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
