import { createHash } from "node:crypto";

import type pg from "pg";

import { orderCommandSchema, type OrderCommand } from "@/src/crm/orders/commands";
import type { OrderItemView } from "@/src/crm/orders/types";
import {
  F02FixtureError,
  materializeF02Fixtures,
  type F02FixtureDocument,
  type MaterializedFixtureOrder,
} from "../src/tenant-config/f02-fixtures";

type Db = Pick<pg.PoolClient, "query">;

const EVENT = {
  create_draft: "draft_created",
  confirm_order: "order_confirmed",
  cancel_order: "order_cancelled",
} as const;

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sorted(item)]),
    );
  }
  return value;
}

/** Mesmo envelope canônico do receipt real, sem executar o serviço. */
export function fixtureOrderCommandHash(command: OrderCommand, userId: string): Buffer {
  const { idempotency_key: _key, ...body } = command;
  return createHash("sha256")
    .update(JSON.stringify(sorted({ actor: userId, body })))
    .digest();
}

function commandItems(items: readonly OrderItemView[]) {
  return items.map(({ line_total_cents: _total, ...item }) => item);
}

function commandFor(
  order: MaterializedFixtureOrder,
  transition: MaterializedFixtureOrder["transitions"][number],
): OrderCommand {
  if (transition.operation === "create_draft") {
    return orderCommandSchema.parse({
      command: "create_draft",
      idempotency_key: transition.idempotencyKey,
      contact_id: order.initial.contact_id,
      company_id: order.initial.company_id,
      company_name: order.initial.company_name,
      channel: order.initial.channel,
      delivery_date: order.initial.delivery_date,
      currency: order.initial.currency,
      items: commandItems(order.initial.items),
    });
  }
  if (transition.operation === "confirm_order") {
    return orderCommandSchema.parse({
      command: "confirm_order",
      idempotency_key: transition.idempotencyKey,
      order_id: order.initial.id,
      expected_revision: 1,
    });
  }
  return orderCommandSchema.parse({
    command: "cancel_order",
    idempotency_key: transition.idempotencyKey,
    order_id: order.initial.id,
    expected_revision: 1,
    reason: order.cancellationReason,
  });
}

export function assertSandboxMarker(expected: string, actual: string | null): void {
  if (expected.trim().length < 16) throw new F02FixtureError("sandbox_marker_too_short");
  if (actual !== expected) throw new F02FixtureError("sandbox_marker_mismatch");
}

async function requireSandboxMarker(db: Db, expected: string): Promise<void> {
  const result = await db.query<{ marker: string | null }>(
    `select current_setting('crm.fictional_fixture_sandbox',true) as marker`,
  );
  assertSandboxMarker(expected, result.rows[0]?.marker ?? null);
}

async function requireSyntheticActor(
  db: Db,
  organizationId: string,
  email: string,
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `select u.id
       from auth.users u
       join public.user_organizations uo
         on uo.user_id=u.id and uo.organization_id=$1
      where u.email=$2 and u.email like '%.test'
        and uo.accepted_at is not null and uo.revoked_at is null`,
    [organizationId, email],
  );
  const id = result.rows[0]?.id;
  if (!id || result.rowCount !== 1) throw new F02FixtureError("fixture_actor_unavailable");
  return id;
}

