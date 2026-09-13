import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { authorizeOrderCommand } from "@/src/crm/orders/authorization";
import { collectOperationalOrderExport } from "@/src/crm/orders/export";
import { readOrder } from "@/src/crm/orders/repository";
import { executeOrderCommand } from "@/src/crm/orders/service";
import type { ServicePool } from "@/src/tenant-context/db";
import type { TenantCtx, TenantDb } from "@/src/tenant-context";
import { withTenant } from "@/src/tenant-context";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("TEST_DB_PORT inválido");
}
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
  max: 4,
});

const ORG_A = "f0200003-0000-4000-8000-000000000001";
const ORG_B = "f0200003-0000-4000-8000-000000000002";
const AGENT_A = "f0200003-1000-4000-8000-000000000001";
const AGENT_B = "f0200003-1000-4000-8000-000000000002";
const VIEWER_A = "f0200003-1000-4000-8000-000000000003";
const REVOKED_A = "f0200003-1000-4000-8000-000000000004";
const CONTACT_A = "f0200003-2000-4000-8000-000000000001";
const CONTACT_B = "f0200003-2000-4000-8000-000000000002";
const COMPANY_A = "f0200003-3000-4000-8000-000000000001";
const COMPANY_B = "f0200003-3000-4000-8000-000000000002";
const PRODUCT_A = "f0200003-4000-4000-8000-000000000001";
const PRODUCT_B = "f0200003-4000-4000-8000-000000000002";

const ctxA: TenantCtx = {
  organization_id: ORG_A,
  user_id: AGENT_A,
  role: "agent",
  source: "session",
};
const humanA = { type: "human" as const, user_id: AGENT_A };
const ctxB: TenantCtx = {
  organization_id: ORG_B,
  user_id: AGENT_B,
  role: "agent",
  source: "session",
};
const humanB = { type: "human" as const, user_id: AGENT_B };

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    position: 1,
    requested_text: "uma unidade",
    product_id: PRODUCT_A,
    product_name: "Produto A combinado",
    sale_unit: "un",
    quantity: "1.000",
    unit_price_cents: 1250,
    currency: "BRL",
    ...overrides,
  };
}

function createCommand(key: string, overrides: Record<string, unknown> = {}) {
  return {
    command: "create_draft",
    idempotency_key: key,
    contact_id: CONTACT_A,
    company_id: COMPANY_A,
    company_name: "Empresa A no pedido",
    channel: "whatsapp",
    delivery_date: "2026-09-10",
    currency: "BRL",
    items: [item()],
    ...overrides,
  };
}

async function execute(raw: unknown, requestId?: string) {
  return executeOrderCommand(ctxA, humanA, raw, { pool, requestId });
}

async function counts(orderId?: string) {
  const result = await pool.query(
    `select
      (select count(*)::int from crm_orders where organization_id=$1 and ($2::uuid is null or id=$2)) orders,
      (select count(*)::int from crm_order_items where organization_id=$1 and ($2::uuid is null or order_id=$2)) items,
      (select count(*)::int from crm_order_command_receipts where organization_id=$1 and ($2::uuid is null or order_id=$2)) receipts,
      (select count(*)::int from crm_order_events where organization_id=$1 and ($2::uuid is null or order_id=$2)) events,
      (select count(*)::int from api_audit_log where organization_id=$1 and action like 'crm_order.%' and ($2::uuid is null or resource_id=$2)) audits`,
    [ORG_A, orderId ?? null],
  );
  return result.rows[0] as {
    orders: number;
    items: number;
    receipts: number;
    events: number;
    audits: number;
  };
}

