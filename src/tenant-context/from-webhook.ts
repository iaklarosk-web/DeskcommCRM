/**
 * fromWebhook — TenantCtx a partir de (provider, account_key) (§5.1).
 *
 * O tenant vem de channel_accounts, NUNCA do payload — o payload é exatamente
 * a parte que o remetente controla. Sem match: 1 linha em webhook_quarantine
 * (com o payload, para investigação), contador, erro. A rota que chamar
 * responde 202 no catch (invariante 3 de §5.1: 0 linhas em messages) — F03.
 */
import { incrementCounter } from "@/src/obs/counters";

import { getServicePool, type ServicePool } from "./db";
import { TenantResolutionError, type TenantCtx } from "./types";

interface FromWebhookDeps {
  pool?: ServicePool;
}

export async function fromWebhook(
  provider: string,
  accountKey: string,
  payload?: unknown,
  deps: FromWebhookDeps = {},
): Promise<TenantCtx> {
  const pool = deps.pool ?? (await getServicePool());

  const conta = await pool.query<{ organization_id: string }>(
    `select organization_id from public.channel_accounts
      where provider = $1 and account_key = $2 and status = 'active'`,
    [provider, accountKey],
  );

  const organizationId = conta.rows[0]?.organization_id;
  if (!organizationId) {
    await pool.query(
      `insert into public.webhook_quarantine (provider, account_key, payload, reason)
       values ($1, $2, $3, $4)`,
      [provider, accountKey, payload === undefined ? null : JSON.stringify(payload), "unknown_account"],
    );
    incrementCounter("tenant_ctx_rejected", { source: "webhook", reason: "unknown_account" });
    throw new TenantResolutionError("webhook", "unknown_account");
  }

  return { organization_id: organizationId, source: "webhook" };
}
