import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectOperationalOrderExport } from "@/src/crm/orders/export";
import { recordOrderCheck } from "@/src/crm/orders/checks-service";
import { executeOrderCommand } from "@/src/crm/orders/service";
import type { TenantCtx } from "@/src/tenant-context";

const rawPort = process.env.TEST_DB_PORT;
if (!rawPort) throw new Error("TEST_DB_PORT obrigatório: rode com pnpm test:integration");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("TEST_DB_PORT inválido");
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
  max: 4,
});

const ORG_A = "f0200012-0000-4000-8000-000000000011";
const ORG_B = "f0200012-0000-4000-8000-000000000012";
const AGENT_A = "f0200012-1000-4000-8000-000000000011";
const AGENT_B = "f0200012-1000-4000-8000-000000000012";
const VIEWER_A = "f0200012-1000-4000-8000-000000000013";
const REVOKED_A = "f0200012-1000-4000-8000-000000000014";
const PLATFORM_A = "f0200012-1000-4000-8000-000000000015";
const CONTACT_A = "f0200012-2000-4000-8000-000000000011";
const CONTACT_B = "f0200012-2000-4000-8000-000000000012";

const ctxA: TenantCtx = {
  organization_id: ORG_A,
  user_id: AGENT_A,
  role: "agent",
  source: "session",
};
const ctxB: TenantCtx = {
  organization_id: ORG_B,
  user_id: AGENT_B,
  role: "agent",
  source: "session",
};
const humanA = { type: "human" as const, user_id: AGENT_A };
const humanB = { type: "human" as const, user_id: AGENT_B };

function orderItem(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    position: 1,
    requested_text: "Item fictício para conferência",
    product_id: null,
    product_name: "Produto fictício",
    sale_unit: "kg",
    quantity: "2.000",
    unit_price_cents: 100,
    currency: "BRL",
    ...overrides,
  };
}

async function createOrder(
  ctx = ctxA,
  actor = humanA,
  items = [orderItem()],
  contactId = CONTACT_A,
) {
  return executeOrderCommand(
    ctx,
    actor,
    {
      command: "create_draft",
      idempotency_key: `check-order-${randomUUID()}`,
      contact_id: contactId,
      company_id: null,
      company_name: null,
      channel: null,
      delivery_date: null,
      currency: "BRL",
      items,
    },
    { pool },
  );
}

function checkCommand(itemId: string, quantity: string, revision = 1, key = randomUUID()) {
  return {
    idempotency_key: key,
    expected_revision: revision,
    item_id: itemId,
    checked_quantity: quantity,
  };
}

async function check(orderId: string, command: unknown, requestId?: string) {
  return recordOrderCheck(ctxA, humanA, orderId, command, { pool, requestId });
}

async function effects(orderId: string) {
  const result = await pool.query(
    `select
      (select count(*)::int from crm_order_check_command_receipts
        where organization_id=$1 and order_id=$2) receipts,
      (select count(*)::int from crm_order_check_events
        where organization_id=$1 and order_id=$2) events,
      (select count(*)::int from api_audit_log
        where organization_id=$1 and resource_id=$2 and action='crm_order.check_recorded') audits`,
    [ORG_A, orderId],
  );
  return result.rows[0] as { receipts: number; events: number; audits: number };
}

beforeAll(async () => {
  await pool.query(
    `insert into auth.users(id,email) values
      ($1,'f02-t12-agent-a@integration.test'),($2,'f02-t12-agent-b@integration.test'),
      ($3,'f02-t12-viewer-a@integration.test'),($4,'f02-t12-revoked-a@integration.test'),
      ($5,'f02-t12-platform-a@integration.test')`,
    [AGENT_A, AGENT_B, VIEWER_A, REVOKED_A, PLATFORM_A],
  );
  await pool.query(
    `insert into organizations(id,slug,legal_name,display_name) values
      ($1,'f02-t12-int-a','F02 T12 Integration A','F02 T12 A'),
      ($2,'f02-t12-int-b','F02 T12 Integration B','F02 T12 B')`,
    [ORG_A, ORG_B],
  );
  await pool.query(
    `insert into user_organizations(organization_id,user_id,role,accepted_at,revoked_at) values
      ($1,$2,'agent',now(),null),($3,$4,'agent',now(),null),
      ($1,$5,'viewer',now(),null),($1,$6,'agent',now(),now()),
      ($1,$7,'agent',now(),null)`,
    [ORG_A, AGENT_A, ORG_B, AGENT_B, VIEWER_A, REVOKED_A, PLATFORM_A],
  );
  await pool.query(
    "insert into platform_admins(user_id,granted_by,scope,mfa_required,reason) values($1,$1,'full',false,'F02 T12 test')",
    [PLATFORM_A],
  );
  await pool.query(
    "insert into contacts(id,organization_id,display_name) values($1,$2,'Contato A'),($3,$4,'Contato B')",
    [CONTACT_A, ORG_A, CONTACT_B, ORG_B],
  );
});

