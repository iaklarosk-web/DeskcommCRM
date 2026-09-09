import {
  papelD15DoHerdado,
  requirePermission,
  type Permissao,
  type PapelD15,
} from "@/src/rbac/matrix";
import type { TenantCtx, TenantDb } from "@/src/tenant-context";

export type OrderPermission = Extract<Permissao, "orders.write" | "orders.confirm">;
export type TrustedOrderExecutor =
  | { type: "human"; user_id: string }
  | { type: "ai_agent"; agent_id: string }
  | { type: "automation"; run_id: string };

export class OrderAuthorizationError extends Error {
  public readonly status = 403;
  constructor(public readonly code: string) {
    super(code);
    this.name = "OrderAuthorizationError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AuthorizationRow = { role: string; organization_active: boolean; is_platform_admin: boolean };

/**
 * Autoriza comandos de pedido dentro da transação tenant-bound, antes do replay.
 * O executor é recebido do caminho autenticado do serviço, nunca do corpo.
 */
export async function authorizeOrderCommand(
  db: TenantDb,
  ctx: TenantCtx | null | undefined,
  executor: TrustedOrderExecutor,
  permission: OrderPermission,
): Promise<{ papel: PapelD15 }> {
  if (
    ctx?.source !== "session" ||
    !ctx.user_id ||
    !UUID.test(ctx.organization_id) ||
    !UUID.test(ctx.user_id)
  ) {
    throw new OrderAuthorizationError("session_context_required");
  }
  if (executor.type !== "human") throw new OrderAuthorizationError("non_human_executor_denied");
  if (!UUID.test(executor.user_id) || executor.user_id !== ctx.user_id) {
    throw new OrderAuthorizationError("executor_identity_mismatch");
  }

  const result = await db.query<AuthorizationRow>(
    `select uo.role,
            (o.status = 'active') as organization_active,
            exists (
              select 1 from public.platform_admins pa
              where pa.user_id = uo.user_id and pa.revoked_at is null
            ) as is_platform_admin
       from public.user_organizations uo
       join public.organizations o on o.id = uo.organization_id
      where uo.organization_id = $1
        and uo.user_id = $2
        and uo.accepted_at is not null
        and uo.revoked_at is null
      limit 1
       for share of uo, o`,
    [ctx.organization_id, ctx.user_id],
  );
  const row = result.rows[0];
  if (!row || !row.organization_active || row.is_platform_admin) {
    throw new OrderAuthorizationError("order_command_forbidden");
  }

  const papel = papelD15DoHerdado(row.role, false);
  if (papel === null) throw new OrderAuthorizationError("order_command_forbidden");
  try {
    requirePermission(papel, permission);
  } catch {
    throw new OrderAuthorizationError("order_command_forbidden");
  }
  return { papel };
}
