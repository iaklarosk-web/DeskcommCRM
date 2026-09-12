// Destino previsto: tests/unit/crm-authorization.test.ts após a extração.
import { describe, expect, it } from "vitest";

import {
  authorizeCrmCommand,
  CrmAuthorizationError,
  type TrustedCrmExecutor,
} from "@/src/crm/authorization";
import { authorizeOrderCommand, OrderAuthorizationError } from "@/src/crm/orders/authorization";
import type { TenantCtx } from "@/src/tenant-context";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const ctx: TenantCtx = {
  organization_id: ORG,
  user_id: USER,
  source: "session",
};
const human: TrustedCrmExecutor = { type: "human", user_id: USER };

function fakeDb(
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

describe("authorizeCrmCommand", () => {
  it.each(["orders.write", "orders.confirm", "tasks.create", "notes.create"] as const)(
    "autoriza attendant para %s pelo mesmo gate canônico",
    async (permission) => {
      const fake = fakeDb();
      await expect(authorizeCrmCommand(fake.db as never, ctx, human, permission)).resolves.toEqual({
        papel: "attendant",
      });
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]?.sql).toContain("for share of uo, o");
      expect(fake.calls[0]?.values).toEqual([ORG, USER]);
    },
  );

  it.each([
    ["viewer", { role: "viewer", organization_active: true, is_platform_admin: false }],
    ["revogado ou ausente", null],
    [
      "organização inativa",
      { role: "agent", organization_active: false, is_platform_admin: false },
    ],
    ["platform admin", { role: "admin", organization_active: true, is_platform_admin: true }],
  ])("nega %s", async (_label, row) => {
    await expect(
      authorizeCrmCommand(fakeDb(row).db as never, ctx, human, "tasks.create"),
    ).rejects.toBeInstanceOf(CrmAuthorizationError);
  });

  it.each([
    [{ ...ctx, source: "job" }, human],
    [ctx, { type: "ai_agent", agent_id: "agent" }],
    [ctx, { type: "automation", run_id: "run" }],
    [ctx, { type: "human", user_id: ORG }],
  ] as const)(
    "nega contexto ou executor não humano antes da consulta",
    async (context, executor) => {
      const fake = fakeDb();
      await expect(
        authorizeCrmCommand(fake.db as never, context, executor, "notes.create"),
      ).rejects.toBeInstanceOf(CrmAuthorizationError);
      expect(fake.calls).toHaveLength(0);
    },
  );

  it("mantém o wrapper de pedidos e seu código de erro", async () => {
    const error = authorizeOrderCommand(fakeDb(null).db as never, ctx, human, "orders.write");
    await expect(error).rejects.toBeInstanceOf(OrderAuthorizationError);
    await expect(error).rejects.toMatchObject({
      code: "order_command_forbidden",
      status: 403,
    });
  });
});
