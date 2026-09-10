import { createHash } from "node:crypto";

import { z } from "zod";

import { evaluateOrder } from "@/src/crm/orders/completeness";
import { assertMatchingSaleUnit, parseBrazilianQuantity } from "@/src/crm/orders/quantities";
import type { OrderItemCommand } from "@/src/crm/orders/commands";
import type { OrderView } from "@/src/crm/orders/types";

const refSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const centsSchema = z.number().int().min(0).max(2_147_483_647);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const fictional = z.literal(true);

const companySchema = z.strictObject({
  ref: refSchema,
  fictional,
  legal_name: text(200),
  trade_name: text(200).nullable(),
});

const contactSchema = z.strictObject({
  ref: refSchema,
  fictional,
  display_name: text(200),
  company_ref: refSchema,
  recurring: z.boolean(),
});

const productSchema = z.strictObject({
  ref: refSchema,
  fictional,
  codigo: text(100),
  nome: text(200),
  sale_unit: text(32),
  price_cents: centsSchema,
  currency: currencySchema,
  active: z.boolean(),
});

const itemSchema = z.strictObject({
  ref: refSchema,
  fictional,
  position: z.number().int().min(1),
  requested_text: text(1000),
  product_ref: refSchema.nullable(),
  quantity_input: z.string().trim().min(1).max(100).nullable(),
});

const orderSchema = z.strictObject({
  ref: refSchema,
  fictional,
  contact_ref: refSchema,
  company_ref: refSchema,
  status: z.enum(["draft", "confirmed", "cancelled"]),
  cancellation_reason: text(500).nullable(),
  delivery_date: z.iso.date().nullable(),
  channel: text(64).nullable(),
  currency: currencySchema.nullable(),
  created_at: z.iso.datetime({ offset: true }),
  items: z.array(itemSchema).min(1).max(200),
});

const documentSchema = z.strictObject({
  fictional_only: z.literal(true),
  schema_version: z.literal(1),
  tenant_slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/),
  actor_email: z.email().endsWith(".test"),
  companies: z.array(companySchema).length(2),
  contacts: z.array(contactSchema).min(2).max(20),
  products: z.array(productSchema).min(1).max(50),
  orders: z.array(orderSchema).min(1).max(20),
});

export type F02FixtureDocument = z.infer<typeof documentSchema>;

export class F02FixtureError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "F02FixtureError";
  }
}

function duplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  return values.find((value) => (seen.has(value) ? true : !seen.add(value)));
}

/**
 * Valida o arquivo fictício inteiro sem consultar o banco. CNPJ, telefone e
 * email de contato nem pertencem ao schema strict, portanto não podem vazar
 * para esta via de bootstrap.
 */
export function parseF02Fixtures(
  raw: unknown,
  context: { tenantSlug: string; seedUserEmails: readonly string[] },
): F02FixtureDocument {
  const fixture = documentSchema.parse(raw);
  if (fixture.tenant_slug !== context.tenantSlug) {
    throw new F02FixtureError("fixture_tenant_mismatch");
  }
  if (!context.seedUserEmails.every((email) => email.endsWith(".test"))) {
    throw new F02FixtureError("fixture_seed_users_must_be_test_only");
  }
  if (!context.seedUserEmails.includes(fixture.actor_email)) {
    throw new F02FixtureError("fixture_actor_missing_from_seed");
  }

  for (const [kind, refs] of [
    ["company", fixture.companies.map((row) => row.ref)],
    ["contact", fixture.contacts.map((row) => row.ref)],
    ["product", fixture.products.map((row) => row.ref)],
    ["order", fixture.orders.map((row) => row.ref)],
  ] as const) {
    if (duplicate(refs)) throw new F02FixtureError(`fixture_duplicate_${kind}_ref`);
  }
  if (duplicate(fixture.products.map((row) => row.codigo))) {
    throw new F02FixtureError("fixture_duplicate_product_code");
  }

  const companyRefs = new Set(fixture.companies.map((row) => row.ref));
  const contactRefs = new Set(fixture.contacts.map((row) => row.ref));
  const productRefs = new Set(fixture.products.map((row) => row.ref));
  for (const contact of fixture.contacts) {
    if (!companyRefs.has(contact.company_ref)) {
      throw new F02FixtureError("fixture_unknown_company_ref");
    }
  }
  for (const order of fixture.orders) {
    if (!contactRefs.has(order.contact_ref)) {
      throw new F02FixtureError("fixture_unknown_contact_ref");
    }
    if (!companyRefs.has(order.company_ref)) {
      throw new F02FixtureError("fixture_unknown_company_ref");
    }
    const positions = order.items.map((item) => item.position);
    const itemRefs = order.items.map((item) => item.ref);
    if (duplicate(positions.map(String))) throw new F02FixtureError("fixture_duplicate_position");
    if (duplicate(itemRefs)) throw new F02FixtureError("fixture_duplicate_item_ref");
    for (const item of order.items) {
      if (item.product_ref !== null && !productRefs.has(item.product_ref)) {
        throw new F02FixtureError("fixture_unknown_product_ref");
      }
      if (item.product_ref === null && item.quantity_input !== null) {
        throw new F02FixtureError("fixture_quantity_without_product");
      }
    }
    if (order.status === "cancelled" && order.cancellation_reason === null) {
      throw new F02FixtureError("fixture_cancel_reason_required");
    }
    if (order.status !== "cancelled" && order.cancellation_reason !== null) {
      throw new F02FixtureError("fixture_cancel_reason_unexpected");
    }
  }
  return fixture;
}

