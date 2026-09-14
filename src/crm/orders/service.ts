import { createHash, randomUUID } from "node:crypto";
import type { ServicePool } from "@/src/tenant-context/db";
import { withTenant, type TenantCtx, type TenantDb } from "@/src/tenant-context";
import { authorizeOrderCommand, type TrustedOrderExecutor } from "./authorization";
import { orderCommandSchema, type OrderCommand, type OrderItemCommand } from "./commands";
import { evaluateOrder } from "./completeness";
import { assertMatchingSaleUnit, OrderQuantityError } from "./quantities";
import { readOrder, writeOrderItems } from "./repository";
import { assertOrderEditable, assertOrderRevision, assertOrderTransition } from "./state";
import type { OrderPending, OrderView } from "./types";

export class OrderServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(code);
    this.name = "OrderServiceError";
  }
}

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

/** Recebe somente comando já validado/canonizado; transporte não entra no hash. */
export function orderCommandHash(command: OrderCommand, userId: string): Buffer {
  const { idempotency_key: _key, ...body } = command;
  return createHash("sha256")
    .update(JSON.stringify(sorted({ actor: userId, body })))
    .digest();
}

async function validateReferences(
  db: TenantDb,
  org: string,
  order: Pick<OrderView, "contact_id" | "company_id" | "items">,
  previous: OrderView | null,
): Promise<OrderPending[]> {
  const contact = await db.query(
    `select id from public.contacts where organization_id=$1 and id=$2
       and not is_anonymized and is_merged_into is null for share`,
    [org, order.contact_id],
  );
  if (contact.rowCount !== 1) throw new OrderServiceError("contact_unavailable", 422);
  if (order.company_id !== null) {
    const company = await db.query(
      `select id from public.crm_companies where organization_id=$1 and id=$2 for share`,
      [org, order.company_id],
    );
    if (company.rowCount !== 1) throw new OrderServiceError("company_unavailable", 422);
  }
  const ids = [
    ...new Set(order.items.flatMap((item) => (item.product_id ? [item.product_id] : []))),
  ].sort();
  const products = await db.query<{ id: string; ativo: boolean; sale_unit: string | null }>(
    `select id,ativo,sale_unit from public.catalog_products where organization_id=$1 and id=any($2::uuid[]) order by id for share`,
    [org, ids],
  );
  if (products.rows.length !== ids.length) throw new OrderServiceError("product_unavailable", 422);
  const byId = new Map(products.rows.map((row) => [row.id, row]));
  const pending: OrderPending[] = [];
  for (const item of order.items) {
    if (item.product_id === null) continue;
    const product = byId.get(item.product_id)!;
    const prior = previous?.items.find((entry) => entry.id === item.id);
    // Um catálogo alterado posteriormente não desfaz a condição já confirmada.
    const sameConfirmedUnit =
      previous !== null &&
      previous.status !== "draft" &&
      prior?.product_id === item.product_id &&
      prior.sale_unit === item.sale_unit;
    if (sameConfirmedUnit) continue;
    if (!product.ativo) pending.push({ code: "product_inactive", item_id: item.id });
    if (product.sale_unit === null)
      pending.push({ code: "catalog_sale_unit_required", item_id: item.id });
    else {
      try {
        assertMatchingSaleUnit(item.sale_unit, product.sale_unit);
      } catch (error) {
        if (!(error instanceof OrderQuantityError)) throw error;
        pending.push({ code: error.code, item_id: item.id });
      }
    }
  }
  return pending;
}

function checkItemIdentity(items: readonly OrderItemCommand[]): void {
  if (
    new Set(items.map((item) => item.id)).size !== items.length ||
    new Set(items.map((item) => item.position)).size !== items.length
  ) {
    throw new OrderServiceError("duplicate_item", 422);
  }
}

const EVENT = {
  create_draft: "draft_created",
  edit_order: "order_edited",
  confirm_order: "order_confirmed",
  advance_order: "order_advanced",
  cancel_order: "order_cancelled",
} as const;

