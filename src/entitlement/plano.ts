/**
 * O RESOLVER POR PLANO (§5.3 "Fase 2 troca o resolver por seeds PLAN_A/B/C";
 * D14; F12-T02, ADR-030 §3). Responde "este tenant pode exercer esta
 * Capability agora, e quanto resta?" lendo a assinatura, o plano e o uso.
 *
 * Duas portas, nesta ordem:
 *   1. o ESTADO da assinatura (`src/billing/acesso.ts`): `billing_only` e
 *      `read_only` negam toda capability com `reason` do estado — IA, envio,
 *      convite e ingestão são "novas operações" (D44);
 *   2. o LIMITE do plano para a capability, quando o plano o declara:
 *      `remaining = limite − uso do período`; zero nega com `limit_reached`.
 *
 * Organização sem assinatura → `legacy_without_subscription`, permitido, sem
 * limite (ADR-030 §3). `reason` é enum (G-78): é o que o caller loga e conta.
 */
import { acessoDe, type MotivoDoAcesso } from "@/src/billing/acesso";
import { obterPlano, PlanoDesconhecido } from "@/src/billing/planos";
import { mesCivil, usoDaCapabilityEm } from "@/src/billing/uso";
import type { ServicePool } from "@/src/tenant-context/db";
import { withTenant, type TenantCtx } from "@/src/tenant-context";

import type { Capability, EntitlementResposta } from "./capability";

export type MotivoDoEntitlement = MotivoDoAcesso | "limit_reached" | "plan_unknown";

interface Deps {
  pool?: ServicePool;
  agora?: () => Date;
}

export async function resolverPorPlano(
  ctx: TenantCtx,
  capability: Capability,
  deps: Deps = {},
): Promise<EntitlementResposta> {
  return withTenant(
    ctx,
    async (db) => {
      const { rows } = await db.query<{
        status: "pending_payment" | "active" | "past_due" | "blocked" | "cancelled";
        plan_code: string;
        grace_until: Date | string | null;
        current_period_start: Date | string | null;
        current_period_end: Date | string | null;
      }>(
        `select status, plan_code, grace_until, current_period_start, current_period_end
           from public.subscriptions where organization_id = $1`,
        [ctx.organization_id],
      );
      const linha = rows[0];
      if (!linha) {
        return { allowed: true, remaining: null, reason: "legacy_without_subscription" satisfies MotivoDoEntitlement };
      }
      const acesso = acessoDe({
        status: linha.status,
        plan_code: linha.plan_code,
        grace_until: linha.grace_until === null ? null : String(linha.grace_until),
      });
      if (acesso.mode !== "full") {
        return { allowed: false, remaining: 0, reason: acesso.reason };
      }
      let limite: number | null;
      try {
        const plano = await obterPlano(linha.plan_code, { pool: deps.pool });
        limite = plano.limits[capability] ?? null;
      } catch (erro) {
        if (erro instanceof PlanoDesconhecido) {
          return { allowed: false, remaining: 0, reason: "plan_unknown" satisfies MotivoDoEntitlement };
        }
        throw erro;
      }
      if (limite === null) return { allowed: true, remaining: null, reason: "ok" satisfies MotivoDoEntitlement };
      const agora = (deps.agora ?? (() => new Date()))();
      const periodo =
        linha.current_period_start !== null && linha.current_period_end !== null
          ? { desde: new Date(linha.current_period_start).toISOString(), ate: new Date(linha.current_period_end).toISOString() }
          : mesCivil(agora);
      const uso = await usoDaCapabilityEm(db, ctx, capability, periodo, limite);
      const remaining = uso.remaining ?? 0;
      return remaining > 0
        ? { allowed: true, remaining, reason: "ok" satisfies MotivoDoEntitlement }
        : { allowed: false, remaining: 0, reason: "limit_reached" satisfies MotivoDoEntitlement };
    },
    deps,
  );
}