async function requireNoForeignCommercialRows(
  db: Db,
  organizationId: string,
  allowed: {
    companies: readonly string[];
    contacts: readonly string[];
    products: readonly string[];
    orders: readonly string[];
    items: readonly string[];
    receipts: readonly string[];
    events: readonly string[];
    audits: readonly string[];
  },
): Promise<void> {
  const result = await db.query<Record<string, number>>(
    `select
      (select count(*)::int from public.crm_companies where organization_id=$1 and not(id=any($2::uuid[]))) companies,
      (select count(*)::int from public.contacts where organization_id=$1 and not(id=any($3::uuid[]))) contacts,
      (select count(*)::int from public.catalog_products where organization_id=$1 and not(id=any($4::uuid[]))) products,
      (select count(*)::int from public.crm_orders where organization_id=$1 and not(id=any($5::uuid[]))) crm_orders,
      (select count(*)::int from public.crm_order_items where organization_id=$1 and not(id=any($6::uuid[]))) items,
      (select count(*)::int from public.crm_order_command_receipts where organization_id=$1 and not(id=any($7::uuid[]))) receipts,
      (select count(*)::int from public.crm_order_events where organization_id=$1 and not(id=any($8::uuid[]))) events,
      (select count(*)::int from public.api_audit_log where organization_id=$1
         and resource_type='crm_orders' and not(id=any($9::uuid[]))) order_audits,
      (select count(*)::int from public.orders where organization_id=$1) legacy_orders,
      (select count(*)::int from public.crm_notes where organization_id=$1) notes,
      (select count(*)::int from public.crm_tasks where organization_id=$1 and order_id is not null) linked_tasks`,
    [
      organizationId,
      allowed.companies,
      allowed.contacts,
      allowed.products,
      allowed.orders,
      allowed.items,
      allowed.receipts,
      allowed.events,
      allowed.audits,
    ],
  );
  if (Object.values(result.rows[0] ?? {}).some((count) => Number(count) !== 0)) {
    throw new F02FixtureError("tenant_has_non_fixture_commercial_data");
  }
}

async function requireNoCrossTenantIdCollision(
  db: Db,
  organizationId: string,
  table: string,
  ids: readonly string[],
): Promise<void> {
  // table vem exclusivamente da lista literal abaixo, nunca de YAML/CLI.
  const result = await db.query(
    `select 1 from public.${table}
      where id=any($1::uuid[]) and organization_id is distinct from $2 limit 1`,
    [ids, organizationId],
  );
  if (result.rowCount !== 0) throw new F02FixtureError("fixture_global_id_collision");
}

async function countInsert(db: Db, sql: string, values: readonly unknown[]): Promise<number> {
  return (await db.query(sql, [...values])).rowCount ?? 0;
}

async function expectOne(db: Db, sql: string, values: readonly unknown[]): Promise<void> {
  const result = await db.query(sql, [...values]);
  if (result.rowCount !== 1) throw new F02FixtureError("fixture_existing_row_mismatch");
}

/**
 * Writer de bootstrap, chamado somente pelo create-tenant dentro da transação
 * já aberta. Ele não usa executeOrderCommand e não amplia a autorização de IA
 * ou automation no serviço operacional.
 */
