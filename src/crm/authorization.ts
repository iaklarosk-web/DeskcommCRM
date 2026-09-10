import {
  papelD15DoHerdado,
  requirePermission,
  type PapelD15,
  type Permissao,
} from "@/src/rbac/matrix";
import type { TenantCtx, TenantDb } from "@/src/tenant-context";

export type CrmCommandPermission = Extract<
  Permissao,
  "orders.write" | "orders.confirm" | "tasks.create" | "notes.create"
>;

export type TrustedCrmExecutor =
  | { type: "human"; user_id: string }
  | { type: "ai_agent"; agent_id: string }
  | { type: "automation"; run_id: string };

export class CrmAuthorizationError extends Error {
  public readonly status = 403;

  constructor(public readonly code: string) {
    super(code);
    this.name = "CrmAuthorizationError";
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AuthorizationRow = {
  role: string;
  organization_active: boolean;
  is_platform_admin: boolean;
};

/** Autoriza o executor confiável dentro do mesmo TenantDb que fará o efeito. */
export async function authorizeCrmCommand(
  db: TenantDb,
  ctx: TenantCtx | null | undefined,
  executor: TrustedCrmExecutor,
  permission: CrmCommandPermission,
  options: { forbiddenCode?: string } = {},
): Promise<{ papel: PapelD15 }> {
  if (
    ctx?.source !== "session" ||
    !ctx.user_id ||
    !UUID.test(ctx.organization_id) ||
    !UUID.test(ctx.user_id)
  ) {
    throw new CrmAuthorizationError("session_context_required");
  }
  if (executor.type !== "human") {
    throw new CrmAuthorizationError("non_human_executor_denied");
  }
  if (!UUID.test(executor.user_id) || executor.user_id !== ctx.user_id) {
    throw new CrmAuthorizationError("executor_identity_mismatch");
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
  const forbiddenCode = options.forbiddenCode ?? "crm_command_forbidden";
  if (!row || !row.organization_active || row.is_platform_admin) {
    throw new CrmAuthorizationError(forbiddenCode);
  }

  const papel = papelD15DoHerdado(row.role, false);
  if (papel === null) throw new CrmAuthorizationError(forbiddenCode);
  try {
    requirePermission(papel, permission);
  } catch {
    throw new CrmAuthorizationError(forbiddenCode);
  }
  return { papel };
}
