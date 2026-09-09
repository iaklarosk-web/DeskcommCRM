import type { TenantCtx, TenantDb } from "@/src/tenant-context";

import {
  authorizeCrmCommand,
  CrmAuthorizationError,
  type TrustedCrmExecutor,
} from "../authorization";

export { CrmAuthorizationError as OrderAuthorizationError };
export type TrustedOrderExecutor = TrustedCrmExecutor;
export type OrderPermission = "orders.write" | "orders.confirm";

export function authorizeOrderCommand(
  db: TenantDb,
  ctx: TenantCtx | null | undefined,
  executor: TrustedOrderExecutor,
  permission: OrderPermission,
): ReturnType<typeof authorizeCrmCommand> {
  return authorizeCrmCommand(db, ctx, executor, permission, {
    forbiddenCode: "order_command_forbidden",
  });
}
