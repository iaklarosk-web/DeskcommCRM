import { createHash } from "node:crypto";
import { z } from "zod";

import type { ServicePool } from "@/src/tenant-context/db";
import {
  withTenant,
  type TenantCtx,
  type TenantDb,
} from "@/src/tenant-context";

import {
  authorizeOrderCommand,
  type TrustedOrderExecutor,
} from "./authorization";
import {
  orderCheckCommandSchema,
  orderCheckResultSchema,
  type OrderCheckCommand,
  type OrderCheckResult,
  type OrderCheckState,
} from "./checks-contracts";
import {
  canonicalQuantity,
  quantityToMilli,
} from "./quantities";

const orderIdSchema = z.uuid().transform((id) => id.toLowerCase());

export class OrderCheckServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "OrderCheckServiceError";
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

export function orderCheckCommandHash(
  orderId: string,
  command: OrderCheckCommand,
  userId: string,
): Buffer {
  const { idempotency_key: _key, ...body } = command;
  return createHash("sha256")
    .update(JSON.stringify(sorted({ actor: userId, order_id: orderId, body })))
    .digest();
}

function toMilli(quantity: string): bigint {
  return quantity === "0.000" ? 0n : quantityToMilli(quantity);
}

function stateFor(checked: bigint, ordered: bigint | null): OrderCheckState {
  if (checked === 0n) return "pending";
  if (ordered === null)
    throw new OrderCheckServiceError("ordered_quantity_unavailable", 422);
  if (checked > ordered)
    throw new OrderCheckServiceError("checked_quantity_exceeds_ordered", 422);
  return checked === ordered ? "checked" : "partial";
}

type StoredItem = { quantity: string | null; sale_unit_snapshot: string | null };

async function reserveReceipt(
  db: TenantDb,
  org: string,
  orderId: string,
  userId: string,
  command: OrderCheckCommand,
): Promise<{ id: string } | { replay: OrderCheckResult }> {
  const hash = orderCheckCommandHash(orderId, command, userId);
  const inserted = await db.query<{ id: string }>(
    `insert into public.crm_order_check_command_receipts
       (organization_id,operation,idempotency_key,request_hash,actor_user_id)
     values($1,'record_check',$2,$3,$4)
     on conflict(organization_id,operation,idempotency_key) do nothing
     returning id`,
    [org, command.idempotency_key, hash, userId],
  );
  const id = inserted.rows[0]?.id;
  if (id) return { id };

  const prior = await db.query<{
    request_hash: Buffer;
    actor_user_id: string;
    response_body: unknown;
  }>(
    `select request_hash,actor_user_id,response_body
       from public.crm_order_check_command_receipts
      where organization_id=$1 and operation='record_check' and idempotency_key=$2`,
    [org, command.idempotency_key],
  );
  const receipt = prior.rows[0];
  if (
    !receipt ||
    receipt.actor_user_id !== userId ||
    !receipt.request_hash.equals(hash)
  ) {
    throw new OrderCheckServiceError("idempotency_conflict", 409);
  }
  if (receipt.response_body === null)
    throw new OrderCheckServiceError("command_incomplete", 503);
  return { replay: orderCheckResultSchema.parse(receipt.response_body) };
}

