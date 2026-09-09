import { describe, expect, it, vi } from "vitest";

import { collectOperationalOrderExport } from "@/src/crm/orders/export";
import type { ServicePool } from "@/src/tenant-context/db";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const CONTACT_A = "22222222-2222-4222-8222-222222222222";

function pool(rows: unknown[]) {
  const query = vi.fn(async (sql: string) => {
    if (sql === "begin" || sql === "commit" || sql === "rollback") return { rows: [] };
    if (sql.startsWith("select set_config")) return { rows: [] };
    return { rows };
  });
  // A fixture modela apenas query(text) com Promise, usado pelo coletor.
  // Sobrecargas de callback/stream do pg.Pool não são executadas neste teste.
  const connectionPool = {
    query,
    connect: vi.fn(async () => ({ query, release: vi.fn() })),
  } as unknown as ServicePool;
  return { query, pool: connectionPool };
}

describe("export operacional de pedidos", () => {
  it("executa uma consulta snapshot tenant/contact e preserva quantidade decimal como texto", async () => {
    const fake = pool([{ orders: [{ id: "o", items: [{ quantity: "1.250" }] }], events: [] }]);
    const data = await collectOperationalOrderExport(
      { organization_id: ORG_A, source: "job" },
      CONTACT_A,
      { pool: fake.pool },
    );
    const sql = fake.query.mock.calls.find(([statement]) =>
      String(statement).includes("crm_orders"),
    )?.[0] as string;
    expect(sql).toContain("o.organization_id=$1 and o.contact_id=$2");
    expect(sql).toContain("e.organization_id=$1 and e.contact_id=$2");
    expect(sql).toContain("i.quantity::text");
    expect(data.orders[0]?.items[0]?.quantity).toBe("1.250");
  });

  it("propaga falha da leitura em vez de permitir export incompleto", async () => {
    const fake = pool([]);
    fake.query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("crm_orders")) throw new Error("read_failed");
      return { rows: [] };
    });
    await expect(
      collectOperationalOrderExport({ organization_id: ORG_A, source: "job" }, CONTACT_A, {
        pool: fake.pool,
      }),
    ).rejects.toThrow("read_failed");
  });

  it("limita snapshots históricos ao contato solicitado e projeta apenas dados do pedido nos recibos privados", async () => {
    const fake = pool([
      {
        orders: [],
        events: [
          {
            id: "event-b",
            order_id: "order",
            revision: 2,
            type: "order_edited",
            created_at: "2026-09-09T00:00:00Z",
          },
        ],
      },
    ]);
    const data = await collectOperationalOrderExport(
      { organization_id: ORG_A, source: "job" },
      CONTACT_A,
      { pool: fake.pool },
    );
    expect(data.events).toEqual([
      {
        id: "event-b",
        order_id: "order",
        revision: 2,
        type: "order_edited",
        created_at: "2026-09-09T00:00:00Z",
      },
    ]);
    const sql = fake.query.mock.calls.find(([statement]) =>
      String(statement).includes("crm_order_events"),
    )?.[0] as string;
    expect(sql).toContain("e.changes#>>'{before,contact_id}'=$2::text");
    expect(sql).toContain("e.changes#>>'{after,contact_id}'=$2::text");
    expect(sql).toContain("from public.crm_order_command_receipts r");
    expect(sql).toContain("r.organization_id=$1 and saved_order.contact_id=$2");
    expect(sql).toContain("r.response_body->>'contact_id'=$2::text");
    expect(sql).toContain("r.response_body->>'id'=r.order_id::text");
    expect(sql).not.toContain("request_hash");
    expect(sql).not.toContain("idempotency_key");
    expect(sql).not.toContain("actor_id");
    expect(sql).not.toMatch(/'order',\s*r\.response_body/);
  });
});
