import { describe, expect, it, vi } from "vitest";

import type { ServicePool } from "@/src/tenant-context/db";

vi.mock("@/src/tenant-context", () => ({
  withTenant: async (
    _ctx: unknown,
    run: (db: {
      query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
    }) => Promise<unknown>,
    dependencies: {
      pool: {
        connect: () => Promise<{
          query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
          release: () => void;
        }>;
      };
    },
  ) => {
    const client = await dependencies.pool.connect();
    try {
      return await run(client);
    } finally {
      client.release();
    }
  },
}));

import { collectCrmWorkExport } from "../../src/crm/work/export";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const CONTACT_A = "22222222-2222-4222-8222-222222222222";

function fakePool(rows: unknown[]) {
  const query = vi.fn(async (sql: string, _values?: readonly unknown[]) => {
    if (sql === "begin" || sql === "commit" || sql === "rollback") return { rows: [] };
    if (sql.startsWith("select set_config")) return { rows: [] };
    return { rows };
  });
  return {
    query,
    // O fake mede somente query/rows. ServicePool carrega os overloads e o
    // QueryResult completo de pg, que não acrescentam comportamento a este teste.
    pool: {
      query,
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    } as unknown as ServicePool,
  };
}

describe("exportação LGPD de notas e tarefas vinculadas", () => {
  it("usa uma consulta snapshot com tenant/contact em cada origem e sem recibos privados", async () => {
    const expected = {
      notes: [
        {
          id: "note-a",
          contact_id: CONTACT_A,
          order_id: "order-a",
          body: "Combinado com o titular",
          actor_user_id: "actor-a",
          created_at: "2026-09-09T12:00:00Z",
          redacted_at: null,
        },
      ],
      linked_tasks: [
        {
          id: "task-a",
          contact_id: CONTACT_A,
          order_id: "order-a",
          title: "Retornar ao titular",
          description: "Confirmar a entrega",
          assigned_to: "actor-a",
          revision: 2,
        },
      ],
      task_events: [
        {
          id: "event-a",
          task_id: "task-a",
          order_id: "order-a",
          contact_id: CONTACT_A,
          task_revision: 2,
          event_type: "status_changed",
          from_status: "pending",
          to_status: "in_progress",
          actor_type: "user",
          actor_id: "actor-a",
          created_at: "2026-09-09T13:00:00Z",
        },
      ],
    };
    const fake = fakePool([expected]);

    const result = await collectCrmWorkExport(
      { organization_id: ORG_A, source: "job" },
      CONTACT_A,
      { pool: fake.pool },
    );

    expect(result).toEqual(expected);
    const statements = fake.query.mock.calls
      .map(([statement]) => String(statement))
      .filter((statement) => statement.includes("public.crm_notes"));
    expect(statements).toHaveLength(1);
    const sql = statements[0]!;
    const snapshotCall = fake.query.mock.calls.find(([statement]) =>
      String(statement).includes("public.crm_notes"),
    );
    expect(snapshotCall?.[1]).toEqual([ORG_A, CONTACT_A]);
    expect(sql).toContain("n.organization_id = $1 and n.contact_id = $2");
    expect(sql).toContain("t.organization_id = $1");
    expect(sql).toContain("t.contact_id = $2");
    expect(sql).toContain("t.order_id is not null");
    expect(sql).toContain("e.organization_id = $1 and e.contact_id = $2");
    expect(sql).not.toContain("crm_task_command_receipts");
    expect(sql).not.toContain("request_hash");
    expect(sql).not.toContain("command_id");
    expect(sql).not.toContain("idempotency_key");
  });

  it("projeta no journal somente estados, vínculos, ator e tempo", async () => {
    const fake = fakePool([{ notes: [], linked_tasks: [], task_events: [] }]);
    await collectCrmWorkExport({ organization_id: ORG_A, source: "job" }, CONTACT_A, {
      pool: fake.pool,
    });
    const sql = String(
      fake.query.mock.calls.find(([statement]) =>
        String(statement).includes("public.crm_task_events"),
      )?.[0],
    );
    const eventProjection = sql.slice(
      sql.indexOf("'id', e.id"),
      sql.indexOf("from public.crm_task_events e"),
    );
    expect(eventProjection).toContain("'actor_id', e.actor_id");
    expect(eventProjection).not.toContain("title");
    expect(eventProjection).not.toContain("description");
    expect(eventProjection).not.toContain("body");
  });

  it("propaga falha da consulta e nunca devolve exportação parcial", async () => {
    const fake = fakePool([]);
    fake.query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("public.crm_notes")) throw new Error("work_export_failed");
      return { rows: [] };
    });
    await expect(
      collectCrmWorkExport({ organization_id: ORG_A, source: "job" }, CONTACT_A, {
        pool: fake.pool,
      }),
    ).rejects.toThrow("work_export_failed");
  });
});
