/**
 * forEachEligibleTenant — um job run por tenant elegível, em SÉRIE (§5.1).
 *
 * Em série de propósito: N tenants em paralelo sobre o mesmo pool é N
 * transações disputando conexão, e um tenant lento esconderia o erro de outro
 * no mesmo instante de log. Falha de um tenant NÃO derruba os seguintes — vira
 * linha no resultado, porque cron que para no 3º de 40 é pior que cron que
 * reporta 1 falha em 40.
 *
 * `listEligible` é obrigatório por enquanto: a fonte de verdade da
 * elegibilidade é o Setting do TenantConfiguration (F01-T05); quando ele
 * nascer, este módulo ganha o default canônico e o parâmetro vira opcional.
 * Um default inventado aqui viraria o schema que ninguém decidiu.
 */
import type { ServicePool } from "./db";
import type { TenantCtx } from "./types";

interface ForEachDeps {
  pool?: ServicePool;
  /** Fonte da elegibilidade (F01-T05 fornece a canônica via tenant_settings). */
  listEligible: (cronKey: string) => Promise<string[]>;
}

export interface TenantRunResult {
  organization_id: string;
  ok: boolean;
  error?: string;
}

export async function forEachEligibleTenant(
  cronKey: string,
  fn: (ctx: TenantCtx) => Promise<void>,
  deps: ForEachDeps,
): Promise<TenantRunResult[]> {
  const elegiveis = await deps.listEligible(cronKey);
  const resultados: TenantRunResult[] = [];

  for (const organizationId of elegiveis) {
    const ctx: TenantCtx = { organization_id: organizationId, source: "cron" };
    try {
      await fn(ctx);
      resultados.push({ organization_id: organizationId, ok: true });
    } catch (erro) {
      resultados.push({
        organization_id: organizationId,
        ok: false,
        error: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }

  return resultados;
}