export async function writeF02Fixtures(
  db: Db,
  organizationId: string,
  fixture: F02FixtureDocument,
  options: { sandboxMarker: string },
): Promise<{ rowsCreated: number }> {
  await requireSandboxMarker(db, options.sandboxMarker);
  const actorUserId = await requireSyntheticActor(db, organizationId, fixture.actor_email);
  const data = materializeF02Fixtures(fixture, organizationId);
  const itemIds = data.orders.flatMap((order) => order.final.items.map((item) => item.id));
  const transitions = data.orders.flatMap((order) => order.transitions);
  const allowed = {
    companies: data.companies.map((row) => row.id),
    contacts: data.contacts.map((row) => row.id),
    products: data.products.map((row) => row.id),
    orders: data.orders.map((row) => row.final.id),
    items: itemIds,
    receipts: transitions.map((row) => row.receiptId),
    events: transitions.map((row) => row.eventId),
    audits: transitions.map((row) => row.auditId),
  };
  await requireNoForeignCommercialRows(db, organizationId, allowed);
  for (const [table, ids] of [
    ["crm_companies", allowed.companies],
    ["contacts", allowed.contacts],
    ["catalog_products", allowed.products],
    ["crm_orders", allowed.orders],
    ["crm_order_items", allowed.items],
    ["crm_order_command_receipts", allowed.receipts],
    ["crm_order_events", allowed.events],
    ["api_audit_log", allowed.audits],
  ] as const) {
    await requireNoCrossTenantIdCollision(db, organizationId, table, ids);
  }

  let rowsCreated = 0;
  const fixtureTime = Math.min(
    ...fixture.orders.map((order) => new Date(order.created_at).getTime()),
  );
  const createdAt = new Date(fixtureTime).toISOString();
  for (const company of data.companies) {
    rowsCreated += await countInsert(
      db,
      `insert into public.crm_companies
        (id,organization_id,legal_name,trade_name,cnpj,created_at,updated_at)
       values ($1,$2,$3,$4,null,$5,$5) on conflict do nothing`,
      [company.id, organizationId, company.legal_name, company.trade_name, createdAt],
    );
    await expectOne(
      db,
      `select 1 from public.crm_companies where id=$1 and organization_id=$2
        and legal_name=$3 and trade_name is not distinct from $4 and cnpj is null
        and created_at=$5 and updated_at=$5`,
      [company.id, organizationId, company.legal_name, company.trade_name, createdAt],
    );
  }
  for (const contact of data.contacts) {
    rowsCreated += await countInsert(
      db,
      `insert into public.contacts
        (id,organization_id,display_name,phone_number,email,company_id,recurring,source,created_at,updated_at)
       values ($1,$2,$3,null,null,$4,$5,'manual',$6,$6) on conflict do nothing`,
      [
        contact.id,
        organizationId,
        contact.display_name,
        contact.companyId,
        contact.recurring,
        createdAt,
      ],
    );
    await expectOne(
      db,
      `select 1 from public.contacts where id=$1 and organization_id=$2
        and display_name=$3 and company_id=$4 and recurring=$5
        and name is null and phone_number is null and email is null and birthdate is null
        and cpf_encrypted is null and cpf_hash is null and not is_anonymized
        and not is_blocked and is_merged_into is null and source='manual'
        and tags='{}'::text[] and source_metadata='{}'::jsonb
        and created_at=$6 and updated_at=$6`,
      [
        contact.id,
        organizationId,
        contact.display_name,
        contact.companyId,
        contact.recurring,
        createdAt,
      ],
    );
  }
  for (const product of data.products) {
    rowsCreated += await countInsert(
      db,
      `insert into public.catalog_products
        (id,organization_id,codigo,nome,preco_cents,moeda,ativo,origem,sale_unit,created_at,updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,'manual',$8,$9,$9) on conflict do nothing`,
      [
        product.id,
        organizationId,
        product.codigo,
        product.nome,
        product.price_cents,
        product.currency,
        product.active,
        product.sale_unit,
        createdAt,
      ],
    );
    await expectOne(
      db,
      `select 1 from public.catalog_products where id=$1 and organization_id=$2
        and codigo=$3 and nome=$4 and preco_cents=$5 and moeda=$6 and ativo=$7
        and origem='manual' and sale_unit=$8 and descricao is null and marca is null
        and categoria is null and custo_cents is null and controla_estoque
        and quantidade=0 and imagem_url is null and created_at=$9 and updated_at=$9`,
      [
        product.id,
        organizationId,
        product.codigo,
        product.nome,
        product.price_cents,
        product.currency,
        product.active,
        product.sale_unit,
        createdAt,
      ],
    );
  }

  for (const order of data.orders) {
    const final = order.final;
    const finalTransition = order.transitions.at(-1)!;
    rowsCreated += await countInsert(
      db,
      `insert into public.crm_orders
        (id,organization_id,contact_id,company_id,company_name_snapshot,source,channel,
         delivery_date,status,revision,currency,total_cents,created_by_actor_type,
         created_by_actor_id,confirmed_at,confirmed_by_actor_type,confirmed_by_actor_id,
         status_changed_at,created_at,updated_at)
       values ($1,$2,$3,$4,$5,'ui',$6,$7,$8,$9,$10,$11,'user',$12,$13,$14,$15,$16,$17,$18)
       on conflict do nothing`,
      [
        final.id,
        organizationId,
        final.contact_id,
        final.company_id,
        final.company_name,
        final.channel,
        final.delivery_date,
        final.status,
        final.revision,
        final.currency,
        final.total_cents,
        actorUserId,
        final.confirmed_at,
        final.status === "confirmed" ? "user" : null,
        final.status === "confirmed" ? actorUserId : null,
        finalTransition.after.updated_at,
        final.created_at,
        final.updated_at,
      ],
    );
    await expectOne(
      db,
      `select 1 from public.crm_orders where id=$1 and organization_id=$2
        and contact_id=$3 and company_id=$4 and company_name_snapshot=$5
        and source='ui' and channel is not distinct from $6 and delivery_date is not distinct from $7::date
        and status=$8 and revision=$9 and currency is not distinct from $10
        and total_cents is not distinct from $11 and created_by_actor_type='user'
        and created_by_actor_id=$12 and confirmed_at is not distinct from $13::timestamptz
        and confirmed_by_actor_type is not distinct from $14
        and confirmed_by_actor_id is not distinct from $15::uuid
        and status_changed_at=$16 and created_at=$17 and updated_at=$18`,
      [
        final.id,
        organizationId,
        final.contact_id,
        final.company_id,
        final.company_name,
        final.channel,
        final.delivery_date,
        final.status,
        final.revision,
        final.currency,
        final.total_cents,
        actorUserId,
        final.confirmed_at,
        final.status === "confirmed" ? "user" : null,
        final.status === "confirmed" ? actorUserId : null,
        finalTransition.after.updated_at,
        final.created_at,
        final.updated_at,
      ],
    );
    for (const item of final.items) {
      rowsCreated += await countInsert(
        db,
        `insert into public.crm_order_items
          (id,organization_id,order_id,position,requested_text,product_id,product_name_snapshot,
           sale_unit_snapshot,quantity,unit_price_cents,currency_snapshot,line_total_cents,
           created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict (id) do nothing`,
        [
          item.id,
          organizationId,
          final.id,
          item.position,
          item.requested_text,
          item.product_id,
          item.product_name,
          item.sale_unit,
          item.quantity,
          item.unit_price_cents,
          item.currency,
          item.line_total_cents,
          final.created_at,
          final.updated_at,
        ],
      );
      await expectOne(
        db,
        `select 1 from public.crm_order_items where id=$1 and organization_id=$2 and order_id=$3
          and position=$4 and requested_text=$5 and product_id is not distinct from $6
          and product_name_snapshot is not distinct from $7 and sale_unit_snapshot is not distinct from $8
          and quantity is not distinct from $9::numeric and unit_price_cents is not distinct from $10
          and currency_snapshot is not distinct from $11 and line_total_cents is not distinct from $12
          and created_at=$13 and updated_at=$14`,
        [
          item.id,
          organizationId,
          final.id,
          item.position,
          item.requested_text,
          item.product_id,
          item.product_name,
          item.sale_unit,
          item.quantity,
          item.unit_price_cents,
          item.currency,
          item.line_total_cents,
          final.created_at,
          final.updated_at,
        ],
      );
    }
    for (const transition of order.transitions) {
      const command = commandFor(order, transition);
      const hash = fixtureOrderCommandHash(command, actorUserId);
      const happenedAt = transition.after.updated_at;
      rowsCreated += await countInsert(
        db,
        `insert into public.crm_order_command_receipts
          (id,organization_id,operation,idempotency_key,request_hash,actor_type,actor_id,
           order_id,response_body,completed_at,created_at)
         values ($1,$2,$3,$4,$5,'user',$6,$7,$8::jsonb,$9,$9) on conflict do nothing`,
        [
          transition.receiptId,
          organizationId,
          transition.operation,
          transition.idempotencyKey,
          hash,
          actorUserId,
          final.id,
          JSON.stringify(transition.after),
          happenedAt,
        ],
      );
      await expectOne(
        db,
        `select 1 from public.crm_order_command_receipts where id=$1 and organization_id=$2
          and operation=$3 and idempotency_key=$4 and request_hash=$5 and actor_type='user'
          and actor_id=$6 and order_id=$7 and response_body=$8::jsonb
          and completed_at=$9 and created_at=$9`,
        [
          transition.receiptId,
          organizationId,
          transition.operation,
          transition.idempotencyKey,
          hash,
          actorUserId,
          final.id,
          JSON.stringify(transition.after),
          happenedAt,
        ],
      );
      const changes = {
        before: transition.before,
        after: transition.after,
        ...(transition.operation === "cancel_order" ? { reason: order.cancellationReason } : {}),
      };
      rowsCreated += await countInsert(
        db,
        `insert into public.crm_order_events
          (id,organization_id,receipt_id,order_id,contact_id,order_revision,event_type,
           changes,actor_type,actor_id,created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'user',$9,$10) on conflict do nothing`,
        [
          transition.eventId,
          organizationId,
          transition.receiptId,
          final.id,
          final.contact_id,
          transition.revision,
          EVENT[transition.operation],
          JSON.stringify(changes),
          actorUserId,
          happenedAt,
        ],
      );
      await expectOne(
        db,
        `select 1 from public.crm_order_events where id=$1 and organization_id=$2
          and receipt_id=$3 and order_id=$4 and contact_id=$5 and order_revision=$6
          and event_type=$7 and changes=$8::jsonb and actor_type='user' and actor_id=$9
          and created_at=$10`,
        [
          transition.eventId,
          organizationId,
          transition.receiptId,
          final.id,
          final.contact_id,
          transition.revision,
          EVENT[transition.operation],
          JSON.stringify(changes),
          actorUserId,
          happenedAt,
        ],
      );
      rowsCreated += await countInsert(
        db,
        `insert into public.api_audit_log
          (id,organization_id,actor_user_id,action,resource_type,resource_id,request_id,
           bypassed_rls,metadata,created_at)
         values ($1,$2,$3,$4,'crm_orders',$5,$6,true,$7::jsonb,$8) on conflict do nothing`,
        [
          transition.auditId,
          organizationId,
          actorUserId,
          `crm_order.${EVENT[transition.operation]}`,
          final.id,
          transition.idempotencyKey,
          JSON.stringify({
            fixture: true,
            receipt_id: transition.receiptId,
            revision: transition.revision,
            status: transition.after.status,
          }),
          happenedAt,
        ],
      );
      await expectOne(
        db,
        `select 1 from public.api_audit_log where id=$1 and organization_id=$2
          and actor_user_id=$3 and action=$4 and resource_type='crm_orders'
          and resource_id=$5 and request_id=$6 and bypassed_rls
          and metadata=$7::jsonb and created_at=$8`,
        [
          transition.auditId,
          organizationId,
          actorUserId,
          `crm_order.${EVENT[transition.operation]}`,
          final.id,
          transition.idempotencyKey,
          JSON.stringify({
            fixture: true,
            receipt_id: transition.receiptId,
            revision: transition.revision,
            status: transition.after.status,
          }),
          happenedAt,
        ],
      );
    }
  }

  return { rowsCreated };
}

/** Hash apenas para relatórios de prova, sem conteúdo pessoal. */
export function fixtureShapeHash(fixture: F02FixtureDocument): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schema_version: fixture.schema_version,
        tenant_slug: fixture.tenant_slug,
        company_refs: fixture.companies.map((row) => row.ref),
        contact_refs: fixture.contacts.map((row) => row.ref),
        product_refs: fixture.products.map((row) => row.ref),
        order_refs: fixture.orders.map((row) => row.ref),
      }),
    )
    .digest("hex");
}