afterAll(async () => pool.end());

describe("serviço transacional de conferência de pedidos", () => {
  it("grava evento, receipt e audit atomicamente sem alterar pedido ou item", async () => {
    const draft = await createOrder();
    const item = draft.order.items[0]!;
    const before = await pool.query(
      `select o.status,o.revision,o.total_cents,i.quantity::text,i.sale_unit_snapshot
         from crm_orders o join crm_order_items i
           on i.organization_id=o.organization_id and i.order_id=o.id
        where o.organization_id=$1 and o.id=$2 and i.id=$3`,
      [ORG_A, draft.order.id, item.id],
    );
    const result = await check(
      draft.order.id,
      checkCommand(item.id, "1.000"),
      `check-atomic-${randomUUID()}`,
    );
    expect(result.replayed).toBe(false);
    expect(result.check).toMatchObject({
      order_id: draft.order.id,
      order_revision: 1,
      item_id: item.id,
      ordered_quantity: "2.000",
      checked_quantity: "1.000",
      sale_unit: "kg",
      state: "partial",
      checked_by_user_id: AGENT_A,
    });
    expect(await effects(draft.order.id)).toEqual({ receipts: 1, events: 1, audits: 1 });
    const after = await pool.query(
      `select o.status,o.revision,o.total_cents,i.quantity::text,i.sale_unit_snapshot
         from crm_orders o join crm_order_items i
           on i.organization_id=o.organization_id and i.order_id=o.id
        where o.organization_id=$1 and o.id=$2 and i.id=$3`,
      [ORG_A, draft.order.id, item.id],
    );
    expect(after.rows).toEqual(before.rows);
    const audit = await pool.query(
      `select metadata from api_audit_log
        where organization_id=$1 and resource_id=$2 and action='crm_order.check_recorded'`,
      [ORG_A, draft.order.id],
    );
    expect(audit.rows[0]?.metadata).toMatchObject({
      event_id: result.check.event_id,
      item_id: item.id,
      order_revision: 1,
      fields_changed: ["checked_quantity"],
    });
    expect(JSON.stringify(audit.rows[0]?.metadata)).not.toContain("Produto fictício");
  });

  it("classifica zero, parcial e total pela quantidade pedida sem conversão de unidade", async () => {
    const draft = await createOrder();
    const itemId = draft.order.items[0]!.id;
    const pending = await check(draft.order.id, checkCommand(itemId, "0"));
    const partial = await check(draft.order.id, checkCommand(itemId, "0.500"));
    const checked = await check(draft.order.id, checkCommand(itemId, "2.000"));
    expect([pending.check.state, partial.check.state, checked.check.state]).toEqual([
      "pending",
      "partial",
      "checked",
    ]);
    expect([pending.check.checked_quantity, partial.check.checked_quantity]).toEqual([
      "0.000",
      "0.500",
    ]);
    expect(new Set([pending.check.event_sequence, partial.check.event_sequence, checked.check.event_sequence]).size).toBe(3);
  });

  it("aceita somente zero quando a quantidade pedida está pendente", async () => {
    const draft = await createOrder(undefined, undefined, [
      orderItem({ quantity: null, unit_price_cents: null }),
    ]);
    const itemId = draft.order.items[0]!.id;
    await expect(check(draft.order.id, checkCommand(itemId, "0"))).resolves.toMatchObject({
      check: { state: "pending", ordered_quantity: null, checked_quantity: "0.000" },
    });
    await expect(check(draft.order.id, checkCommand(itemId, "0.001"))).rejects.toMatchObject({
      code: "ordered_quantity_unavailable",
      status: 422,
    });
    await expect(check(draft.order.id, checkCommand(itemId, "2.001"))).rejects.toMatchObject({
      code: "ordered_quantity_unavailable",
      status: 422,
    });
    expect(await effects(draft.order.id)).toEqual({ receipts: 1, events: 1, audits: 1 });
  });

  it("exige unidade explícita para quantidade positiva e ainda permite zero pendente", async () => {
    const draft = await createOrder(undefined, undefined, [orderItem({ sale_unit: null })]);
    const itemId = draft.order.items[0]!.id;
    await expect(check(draft.order.id, checkCommand(itemId, "0"))).resolves.toMatchObject({
      check: { state: "pending", sale_unit: null },
    });
    await expect(check(draft.order.id, checkCommand(itemId, "1.000"))).rejects.toMatchObject({
      code: "sale_unit_unavailable",
      status: 422,
    });
    expect(await effects(draft.order.id)).toEqual({ receipts: 1, events: 1, audits: 1 });
  });

  it("recusa quantidade maior e item de outro pedido/tenant sem efeito parcial", async () => {
    const draft = await createOrder();
    const otherA = await createOrder();
    const foreign = await createOrder(ctxB, humanB, [orderItem()], CONTACT_B);
    const itemId = draft.order.items[0]!.id;
    await expect(check(draft.order.id, checkCommand(itemId, "2.001"))).rejects.toMatchObject({
      code: "checked_quantity_exceeds_ordered",
      status: 422,
    });
    await expect(
      check(draft.order.id, checkCommand(otherA.order.items[0]!.id, "1.000")),
    ).rejects.toMatchObject({ code: "item_not_found", status: 404 });
    await expect(
      check(foreign.order.id, checkCommand(foreign.order.items[0]!.id, "1.000")),
    ).rejects.toMatchObject({ code: "order_not_found", status: 404 });
    expect(await effects(draft.order.id)).toEqual({ receipts: 0, events: 0, audits: 0 });
  });

  it("faz replay fiel e recusa reutilização divergente da chave", async () => {
    const draft = await createOrder();
    const itemId = draft.order.items[0]!.id;
    const key = randomUUID();
    const command = checkCommand(itemId, "1.000", 1, key);
    const original = await check(draft.order.id, command);
    await check(draft.order.id, checkCommand(itemId, "2.000"));
    const replay = await check(draft.order.id, command);
    expect(replay).toEqual({ check: original.check, replayed: true });
    await expect(
      check(draft.order.id, { ...command, checked_quantity: "0.500" }),
    ).rejects.toMatchObject({ code: "idempotency_conflict", status: 409 });
    expect(await effects(draft.order.id)).toEqual({ receipts: 2, events: 2, audits: 2 });
  });

  it("serializa chamadas concorrentes da mesma chave em um único efeito", async () => {
    const draft = await createOrder();
    const command = checkCommand(draft.order.items[0]!.id, "1.000");
    const results = await Promise.all([
      check(draft.order.id, command),
      check(draft.order.id, command),
    ]);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(new Set(results.map((result) => result.check.event_id)).size).toBe(1);
    expect(await effects(draft.order.id)).toEqual({ receipts: 1, events: 1, audits: 1 });
  });

  it("mantém conferência anterior histórica e rejeita revisão comercial vencida", async () => {
    const draft = await createOrder();
    const item = draft.order.items[0]!;
    const historical = await check(draft.order.id, checkCommand(item.id, "1.000"));
    await executeOrderCommand(
      ctxA,
      humanA,
      {
        command: "edit_order",
        idempotency_key: `check-edit-${randomUUID()}`,
        order_id: draft.order.id,
        expected_revision: 1,
        channel: "phone",
      },
      { pool },
    );
    await expect(check(draft.order.id, checkCommand(item.id, "2.000", 1))).rejects.toMatchObject({
      code: "revision_conflict",
      status: 409,
    });
    const view = await pool.query("select public.fn_crm_order_checks($1,$2,50,null) data", [
      ORG_A,
      draft.order.id,
    ]);
    expect(view.rows[0]?.data).toMatchObject({
      order_id: draft.order.id,
      order_revision: 2,
      items: [
        expect.objectContaining({
          item_id: item.id,
          state: "pending",
          checked_quantity: "0.000",
          event_id: null,
        }),
      ],
      history: [expect.objectContaining({ event_id: historical.check.event_id, order_revision: 1 })],
    });
    expect(await effects(draft.order.id)).toEqual({ receipts: 1, events: 1, audits: 1 });
  });

  it("permite remover o item sem apagar o evento histórico", async () => {
    const draft = await createOrder();
    const itemId = draft.order.items[0]!.id;
    const recorded = await check(draft.order.id, checkCommand(itemId, "2.000"));
    await executeOrderCommand(
      ctxA,
      humanA,
      {
        command: "edit_order",
        idempotency_key: `check-remove-${randomUUID()}`,
        order_id: draft.order.id,
        expected_revision: 1,
        items: [],
      },
      { pool },
    );
    const stored = await pool.query(
      `select
        (select count(*)::int from crm_order_items where organization_id=$1 and id=$2) items,
        (select count(*)::int from crm_order_check_events where organization_id=$1 and id=$3) events`,
      [ORG_A, itemId, recorded.check.event_id],
    );
    expect(stored.rows[0]).toEqual({ items: 0, events: 1 });
  });

  it("nega viewer, revogado, plataforma direta e executor não humano antes do replay", async () => {
    const draft = await createOrder();
    const command = checkCommand(draft.order.items[0]!.id, "1.000");
    const attempts = [
      () => recordOrderCheck(
        { ...ctxA, user_id: VIEWER_A, role: "viewer" },
        { type: "human", user_id: VIEWER_A },
        draft.order.id,
        command,
        { pool },
      ),
      () => recordOrderCheck(
        { ...ctxA, user_id: REVOKED_A },
        { type: "human", user_id: REVOKED_A },
        draft.order.id,
        command,
        { pool },
      ),
      () => recordOrderCheck(
        { ...ctxA, user_id: PLATFORM_A },
        { type: "human", user_id: PLATFORM_A },
        draft.order.id,
        command,
        { pool },
      ),
      () =>
        recordOrderCheck(
          ctxA,
          { type: "automation", run_id: randomUUID() },
          draft.order.id,
          command,
          { pool },
        ),
    ];
    for (const attempt of attempts)
      await expect(attempt()).rejects.toMatchObject({ status: 403 });
    expect(await effects(draft.order.id)).toEqual({ receipts: 0, events: 0, audits: 0 });
  });

  it("reverte evento e receipt quando a auditoria falha", async () => {
    const draft = await createOrder();
    await pool.query(`
      create function public.test_f02_t12_reject_audit() returns trigger language plpgsql
      set search_path='' as $$ begin
        if new.action='crm_order.check_recorded' then raise exception 'test_reject_check_audit'; end if;
        return new;
      end $$;
      create trigger test_f02_t12_reject_audit before insert on public.api_audit_log
      for each row execute function public.test_f02_t12_reject_audit();
    `);
    try {
      await expect(
        check(draft.order.id, checkCommand(draft.order.items[0]!.id, "1.000")),
      ).rejects.toThrow("test_reject_check_audit");
      expect(await effects(draft.order.id)).toEqual({ receipts: 0, events: 0, audits: 0 });
    } finally {
      await pool.query("drop trigger test_f02_t12_reject_audit on public.api_audit_log");
      await pool.query("drop function public.test_f02_t12_reject_audit()");
    }
  });

  it("exporta histórico do titular sem recibo, chave, hash ou dados do outro tenant", async () => {
    const draftA = await createOrder();
    const draftB = await createOrder(ctxB, humanB, [orderItem()], CONTACT_B);
    const checkA = await check(draftA.order.id, checkCommand(draftA.order.items[0]!.id, "1.000"));
    const checkB = await recordOrderCheck(
      ctxB,
      humanB,
      draftB.order.id,
      checkCommand(draftB.order.items[0]!.id, "2.000"),
      { pool },
    );
    const exported = await collectOperationalOrderExport(ctxA, CONTACT_A, { pool });
    expect(exported.checks).toContainEqual(
      expect.objectContaining({
        event_id: checkA.check.event_id,
        order_id: draftA.order.id,
        item_id: draftA.order.items[0]!.id,
        checked_quantity: "1.000",
      }),
    );
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain(checkB.check.event_id);
    expect(serialized).not.toContain("idempotency_key");
    expect(serialized).not.toContain("request_hash");
  });
});
