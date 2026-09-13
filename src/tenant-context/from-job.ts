/**
 * fromJob — TenantCtx a partir de payload de job/worker (§5.1).
 *
 * Job sem organization_id não é "processa sem filtro" nem "loga e segue": é
 * rejeição contada (tenant_ctx_rejected{source=job}) + erro. O consumo e a
 * inserção (enqueue, F03-T08) usam este mesmo validador — invariante 2 de §5.1.
 */
import { incrementCounter } from "@/src/obs/counters";

import { TenantResolutionError, type TenantCtx } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function fromJob(payload: Record<string, unknown>): TenantCtx {
  const bruto = payload?.["organization_id"];
  if (typeof bruto !== "string" || !UUID_RE.test(bruto)) {
    incrementCounter("tenant_ctx_rejected", { source: "job" });
    throw new TenantResolutionError("job", "missing_organization_id");
  }
  return { organization_id: bruto, source: "job" };
}
