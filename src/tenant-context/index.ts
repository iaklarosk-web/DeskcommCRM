/**
 * TenantContext (§5.1, D20) — único módulo que toca a service-role do banco.
 * Fontes de tenant entram aqui e em nenhum outro lugar.
 */
export { forEachEligibleTenant, type TenantRunResult } from "./for-each-eligible-tenant";
export { fromJob } from "./from-job";
export { fromSession } from "./from-session";
export { fromWebhook } from "./from-webhook";
export { TenantResolutionError, type TenantCtx, type TenantSource } from "./types";
export { withTenant, type TenantDb } from "./with-tenant";