/** UUID v8 determinístico e namespaced pelo UUID da organização. */
export function fixtureUuid(organizationId: string, kind: string, ref: string): string {
  const bytes = createHash("sha256")
    .update(`${organizationId}\0${kind}\0${ref}`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface MaterializedFixtureOrder {
  readonly ref: string;
  readonly initial: OrderView;
  readonly final: OrderView;
  readonly cancellationReason: string | null;
  readonly transitions: readonly {
    operation: "create_draft" | "confirm_order" | "cancel_order";
    revision: number;
    receiptId: string;
    eventId: string;
    auditId: string;
    idempotencyKey: string;
    before: OrderView | null;
    after: OrderView;
  }[];
}

export interface MaterializedF02Fixtures {
  readonly companies: readonly (F02FixtureDocument["companies"][number] & { id: string })[];
  readonly contacts: readonly (F02FixtureDocument["contacts"][number] & {
    id: string;
    companyId: string;
  })[];
  readonly products: readonly (F02FixtureDocument["products"][number] & { id: string })[];
  readonly orders: readonly MaterializedFixtureOrder[];
}

export function materializeF02Fixtures(
  fixture: F02FixtureDocument,
  organizationId: string,
): MaterializedF02Fixtures {
  const companies = fixture.companies.map((row) => ({
    ...row,
    id: fixtureUuid(organizationId, "company", row.ref),
  }));
  const companyByRef = new Map(companies.map((row) => [row.ref, row]));
  const contacts = fixture.contacts.map((row) => ({
    ...row,
    id: fixtureUuid(organizationId, "contact", row.ref),
    companyId: companyByRef.get(row.company_ref)!.id,
  }));
  const contactByRef = new Map(contacts.map((row) => [row.ref, row]));
  const products = fixture.products.map((row) => ({
    ...row,
    id: fixtureUuid(organizationId, "product", row.ref),
  }));
  const productByRef = new Map(products.map((row) => [row.ref, row]));

  const orders = fixture.orders.map((order): MaterializedFixtureOrder => {
    const id = fixtureUuid(organizationId, "order", order.ref);
    const contact = contactByRef.get(order.contact_ref)!;
    const company = companyByRef.get(order.company_ref)!;
    const itemCommands: OrderItemCommand[] = order.items.map((item) => {
      const product = item.product_ref === null ? null : productByRef.get(item.product_ref)!;
      const parsed =
        item.quantity_input === null ? null : parseBrazilianQuantity(item.quantity_input);
      if (parsed !== null && product !== null) {
        assertMatchingSaleUnit(parsed.requested_unit, product.sale_unit);
      }
      return {
        id: fixtureUuid(organizationId, "order-item", `${order.ref}:${item.ref}`),
        position: item.position,
        requested_text: item.requested_text,
        product_id: product?.id ?? null,
        product_name: product?.nome ?? null,
        sale_unit: product?.sale_unit ?? null,
        quantity: parsed?.quantity ?? null,
        unit_price_cents: product?.price_cents ?? null,
        currency: product?.currency ?? null,
      };
    });
    const evaluated = evaluateOrder({
      delivery_date: order.delivery_date,
      currency: order.currency,
      items: itemCommands,
    });
    if (order.status !== "draft" && evaluated.pending.length > 0) {
      throw new F02FixtureError("fixture_terminal_order_has_pending_fields");
    }
    const createdAt = new Date(order.created_at).toISOString();
    const initial: OrderView = {
      id,
      contact_id: contact.id,
      company_id: company.id,
      company_name: company.trade_name ?? company.legal_name,
      source: "ui",
      channel: order.channel,
      delivery_date: order.delivery_date,
      status: "draft",
      revision: 1,
      currency: order.currency,
      total_cents: evaluated.total_cents,
      created_at: createdAt,
      updated_at: createdAt,
      confirmed_at: null,
      items: evaluated.items,
      pending: evaluated.pending,
    };
    const finalAt = new Date(new Date(createdAt).getTime() + 1_000).toISOString();
    const final: OrderView =
      order.status === "draft"
        ? initial
        : {
            ...initial,
            status: order.status,
            revision: 2,
            updated_at: finalAt,
            confirmed_at: order.status === "confirmed" ? finalAt : null,
          };
    const operations = [
      { operation: "create_draft" as const, revision: 1, before: null, after: initial },
      ...(order.status === "confirmed"
        ? [
            {
              operation: "confirm_order" as const,
              revision: 2,
              before: initial,
              after: final,
            },
          ]
        : order.status === "cancelled"
          ? [
              {
                operation: "cancel_order" as const,
                revision: 2,
                before: initial,
                after: final,
              },
            ]
          : []),
    ];
    return {
      ref: order.ref,
      initial,
      final,
      cancellationReason: order.cancellation_reason,
      transitions: operations.map((transition) => ({
        ...transition,
        receiptId: fixtureUuid(
          organizationId,
          "order-receipt",
          `${order.ref}:${transition.revision}`,
        ),
        eventId: fixtureUuid(organizationId, "order-event", `${order.ref}:${transition.revision}`),
        auditId: fixtureUuid(organizationId, "order-audit", `${order.ref}:${transition.revision}`),
        idempotencyKey: `fixture:f02:v1:${order.ref}:${transition.operation}`,
      })),
    };
  });

  return { companies, contacts, products, orders };
}