beforeAll(async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into auth.users(id,email) values
        ($1,'orders-agent-a@integration.test'),($2,'orders-agent-b@integration.test'),
        ($3,'orders-viewer-a@integration.test'),($4,'orders-revoked-a@integration.test')`,
      [AGENT_A, AGENT_B, VIEWER_A, REVOKED_A],
    );
    await client.query(
      `insert into organizations(id,slug,legal_name,display_name) values
        ($1,'orders-int-a','Orders Integration A','Orders A'),
        ($2,'orders-int-b','Orders Integration B','Orders B')`,
      [ORG_A, ORG_B],
    );
    await client.query(
      `insert into user_organizations(organization_id,user_id,role,accepted_at,revoked_at) values
        ($1,$2,'agent',now(),null),($3,$4,'agent',now(),null),
        ($1,$5,'viewer',now(),null),($1,$6,'agent',now(),now())`,
      [ORG_A, AGENT_A, ORG_B, AGENT_B, VIEWER_A, REVOKED_A],
    );
    await client.query(
      "insert into contacts(id,organization_id,display_name) values ($1,$2,'Contato A'),($3,$4,'Contato B')",
      [CONTACT_A, ORG_A, CONTACT_B, ORG_B],
    );
    await client.query(
      "insert into crm_companies(id,organization_id,legal_name) values ($1,$2,'Empresa A'),($3,$4,'Empresa B')",
      [COMPANY_A, ORG_A, COMPANY_B, ORG_B],
    );
    await client.query(
      `insert into catalog_products(id,organization_id,codigo,nome,preco_cents,sale_unit) values
        ($1,$2,'INT-A','Produto A',1250,'un'),($3,$4,'INT-B','Produto B',2500,'kg')`,
      [PRODUCT_A, ORG_A, PRODUCT_B, ORG_B],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
});

beforeEach(async () => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "delete from api_audit_log where organization_id in ($1,$2) and action like 'crm_order.%'",
      [ORG_A, ORG_B],
    );
    await client.query("delete from crm_order_events where organization_id in ($1,$2)", [
      ORG_A,
      ORG_B,
    ]);
    await client.query("delete from crm_order_command_receipts where organization_id in ($1,$2)", [
      ORG_A,
      ORG_B,
    ]);
    await client.query("delete from crm_order_items where organization_id in ($1,$2)", [
      ORG_A,
      ORG_B,
    ]);
    await client.query("delete from crm_orders where organization_id in ($1,$2)", [ORG_A, ORG_B]);
    await client.query("update organizations set status='active' where id in ($1,$2)", [
      ORG_A,
      ORG_B,
    ]);
    await client.query(
      `update user_organizations set role=case when user_id=$2 then 'viewer' else 'agent' end,
         accepted_at=coalesce(accepted_at,now()), revoked_at=case when user_id=$3 then now() else null end
        where organization_id=$1`,
      [ORG_A, VIEWER_A, REVOKED_A],
    );
    await client.query(
      "update catalog_products set nome='Produto A',preco_cents=1250,sale_unit='un',ativo=true where id=$1",
      [PRODUCT_A],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
});

afterAll(async () => pool.end());

describe("serviço transacional de pedidos", () => {
  it("cria pedido, item, evento, recibo concluído e auditoria na mesma operação", async () => {
    const result = await execute(createCommand("atomic-create"), "request-atomic");
    expect(result.replayed).toBe(false);
    expect(await counts(result.order.id)).toEqual({
      orders: 1,
      items: 1,
      receipts: 1,
      events: 1,
      audits: 1,
    });
    const stored = await pool.query(
      `select o.source,r.response_body is not null complete,e.contact_id,a.request_id
         from crm_orders o join crm_order_command_receipts r on r.order_id=o.id
         join crm_order_events e on e.order_id=o.id join api_audit_log a on a.resource_id=o.id
        where o.id=$1`,
      [result.order.id],
    );
    expect(stored.rows[0]).toMatchObject({
      source: "ui",
      complete: true,
      contact_id: CONTACT_A,
      request_id: "request-atomic",
    });
  });

  it("salva rascunho pendente sem zeros e recusa confirmação sem regra de arredondamento", async () => {
    const draft = await execute(
      createCommand("pending", {
        delivery_date: null,
        currency: null,
        items: [
          item({
            product_id: null,
            product_name: null,
            sale_unit: null,
            quantity: null,
            unit_price_cents: null,
            currency: null,
          }),
        ],
      }),
    );
    expect(draft.order.total_cents).toBeNull();
    expect(draft.order.items[0]?.line_total_cents).toBeNull();
    await expect(
      execute({
        command: "confirm_order",
        idempotency_key: "pending-confirm",
        order_id: draft.order.id,
        expected_revision: 1,
      }),
    ).rejects.toMatchObject({ code: "order_incomplete", status: 422 });

    const rounding = await execute(
      createCommand("rounding", { items: [item({ quantity: "0.500", unit_price_cents: 101 })] }),
    );
    expect(rounding.order.pending).toContainEqual(
      expect.objectContaining({ code: "rounding_rule_required" }),
    );
    await expect(
      execute({
        command: "confirm_order",
        idempotency_key: "rounding-confirm",
        order_id: rounding.order.id,
        expected_revision: 1,
      }),
    ).rejects.toMatchObject({ code: "order_incomplete", status: 422 });
  });

  it("confirma e avança somente pelas transições humanas até o terminal", async () => {
    const draft = await execute(createCommand("states-create"));
    const confirmed = await execute({
      command: "confirm_order",
      idempotency_key: "states-confirm",
      order_id: draft.order.id,
      expected_revision: 1,
    });
    const production = await execute({
      command: "advance_order",
      idempotency_key: "states-production",
      order_id: draft.order.id,
      expected_revision: 2,
      next_status: "in_production",
    });
    const delivered = await execute({
      command: "advance_order",
      idempotency_key: "states-delivered",
      order_id: draft.order.id,
      expected_revision: 3,
      next_status: "delivered",
    });
    expect([confirmed.order.status, production.order.status, delivered.order.status]).toEqual([
      "confirmed",
      "in_production",
      "delivered",
    ]);
    await expect(
      execute({
        command: "edit_order",
        idempotency_key: "terminal-edit",
        order_id: draft.order.id,
        expected_revision: 4,
        channel: "phone",
      }),
    ).rejects.toMatchObject({ code: "order_terminal" });
  });

  it("preserva snapshots depois de o catálogo mudar", async () => {
    const draft = await execute(createCommand("snapshot-create"));
    await execute({
      command: "confirm_order",
      idempotency_key: "snapshot-confirm",
      order_id: draft.order.id,
      expected_revision: 1,
    });
    await pool.query(
      "update catalog_products set nome='Produto novo',preco_cents=9999,sale_unit='cx' where id=$1",
      [PRODUCT_A],
    );
    const view = await withTenant(ctxA, (db) => readOrder(db, ORG_A, draft.order.id), { pool });
    expect(view?.items[0]).toMatchObject({
      product_name: "Produto A combinado",
      sale_unit: "un",
      unit_price_cents: 1250,
    });
  });

  it("duas execuções concorrentes do mesmo comando produzem um efeito", async () => {
    const command = createCommand("concurrent-replay");
    const results = await Promise.all([execute(command), execute(command)]);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(new Set(results.map((r) => r.order.id)).size).toBe(1);
    expect(await counts(results[0]!.order.id)).toEqual({
      orders: 1,
      items: 1,
      receipts: 1,
      events: 1,
      audits: 1,
    });
  });

  it("recusa a mesma chave com payload diferente", async () => {
    await execute(createCommand("changed-payload"));
    await expect(
      execute(createCommand("changed-payload", { channel: "phone" })),
    ).rejects.toMatchObject({ code: "idempotency_conflict", status: 409 });
  });

  it("replay antecede revisão vencida e devolve a resposta original", async () => {
    const draft = await execute(createCommand("replay-create"));
    const firstEdit = {
      command: "edit_order",
      idempotency_key: "replay-edit-1",
      order_id: draft.order.id,
      expected_revision: 1,
      channel: "phone",
    };
    const first = await execute(firstEdit);
    await execute({
      command: "edit_order",
      idempotency_key: "replay-edit-2",
      order_id: draft.order.id,
      expected_revision: 2,
      channel: "email",
    });
    const replay = await execute(firstEdit);
    expect(replay).toMatchObject({ replayed: true, order: { revision: 2, channel: "phone" } });
    expect(first.order).toEqual(replay.order);
  });

  it("duas chaves com a mesma revisão deixam apenas um commit", async () => {
    const draft = await execute(createCommand("stale-create"));
    const settled = await Promise.allSettled([
      execute({
        command: "edit_order",
        idempotency_key: "stale-a",
        order_id: draft.order.id,
        expected_revision: 1,
        channel: "a",
      }),
      execute({
        command: "edit_order",
        idempotency_key: "stale-b",
        order_id: draft.order.id,
        expected_revision: 1,
        channel: "b",
      }),
    ]);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.find((r) => r.status === "rejected");
    expect(rejected && rejected.status === "rejected" ? rejected.reason : null).toMatchObject({
      code: "revision_conflict",
    });
    expect(await counts(draft.order.id)).toMatchObject({
      orders: 1,
      receipts: 2,
      events: 2,
      audits: 2,
    });
  });

  it("nega IDs cruzados de contato, empresa, produto e pedido sem efeitos", async () => {
    const attempts = [
      createCommand("cross-contact", { contact_id: CONTACT_B }),
      createCommand("cross-company", { company_id: COMPANY_B }),
      createCommand("cross-product", { items: [item({ product_id: PRODUCT_B })] }),
    ];
    for (const command of attempts)
      await expect(execute(command)).rejects.toMatchObject({ status: 422 });
    const own = await execute(createCommand("immutable-contact-create"));
    await expect(
      execute({
        command: "edit_order",
        idempotency_key: "immutable-contact-edit",
        order_id: own.order.id,
        expected_revision: 1,
        contact_id: CONTACT_B,
      }),
    ).rejects.toMatchObject({ code: "contact_change_not_allowed", status: 422 });
    const foreign = await executeOrderCommand(
      { organization_id: ORG_B, user_id: AGENT_B, role: "agent", source: "session" },
      { type: "human", user_id: AGENT_B },
      createCommand("foreign-order-create", {
        contact_id: CONTACT_B,
        company_id: COMPANY_B,
        company_name: "B",
        items: [item({ product_id: PRODUCT_B, sale_unit: "kg" })],
      }),
      { pool },
    );
    await expect(
      execute({
        command: "edit_order",
        idempotency_key: "cross-order",
        order_id: foreign.order.id,
        expected_revision: 1,
        channel: "x",
      }),
    ).rejects.toMatchObject({ code: "order_not_found", status: 404 });
    expect(await counts()).toEqual({ orders: 1, items: 1, receipts: 1, events: 1, audits: 1 });
  });

  it("nega autoria divergente, viewer, revogado e organização suspensa antes de replay", async () => {
    await expect(
      executeOrderCommand(ctxA, { type: "ai_agent", agent_id: randomUUID() }, createCommand("ai"), {
        pool,
      }),
    ).rejects.toMatchObject({ code: "non_human_executor_denied", status: 403 });
    await expect(
      executeOrderCommand(
        ctxA,
        { type: "automation", run_id: randomUUID() },
        createCommand("automation"),
        { pool },
      ),
    ).rejects.toMatchObject({ code: "non_human_executor_denied", status: 403 });
    await expect(
      executeOrderCommand(ctxA, { type: "human", user_id: AGENT_B }, createCommand("actor"), {
        pool,
      }),
    ).rejects.toMatchObject({ code: "executor_identity_mismatch", status: 403 });
    await expect(
      executeOrderCommand(
        { ...ctxA, user_id: VIEWER_A, role: "viewer" },
        { type: "human", user_id: VIEWER_A },
        createCommand("viewer"),
        { pool },
      ),
    ).rejects.toMatchObject({ code: "order_command_forbidden", status: 403 });
    await expect(
      executeOrderCommand(
        { ...ctxA, user_id: REVOKED_A },
        { type: "human", user_id: REVOKED_A },
        createCommand("revoked"),
        { pool },
      ),
    ).rejects.toMatchObject({ code: "order_command_forbidden", status: 403 });
    const replayCommand = createCommand("auth-before-replay");
    await execute(replayCommand);
    await pool.query("update organizations set status='suspended' where id=$1", [ORG_A]);
    await expect(execute(replayCommand)).rejects.toMatchObject({
      code: "order_command_forbidden",
      status: 403,
    });
  });

  it("canonicaliza produto uppercase e recusa item repetido por diferença de caixa", async () => {
    const upper = await execute(
      createCommand("upper-product", { items: [item({ product_id: PRODUCT_A.toUpperCase() })] }),
    );
    expect(upper.order.items[0]?.product_id).toBe(PRODUCT_A);
    const id = randomUUID();
    await expect(
      execute(
        createCommand("duplicate-case", {
          items: [item({ id, position: 1 }), item({ id: id.toUpperCase(), position: 2 })],
        }),
      ),
    ).rejects.toMatchObject({ code: "duplicate_item", status: 422 });
  });

  it("reordena itens preservando IDs e created_at", async () => {
    const first = item({ position: 1 });
    const second = item({ position: 2, requested_text: "segundo" });
    const draft = await execute(createCommand("reorder-create", { items: [first, second] }));
    const before = await pool.query(
      "select id,created_at from crm_order_items where order_id=$1 order by id",
      [draft.order.id],
    );
    await execute({
      command: "edit_order",
      idempotency_key: "reorder-edit",
      order_id: draft.order.id,
      expected_revision: 1,
      items: [
        { ...first, position: 2 },
        { ...second, position: 1 },
      ],
    });
    const after = await pool.query(
      "select id,position,created_at from crm_order_items where order_id=$1 order by id",
      [draft.order.id],
    );
    expect(after.rows.map((r) => [r.id, r.created_at.toISOString()])).toEqual(
      before.rows.map((r) => [r.id, r.created_at.toISOString()]),
    );
    expect(after.rows.map((r) => r.position).sort()).toEqual([1, 2]);
  });

  it("falha deliberada do journal reverte pedido, itens, recibo e auditoria", async () => {
    await pool.query(
      `create or replace function public.test_f02_reject_order_journal() returns trigger language plpgsql as $$ begin raise exception 'journal failure probe'; end $$`,
    );
    await pool.query(
      `create trigger test_reject_order_journal before insert on crm_order_events for each row execute function public.test_f02_reject_order_journal()`,
    );
    try {
      await expect(
        execute(createCommand("journal-rollback"), "journal-rollback-request"),
      ).rejects.toThrow("journal failure probe");
    } finally {
      await pool.query("drop trigger test_reject_order_journal on crm_order_events");
      await pool.query("drop function public.test_f02_reject_order_journal()");
    }
    expect(await counts()).toEqual({ orders: 0, items: 0, receipts: 0, events: 0, audits: 0 });
  });

  it("FOR SHARE da autorização bloqueia revogação até o commit", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let authorized!: () => void;
    const reached = new Promise<void>((resolve) => {
      authorized = resolve;
    });
    const authTxn = withTenant(
      ctxA,
      async (db) => {
        await authorizeOrderCommand(db, ctxA, humanA, "orders.write");
        authorized();
        await hold;
      },
      { pool },
    );
    await reached;
    const writer = await pool.connect();
    try {
      await writer.query("begin");
      const pid = (await writer.query<{ pid: number }>("select pg_backend_pid() pid")).rows[0]!.pid;
      const pending = writer.query(
        "update user_organizations set revoked_at=now() where organization_id=$1 and user_id=$2",
        [ORG_A, AGENT_A],
      );
      void pending.catch(() => undefined);
      await expect
        .poll(
          async () =>
            Number(
              (await pool.query("select cardinality(pg_blocking_pids($1)) n", [pid])).rows[0]?.n,
            ),
          { timeout: 3000, interval: 20 },
        )
        .toBeGreaterThan(0);
      release();
      await authTxn;
      expect((await pending).rowCount).toBe(1);
      await writer.query("rollback");
    } finally {
      release();
      await authTxn.catch(() => undefined);
      await writer.query("rollback").catch(() => undefined);
      writer.release();
    }
  });

  it("readOrder devolve cabeçalho e itens do mesmo statement", async () => {
    const original = item({ requested_text: "snapshot antigo" });
    const draft = await execute(createCommand("read-snapshot", { items: [original] }));
    const reader = await pool.connect();
    let interleaved = false;
    const wrapped = {
      query: async (text: string, values?: unknown[]) => {
        const result = await reader.query(text, values);
        if (!interleaved && text.includes("select o.id")) {
          interleaved = true;
          await pool.query(
            `with changed as (update crm_orders set revision=2 where id=$1 returning id)
             update crm_order_items set requested_text='snapshot novo'
              where order_id=(select id from changed)`,
            [draft.order.id],
          );
        }
        return result;
      },
    } as unknown as TenantDb;
    try {
      const view = await readOrder(wrapped, ORG_A, draft.order.id);
      expect(view).toMatchObject({ revision: 1, items: [{ requested_text: "snapshot antigo" }] });
      const current = await pool.query(
        "select o.revision,i.requested_text from crm_orders o join crm_order_items i on i.order_id=o.id where o.id=$1",
        [draft.order.id],
      );
      expect(current.rows[0]).toMatchObject({ revision: 2, requested_text: "snapshot novo" });
    } finally {
      reader.release();
    }
  });

  it("exporta histórico real do titular sem carregar estado do outro contato ou tenant", async () => {
    const oldItem = item({ requested_text: "texto antigo do titular A" });
    const createdA = await execute(createCommand("export-create-a", { items: [oldItem] }));
    const newItem = item({ requested_text: "texto atual do titular A" });
    await execute({
      command: "edit_order",
      idempotency_key: "export-edit-a",
      order_id: createdA.order.id,
      expected_revision: 1,
      items: [newItem],
    });
    await execute({
      command: "cancel_order",
      idempotency_key: "export-cancel-a",
      order_id: createdA.order.id,
      expected_revision: 2,
      reason: "motivo informado pelo titular A",
    });
    const createdB = await executeOrderCommand(
      ctxB,
      humanB,
      createCommand("export-create-b", {
        contact_id: CONTACT_B,
        company_id: COMPANY_B,
        company_name: "Empresa B",
        items: [
          item({
            requested_text: "estado privado do tenant B",
            product_id: PRODUCT_B,
            product_name: "Produto B",
            sale_unit: "kg",
          }),
        ],
      }),
      { pool },
    );
    const syntheticReceipt = randomUUID();
    const syntheticEvent = randomUUID();
    await pool.query(
      `insert into crm_order_command_receipts
        (id,organization_id,operation,idempotency_key,request_hash,actor_type,actor_id,order_id,response_body,completed_at)
       values($1,$2,'edit_order','export-synthetic',decode(repeat('ab',32),'hex'),'user',$3,$4,'{}',now())`,
      [syntheticReceipt, ORG_A, AGENT_A, createdA.order.id],
    );
    await pool.query(
      `insert into crm_order_events
        (id,organization_id,receipt_id,order_id,contact_id,order_revision,event_type,changes,actor_type,actor_id)
       values($1,$2,$3,$4,$5,99,'order_edited',$6,'user',$7)`,
      [
        syntheticEvent,
        ORG_A,
        syntheticReceipt,
        createdA.order.id,
        CONTACT_A,
        JSON.stringify({
          before: { contact_id: CONTACT_B, private_state: "não pertence ao titular A" },
          after: { contact_id: CONTACT_A, visible_state: "pertence ao titular A" },
        }),
        AGENT_A,
      ],
    );

    // A resposta do recibo pode ter metadados extras: só os campos pessoais
    // previstos do pedido/itens saem. O JSON inteiro nunca vira o payload.
    await pool.query(`update crm_order_command_receipts set response_body=$2::jsonb where id=$1`, [
      syntheticReceipt,
      JSON.stringify({
        ...createdA.order,
        private_receipt_metadata: "metadado interno não exportável",
        items: [{ ...oldItem, internal_item_metadata: "metadado de item não exportável" }],
      }),
    ]);
    const exportA = await collectOperationalOrderExport(
      { organization_id: ORG_A, source: "job" },
      CONTACT_A,
      { pool },
    );
    const serializedA = JSON.stringify(exportA);
    expect(serializedA).toContain("texto antigo do titular A");
    expect(serializedA).toContain("motivo informado pelo titular A");
    expect(serializedA).not.toContain("estado privado do tenant B");
    expect(serializedA).not.toContain("não pertence ao titular A");
    expect(exportA.saved_snapshots).toHaveLength(4);
    expect(JSON.stringify(exportA.saved_snapshots)).toContain("texto antigo do titular A");
    expect(serializedA).not.toContain("metadado interno não exportável");
    expect(serializedA).not.toContain("metadado de item não exportável");
    expect(JSON.stringify(exportA.saved_snapshots)).not.toContain(syntheticReceipt);
    expect(JSON.stringify(exportA.saved_snapshots)).not.toContain(AGENT_A);
    expect(JSON.stringify(exportA.saved_snapshots)).not.toContain("export-synthetic");
    // Nem a referência a um pedido A autoriza resposta de outro contato.
    await pool.query(
      `update crm_order_command_receipts set response_body=jsonb_set(response_body,'{contact_id}',to_jsonb($2::text)) where id=$1`,
      [syntheticReceipt, CONTACT_B],
    );
    const filtered = await collectOperationalOrderExport(
      { organization_id: ORG_A, source: "job" },
      CONTACT_A,
      { pool },
    );
    expect(filtered.saved_snapshots).toHaveLength(3);
    expect(exportA.events.find(({ id }) => id === syntheticEvent)?.changes).toEqual({
      after: { contact_id: CONTACT_A, visible_state: "pertence ao titular A" },
    });

    const exportB = await collectOperationalOrderExport(
      { organization_id: ORG_B, source: "job" },
      CONTACT_B,
      { pool },
    );
    expect(exportB.orders.map(({ id }) => id)).toEqual([createdB.order.id]);
    expect(JSON.stringify(exportB)).not.toContain("texto antigo do titular A");
  });

  it("anonimiza só o contato A, preserva fatos e torna o replay indisponível", async () => {
    const contact = randomUUID();
    await pool.query(
      `insert into contacts(id,organization_id,display_name,company_id,recurring)
       values($1,$2,'Contato a anonimizar',$3,true)`,
      [contact, ORG_A, COMPANY_A],
    );
    const commandA = createCommand("redact-a", { contact_id: contact });
    const orderA = await execute(commandA);
    const commandB = createCommand("redact-b", {
      contact_id: CONTACT_B,
      company_id: COMPANY_B,
      company_name: "Empresa B no pedido",
      items: [
        item({
          product_id: PRODUCT_B,
          product_name: "Produto B combinado",
          sale_unit: "kg",
          unit_price_cents: 2500,
        }),
      ],
    });
    const orderB = await executeOrderCommand(ctxB, humanB, commandB, { pool });
    const beforeA = await pool.query(
      `select o.id,o.revision,o.total_cents,i.id item_id,i.quantity::text quantity,
              i.unit_price_cents,i.line_total_cents,e.id event_id,e.order_revision,
              r.id receipt_id,encode(r.request_hash,'hex') request_hash
         from crm_orders o join crm_order_items i on i.order_id=o.id
         join crm_order_events e on e.order_id=o.id
         join crm_order_command_receipts r on r.order_id=o.id where o.id=$1`,
      [orderA.order.id],
    );

    await pool.query("select fn_lgpd_cascade_redact_contact($1,$2,$3)", [
      ORG_A,
      contact,
      randomUUID(),
    ]);

    const afterA = await pool.query(
      `select o.id,o.revision,o.total_cents,o.company_id,o.company_name_snapshot,o.channel,
              i.id item_id,i.requested_text,i.product_name_snapshot,i.sale_unit_snapshot,
              i.quantity::text quantity,i.unit_price_cents,i.line_total_cents,
              e.id event_id,e.order_revision,e.event_type,e.changes,e.contact_id,
              r.id receipt_id,encode(r.request_hash,'hex') request_hash,r.response_body,
              c.company_id contact_company,c.recurring
         from crm_orders o join crm_order_items i on i.order_id=o.id
         join crm_order_events e on e.order_id=o.id
         join crm_order_command_receipts r on r.order_id=o.id
         join contacts c on c.id=o.contact_id where o.id=$1`,
      [orderA.order.id],
    );
    expect(afterA.rows[0]).toMatchObject({
      id: beforeA.rows[0].id,
      revision: beforeA.rows[0].revision,
      total_cents: beforeA.rows[0].total_cents,
      item_id: beforeA.rows[0].item_id,
      quantity: beforeA.rows[0].quantity,
      unit_price_cents: beforeA.rows[0].unit_price_cents,
      line_total_cents: beforeA.rows[0].line_total_cents,
      event_id: beforeA.rows[0].event_id,
      order_revision: beforeA.rows[0].order_revision,
      receipt_id: beforeA.rows[0].receipt_id,
      request_hash: beforeA.rows[0].request_hash,
      company_id: null,
      company_name_snapshot: null,
      channel: null,
      requested_text: "[conteúdo anonimizado]",
      product_name_snapshot: null,
      sale_unit_snapshot: "un",
      changes: { redacted: true },
      contact_id: contact,
      response_body: { redacted: true },
      contact_company: null,
      recurring: false,
    });
    const untouchedB = await pool.query(
      `select o.company_name_snapshot,i.requested_text,e.changes,r.response_body
         from crm_orders o join crm_order_items i on i.order_id=o.id
         join crm_order_events e on e.order_id=o.id
         join crm_order_command_receipts r on r.order_id=o.id where o.id=$1`,
      [orderB.order.id],
    );
    expect(untouchedB.rows[0]).toMatchObject({
      company_name_snapshot: "Empresa B no pedido",
      requested_text: "uma unidade",
    });
    expect(untouchedB.rows[0].changes).not.toEqual({ redacted: true });
    expect(untouchedB.rows[0].response_body).not.toEqual({ redacted: true });

    const auditBeforeRetry = Number(
      (
        await pool.query(
          "select count(*) n from api_audit_log where organization_id=$1 and action='crm_order.redacted' and resource_id=$2",
          [ORG_A, contact],
        )
      ).rows[0].n,
    );
    expect(auditBeforeRetry).toBe(1);
    await pool.query("update contacts set is_anonymized=true where organization_id=$1 and id=$2", [
      ORG_A,
      contact,
    ]);
    const auditAfterRetry = Number(
      (
        await pool.query(
          "select count(*) n from api_audit_log where organization_id=$1 and action='crm_order.redacted' and resource_id=$2",
          [ORG_A, contact],
        )
      ).rows[0].n,
    );
    expect(auditAfterRetry).toBe(auditBeforeRetry);
    await expect(execute(commandA)).rejects.toMatchObject({ code: "order_redacted", status: 410 });
    await expect(
      execute(createCommand("redact-new-command", { contact_id: contact })),
    ).rejects.toMatchObject({ code: "contact_unavailable", status: 422 });
  });

  it("serializa comando e cascata LGPD pelo mesmo mutex sem deadlock", async () => {
    const contact = randomUUID();
    const requestId = randomUUID();
    await pool.query(
      "insert into contacts(id,organization_id,display_name) values($1,$2,'Contato corrida')",
      [contact, ORG_A],
    );
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const lockReached = new Promise<void>((resolve) => {
      locked = resolve;
    });
    let paused = false;
    const gatedPool = {
      query: pool.query.bind(pool),
      connect: async () => {
        const client = await pool.connect();
        return {
          query: async (text: string, values?: unknown[]) => {
            const result = await client.query(text, values);
            if (!paused && text.includes("fn_service_lock")) {
              paused = true;
              locked();
              await hold;
            }
            return result;
          },
          release: () => client.release(),
        } as unknown as pg.PoolClient;
      },
    } as unknown as ServicePool;
    const command = createCommand("lgpd-race", { contact_id: contact });
    const commandPending = executeOrderCommand(ctxA, humanA, command, { pool: gatedPool });
    void commandPending.catch(() => undefined);
    await lockReached;

    const redactor = await pool.connect();
    let redactionPending: Promise<pg.QueryResult> | undefined;
    try {
      await redactor.query("begin");
      const pid = (await redactor.query<{ pid: number }>("select pg_backend_pid() pid")).rows[0]!
        .pid;
      redactionPending = redactor.query("select public.fn_lgpd_cascade_redact_contact($1,$2,$3)", [
        ORG_A,
        contact,
        requestId,
      ]);
      void redactionPending.catch(() => undefined);
      await expect
        .poll(
          async () =>
            Number(
              (await pool.query("select cardinality(pg_blocking_pids($1)) n", [pid])).rows[0]?.n,
            ),
          { timeout: 3000, interval: 20 },
        )
        .toBeGreaterThan(0);
      release();
      const created = await commandPending;
      await redactionPending;
      await redactor.query("commit");
      const state = await pool.query(
        `select c.is_anonymized,i.requested_text,e.changes,r.response_body
           from contacts c join crm_orders o on o.contact_id=c.id
           join crm_order_items i on i.order_id=o.id join crm_order_events e on e.order_id=o.id
           join crm_order_command_receipts r on r.order_id=o.id
          where c.id=$1 and o.id=$2`,
        [contact, created.order.id],
      );
      expect(state.rows[0]).toMatchObject({
        is_anonymized: true,
        requested_text: "[conteúdo anonimizado]",
        changes: { redacted: true },
        response_body: { redacted: true },
      });
    } finally {
      release();
      await commandPending.catch(() => undefined);
      if (redactionPending) await redactionPending.catch(() => undefined);
      await redactor.query("rollback").catch(() => undefined);
      redactor.release();
    }
  });

  it("falha injetada na redação reverte contato e todo o domínio", async () => {
    const contact = randomUUID();
    await pool.query(
      `insert into contacts(id,organization_id,display_name,company_id,recurring)
       values($1,$2,'Contato rollback',$3,true)`,
      [contact, ORG_A, COMPANY_A],
    );
    const command = createCommand("redact-rollback", { contact_id: contact });
    const created = await execute(command);
    await pool.query(
      `create or replace function public.test_f02_reject_redaction() returns trigger language plpgsql as $$ begin raise exception 'redaction failure probe'; end $$`,
    );
    await pool.query(
      `create trigger test_reject_redaction before update on crm_order_items
       for each row when(new.requested_text='[conteúdo anonimizado]')
       execute function public.test_f02_reject_redaction()`,
    );
    try {
      await expect(
        pool.query("select fn_lgpd_cascade_redact_contact($1,$2,$3)", [
          ORG_A,
          contact,
          randomUUID(),
        ]),
      ).rejects.toThrow("redaction failure probe");
    } finally {
      await pool.query("drop trigger test_reject_redaction on crm_order_items");
      await pool.query("drop function public.test_f02_reject_redaction()");
    }
    const state = await pool.query(
      `select c.is_anonymized,c.company_id,c.recurring,o.company_name_snapshot,o.channel,
              i.requested_text,i.product_name_snapshot,e.changes,r.response_body,
              (select count(*)::int from api_audit_log where action='crm_order.redacted' and resource_id=c.id) redaction_audits
         from contacts c join crm_orders o on o.contact_id=c.id join crm_order_items i on i.order_id=o.id
         join crm_order_events e on e.order_id=o.id join crm_order_command_receipts r on r.order_id=o.id
        where c.id=$1 and o.id=$2`,
      [contact, created.order.id],
    );
    expect(state.rows[0]).toMatchObject({
      is_anonymized: false,
      company_id: COMPANY_A,
      recurring: true,
      company_name_snapshot: "Empresa A no pedido",
      channel: "whatsapp",
      requested_text: "uma unidade",
      product_name_snapshot: "Produto A combinado",
      redaction_audits: 0,
    });
    expect(state.rows[0].changes).not.toEqual({ redacted: true });
    expect(state.rows[0].response_body).not.toEqual({ redacted: true });
  });

  it("trigger de anonimização é security definer privado e ligado a contacts", async () => {
    const result = await pool.query(
      `select p.prosecdef,
              has_function_privilege('anon',p.oid,'execute') anon_execute,
              has_function_privilege('authenticated',p.oid,'execute') auth_execute,
              has_function_privilege('service_role',p.oid,'execute') service_execute,
              exists(select 1 from pg_trigger t where t.tgrelid='public.contacts'::regclass
                and t.tgfoid=p.oid and t.tgname='trg_crm_orders_redact_contact' and not t.tgisinternal) attached
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='fn_crm_orders_redact_contact'`,
    );
    expect(result.rows).toEqual([
      {
        prosecdef: true,
        anon_execute: false,
        auth_execute: false,
        service_execute: false,
        attached: true,
      },
    ]);
  });
});