export async function executeOrderCommand(
  ctx: TenantCtx,
  executor: TrustedOrderExecutor,
  raw: unknown,
  options: { pool?: ServicePool; requestId?: string } = {},
): Promise<{ order: OrderView; replayed: boolean }> {
  const command = orderCommandSchema.parse(raw);
  return withTenant(
    ctx,
    async (db) => {
      const permission = command.command === "confirm_order" ? "orders.confirm" : "orders.write";
      await authorizeOrderCommand(db, ctx, executor, permission);
      // O gate acima autentica a mesma identidade. Nenhum outro executor é exposto nesta fase.
      if (executor.type !== "human") throw new OrderServiceError("executor_denied", 403);
      const org = ctx.organization_id;
      const userId = executor.user_id;
      // A anonimização existente usa o mesmo mutex antes de bloquear contacts.
      // Adquira-o antes também do recibo, que a redação precisa atualizar.
      let lockedContactId: string | undefined;
      if (command.command === "create_draft") lockedContactId = command.contact_id;
      else {
        const preRead = await db.query<{ contact_id: string }>(
          `select contact_id from public.crm_orders where organization_id=$1 and id=$2`,
          [org, command.order_id],
        );
        lockedContactId = preRead.rows[0]?.contact_id;
      }
      if (lockedContactId) {
        await db.query(`select public.fn_service_lock($1::uuid,$2::uuid)`, [org, lockedContactId]);
        await db.query(
          `select id from public.contacts where organization_id=$1 and id=$2 for share`,
          [org, lockedContactId],
        );
      }
      const hash = orderCommandHash(command, userId);
      const inserted = await db.query<{ id: string }>(
        `insert into public.crm_order_command_receipts
        (organization_id,operation,idempotency_key,request_hash,actor_type,actor_id)
       values ($1,$2,$3,$4,'user',$5)
       on conflict (organization_id,operation,idempotency_key) do nothing returning id`,
        [org, command.command, command.idempotency_key, hash, userId],
      );
      const receiptId = inserted.rows[0]?.id;
      if (!receiptId) {
        const prior = await db.query<{
          request_hash: Buffer;
          actor_id: string;
          actor_type: string;
          response_body: OrderView | { redacted: true } | null;
        }>(
          `select request_hash,actor_id,actor_type,response_body from public.crm_order_command_receipts
          where organization_id=$1 and operation=$2 and idempotency_key=$3`,
          [org, command.command, command.idempotency_key],
        );
        const receipt = prior.rows[0];
        if (
          !receipt ||
          receipt.actor_type !== "user" ||
          receipt.actor_id !== userId ||
          !receipt.request_hash.equals(hash)
        ) {
          throw new OrderServiceError("idempotency_conflict", 409);
        }
        if (!receipt.response_body) throw new OrderServiceError("command_incomplete", 503);
        if ("redacted" in receipt.response_body) throw new OrderServiceError("order_redacted", 410);
        return { order: receipt.response_body, replayed: true };
      }

      let before: OrderView | null = null;
      let orderId: string;
      if (command.command === "create_draft") {
        orderId = randomUUID();
        checkItemIdentity(command.items);
        const values = evaluateOrder(command);
        await validateReferences(db, org, { ...command, items: values.items }, null);
        await db.query(
          `insert into public.crm_orders
          (id,organization_id,contact_id,company_id,company_name_snapshot,source,channel,delivery_date,
           currency,total_cents,created_by_actor_type,created_by_actor_id)
         values ($1,$2,$3,$4,$5,'ui',$6,$7,$8,$9,'user',$10)`,
          [
            orderId,
            org,
            command.contact_id,
            command.company_id,
            command.company_name,
            command.channel,
            command.delivery_date,
            command.currency,
            values.total_cents,
            userId,
          ],
        );
        await writeOrderItems(db, org, orderId, values.items);
      } else {
        orderId = command.order_id;
        before = await readOrder(db, org, orderId, true);
        if (!before) throw new OrderServiceError("order_not_found", 404);
        if (before.contact_id !== lockedContactId)
          throw new OrderServiceError("revision_conflict", 409);
        // No MVP a correção de cliente é cancelar e recriar, sem transferir
        // conteúdo pessoal e snapshots históricos entre contatos.
        if (
          command.command === "edit_order" &&
          command.contact_id !== undefined &&
          command.contact_id !== before.contact_id
        )
          throw new OrderServiceError("contact_change_not_allowed", 422);

        const contactAvailable = await db.query(
          `select id from public.contacts where organization_id=$1 and id=$2
             and not is_anonymized and is_merged_into is null for share`,
          [org, before.contact_id],
        );
        if (contactAvailable.rowCount !== 1)
          throw new OrderServiceError("contact_unavailable", 422);
        assertOrderRevision(before.revision, command.expected_revision);
        if (command.command === "edit_order") {
          assertOrderEditable(before.status, "human");
          const proposed = { ...before, ...command, items: command.items ?? before.items };
          checkItemIdentity(proposed.items);
          const values = evaluateOrder(proposed);
          const refs = await validateReferences(
            db,
            org,
            { ...proposed, items: values.items },
            before,
          );
          if (before.status !== "draft" && (values.pending.length || refs.length)) {
            throw new OrderServiceError("order_incomplete", 422, [...values.pending, ...refs]);
          }
          await db.query(
            `update public.crm_orders set contact_id=$3,company_id=$4,company_name_snapshot=$5,
             channel=$6,delivery_date=$7,currency=$8,total_cents=$9,revision=revision+1
           where organization_id=$1 and id=$2`,
            [
              org,
              orderId,
              proposed.contact_id,
              proposed.company_id,
              proposed.company_name,
              proposed.channel,
              proposed.delivery_date,
              proposed.currency,
              values.total_cents,
            ],
          );
          await writeOrderItems(db, org, orderId, values.items);
        } else {
          const next =
            command.command === "confirm_order"
              ? "confirmed"
              : command.command === "cancel_order"
                ? "cancelled"
                : command.next_status;
          assertOrderTransition(before.status, next, "human");
          if (next === "confirmed") {
            const refs = await validateReferences(db, org, before, null);
            const pending = evaluateOrder(before).pending;
            if (pending.length || refs.length)
              throw new OrderServiceError("order_incomplete", 422, [...pending, ...refs]);
          }
          await db.query(
            `update public.crm_orders set status=$3,revision=revision+1,status_changed_at=now(),
             confirmed_at=case when $3='confirmed' then now() else confirmed_at end,
             confirmed_by_actor_type=case when $3='confirmed' then 'user' else confirmed_by_actor_type end,
             confirmed_by_actor_id=case when $3='confirmed' then $4::uuid else confirmed_by_actor_id end
           where organization_id=$1 and id=$2`,
            [org, orderId, next, userId],
          );
        }
      }
      const after = await readOrder(db, org, orderId);
      if (!after) throw new Error("order_result_missing");
      const changes = {
        before,
        after,
        ...(command.command === "cancel_order" ? { reason: command.reason ?? null } : {}),
      };
      await db.query(
        `insert into public.crm_order_events
        (organization_id,receipt_id,order_id,contact_id,order_revision,event_type,changes,actor_type,actor_id)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,'user',$8)`,
        [
          org,
          receiptId,
          orderId,
          after.contact_id,
          after.revision,
          EVENT[command.command],
          JSON.stringify(changes),
          userId,
        ],
      );
      await db.query(
        `insert into public.api_audit_log
        (organization_id,actor_user_id,action,resource_type,resource_id,request_id,bypassed_rls,metadata)
       values ($1,$2,$3,'crm_orders',$4,$5,true,$6::jsonb)`,
        [
          org,
          userId,
          `crm_order.${EVENT[command.command]}`,
          orderId,
          options.requestId ?? null,
          JSON.stringify({ receipt_id: receiptId, revision: after.revision, status: after.status }),
        ],
      );
      await db.query(
        `update public.crm_order_command_receipts set order_id=$4,response_body=$5::jsonb,completed_at=now()
        where organization_id=$1 and operation=$2 and idempotency_key=$3 and id=$6`,
        [org, command.command, command.idempotency_key, orderId, JSON.stringify(after), receiptId],
      );
      return { order: after, replayed: false };
    },
    { pool: options.pool },
  );
}
