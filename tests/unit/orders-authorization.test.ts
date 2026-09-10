import { describe, expect, it } from "vitest";

import {
  OrderAuthorizationError,
  authorizeOrderCommand,
  type TrustedOrderExecutor,
} from "@/src/crm/orders/authorization";
import type { TenantCtx } from "@/src/tenant-context";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function ctx(overrides: Partial<TenantCtx> = {}): TenantCtx {
  return { organization_id: ORG, user_id: USER, source: "session", ...overrides };
}
function human(): TrustedOrderExecutor {
  return { type: "human", user_id: USER };
}
function db(
  row: Record<string, unknown> | null = {
    role: "agent",
    organization_active: true,
    is_platform_admin: false,
  },
) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  return {
    calls,
    db: {
      query: async (sql: string, values: unknown[]) => {
        calls.push({ sql, values });
        return { rows: row ? [row] : [] };
      },
    },
  };
}

describe("authorizeOrderCommand", () => {
  it("consulta membership vigente e organização ativa dentro do TenantDb antes de autorizar", async () => {
    const fake = db();
    await expect(
      authorizeOrderCommand(fake.db as never, ctx(), human(), "orders.confirm"),
    ).resolves.toEqual({ papel: "attendant" });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.values).toEqual([ORG, USER]);
    expect(fake.calls[0]?.sql).toContain("uo.accepted_at is not null");
    expect(fake.calls[0]?.sql).toContain("uo.revoked_at is null");
    expect(fake.calls[0]?.sql).toContain("public.platform_admins");
    expect(fake.calls[0]?.sql).toContain("for share of uo, o");
  });

  it.each([
    ["viewer", { role: "viewer", organization_active: true, is_platform_admin: false }],
    ["convite pendente", null],
    ["revogado", null],
    [
      "organização inativa",
      { role: "agent", organization_active: false, is_platform_admin: false },
    ],
    ["platform admin ativo", { role: "admin", organization_active: true, is_platform_admin: true }],
  ])("nega %s", async (_name, row) => {
    const fake = db(row);
    await expect(
      authorizeOrderCommand(fake.db as never, ctx(), human(), "orders.write"),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("nega IA, automação, sessão ausente e executor diferente antes de consultar", async () => {
    for (const [context, executor] of [
      [ctx(), { type: "ai_agent", agent_id: "a" }],
      [ctx(), { type: "automation", run_id: "r" }],
      [undefined, human()],
      [ctx({ organization_id: "not-a-uuid" }), human()],
      [ctx(), { type: "human", user_id: ORG }],
    ] as const) {
      const fake = db();
      await expect(
        authorizeOrderCommand(fake.db as never, context, executor, "orders.write"),
      ).rejects.toBeInstanceOf(OrderAuthorizationError);
      expect(fake.calls).toHaveLength(0);
    }
  });
});
