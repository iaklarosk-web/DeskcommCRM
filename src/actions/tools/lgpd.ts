/**
 * F06-T03 — as duas Actions `high` da LGPD mínima (§5.18, §7.7).
 *
 * Quem pode: só o `tenant_admin` (papel `admin` do tenant, ADR-003), com
 * sessão. O catálogo já barra IA e automação pelo executor; aqui se confere o
 * PAPEL, contra `user_organizations` — o mesmo lugar que `fn_user_role_in_org`
 * lê. Papel insuficiente é recusa contada (`domain_rejected`), nunca exceção.
 *
 * A auditoria não é feita aqui: `execute()` grava `audit_events` para todo
 * desfecho (`executed`/`denied`), com `resource_type=contacts` e o id do
 * contato como `resource_id` — e é essa linha que sobrevive à exclusão.
 */
import { apagarCliente, exportarCliente } from "@/src/lgpd";
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";

import { customerDataInputSchema } from "../schemas";
import { bind, exigirUsuario, type ToolCtx, type ToolOutcome, type ToolRunner } from "./contrato";

async function papelNoTenant(db: TenantDb, ctx: TenantCtx, userId: string): Promise<string | null> {
  const r = await db.query<{ role: string }>(
    `select role from public.user_organizations
      where organization_id = $1 and user_id = $2 and accepted_at is not null and revoked_at is null
      limit 1`,
    [ctx.organization_id, userId],
  );
  return r.rows[0]?.role ?? null;
}

async function comoTenantAdmin(
  tool: ToolCtx,
  contactId: string,
  fn: (db: TenantDb) => Promise<Record<string, unknown>>,
): Promise<ToolOutcome> {
  const userId = exigirUsuario(tool.actor);
  if (userId === null) return { ok: false, reason: "actor_without_user", resourceId: contactId };
  return withTenant(
    tool.ctx,
    async (db) => {
      const papel = await papelNoTenant(db, tool.ctx, userId);
      if (papel !== "admin") {
        return { ok: false, reason: "domain_rejected", resourceId: contactId, detalhe: `role_insufficient:${papel ?? "none"}` } as ToolOutcome;
      }
      const existe = await db.query(
        `select 1 from public.contacts where id = $1 and organization_id = $2`,
        [contactId, tool.ctx.organization_id],
      );
      if (existe.rowCount === 0) {
        return { ok: false, reason: "domain_rejected", resourceId: contactId, detalhe: "contact_not_found" } as ToolOutcome;
      }
      return { ok: true, output: await fn(db), resourceId: contactId } as ToolOutcome;
    },
    { pool: tool.deps.pool },
  );
}

export const exportCustomerData: ToolRunner = bind(customerDataInputSchema, async (tool, input) =>
  comoTenantAdmin(tool, input.contact_id, async (db) => ({
    ...(await exportarCliente(db, tool.ctx.organization_id, input.contact_id)),
  })),
);

export const deleteCustomerData: ToolRunner = bind(customerDataInputSchema, async (tool, input) =>
  comoTenantAdmin(tool, input.contact_id, async (db) => ({
    ...(await apagarCliente(db, tool.ctx.organization_id, input.contact_id)),
  })),
);