export async function recordOrderCheck(
  ctx: TenantCtx,
  executor: TrustedOrderExecutor,
  rawOrderId: string,
  rawCommand: unknown,
  options: { pool?: ServicePool; requestId?: string } = {},
): Promise<{ check: OrderCheckResult; replayed: boolean }> {
  const orderId = orderIdSchema.parse(rawOrderId);
  const command = orderCheckCommandSchema.parse(rawCommand);
  return withTenant(
    ctx,
    async (db) => {
      await authorizeOrderCommand(db, ctx, executor, "orders.write");
      if (executor.type !== "human")
        throw new OrderCheckServiceError("executor_denied", 403);
      const org = ctx.organization_id;
      const userId = orderIdSchema.parse(executor.user_id);

      const preRead = await db.query<{ contact_id: string }>(
        `select contact_id from public.crm_orders
          where organization_id=$1 and id=$2`,
        [org, orderId],
      );
      const contactId = preRead.rows[0]?.contact_id;
      if (!contactId)
        throw new OrderCheckServiceError("order_not_found", 404);

      await db.query(`select public.fn_service_lock($1::uuid,$2::uuid)`, [
        org,
        contactId,
      ]);
      const contact = await db.query(
        `select id from public.contacts where organization_id=$1 and id=$2
          and not is_anonymized and is_merged_into is null for share`,
        [org, contactId],
      );
      if (contact.rowCount !== 1)
        throw new OrderCheckServiceError("contact_unavailable", 422);

      const receipt = await reserveReceipt(
        db,
        org,
        orderId,
        userId,
        command,
      );
      if ("replay" in receipt)
        return { check: receipt.replay, replayed: true };

      const order = await db.query<{ revision: number; contact_id: string }>(
        `select revision,contact_id from public.crm_orders
          where organization_id=$1 and id=$2 for update`,
        [org, orderId],
      );
      const current = order.rows[0];
      if (!current || current.contact_id !== contactId)
        throw new OrderCheckServiceError("revision_conflict", 409);
      if (current.revision !== command.expected_revision)
        throw new OrderCheckServiceError("revision_conflict", 409);

      const item = await db.query<StoredItem>(
        `select quantity::text quantity,sale_unit_snapshot
           from public.crm_order_items
          where organization_id=$1 and order_id=$2 and id=$3 for share`,
        [org, orderId, command.item_id],
      );
      const stored = item.rows[0];
      if (!stored) throw new OrderCheckServiceError("item_not_found", 404);

      const checkedMilli = toMilli(command.checked_quantity);
      const orderedMilli = stored.quantity
        ? quantityToMilli(stored.quantity)
        : null;
      const state = stateFor(checkedMilli, orderedMilli);
      if (checkedMilli > 0n && stored.sale_unit_snapshot === null)
        throw new OrderCheckServiceError("sale_unit_unavailable", 422);
      const eventNo = await db.query<{ next: number }>(
        `select coalesce(max(event_no),0)::int+1 next
           from public.crm_order_check_events
          where organization_id=$1 and order_id=$2 and order_revision=$3`,
        [org, orderId, current.revision],
      );
      const written = await db.query<{
        id: string;
        event_sequence: string;
        created_at: Date | string;
      }>(
        `insert into public.crm_order_check_events
          (organization_id,receipt_id,order_id,order_revision,event_no,item_id,
           ordered_quantity_snapshot,checked_quantity,sale_unit_snapshot,
           check_state,actor_user_id)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         returning id,event_sequence::text,created_at`,
        [
          org,
          receipt.id,
          orderId,
          current.revision,
          eventNo.rows[0]?.next,
          command.item_id,
          stored.quantity,
          command.checked_quantity,
          stored.sale_unit_snapshot,
          state,
          userId,
        ],
      );
      const event = written.rows[0];
      if (!event) throw new Error("order_check_event_not_written");
      const result = orderCheckResultSchema.parse({
        event_id: event.id,
        event_sequence: event.event_sequence,
        order_id: orderId,
        order_revision: current.revision,
        item_id: command.item_id,
        ordered_quantity:
          orderedMilli === null ? null : canonicalQuantity(orderedMilli),
        checked_quantity: canonicalQuantity(checkedMilli),
        sale_unit: stored.sale_unit_snapshot,
        state,
        checked_by_user_id: userId,
        checked_at: new Date(event.created_at).toISOString(),
      });

      await db.query(
        `insert into public.api_audit_log
          (organization_id,actor_user_id,action,resource_type,resource_id,
           request_id,bypassed_rls,metadata)
         values($1,$2,'crm_order.check_recorded','crm_orders',$3,$4,true,$5::jsonb)`,
        [
          org,
          userId,
          orderId,
          options.requestId ?? null,
          JSON.stringify({
            receipt_id: receipt.id,
            event_id: result.event_id,
            item_id: result.item_id,
            order_revision: result.order_revision,
            fields_changed: ["checked_quantity"],
          }),
        ],
      );
      const completed = await db.query(
        `update public.crm_order_check_command_receipts
            set order_id=$3,response_body=$4::jsonb,completed_at=now()
          where organization_id=$1 and id=$2`,
        [org, receipt.id, orderId, JSON.stringify(result)],
      );
      if (completed.rowCount !== 1)
        throw new Error("order_check_receipt_not_completed");
      return { check: result, replayed: false };
    },
    { pool: options.pool },
  );
}
