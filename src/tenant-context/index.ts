/**
 * TenantContext (§5.1, D20) — único módulo que toca a service-role do banco.
 * Fontes de tenant entram aqui e em nenhum outro lugar.
 */
export { fromSession } from "./from-session";
export { withTenant, type TenantDb } from "./with-tenant";
export { TenantResolutionError, type TenantCtx, type TenantSource } from "./types";
