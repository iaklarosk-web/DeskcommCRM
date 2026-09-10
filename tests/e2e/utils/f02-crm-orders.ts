import { randomUUID } from "node:crypto";
import { f02E2eSandbox, seedF02Fixture, type F02Fixture } from "./f02-crm-cadastros";

export type F02OrdersFixture = F02Fixture & {
  customers: Record<
    "A" | "B",
    { orgId: string; contactId: string; productId: string; companyId: string; name: string }
  >;
};

/** Estas organizações são novas e exclusivas deste teste; CASCADE limpa seu domínio. */
export async function cleanupF02Orders(fixture: F02Fixture) {
  const db = f02E2eSandbox();
  const errors: string[] = [];
  const organizations = [fixture.orgA, fixture.orgB].filter(Boolean);
  let deletedOrganizations = 0;
  let deletedUsers = 0;
  for (const id of organizations) {
    const result = await db.from("organizations").delete().eq("id", id).select("id");
    if (result.error) errors.push(`organização da fixture: ${result.error.message}`);
    else deletedOrganizations += result.data.length;
  }
  for (const user of [fixture.manager, fixture.viewer]) {
    if (!user.id) continue;
    const result = await db.auth.admin.deleteUser(user.id);
    if (result.error) errors.push(`usuário da fixture: ${result.error.message}`);
    else deletedUsers++;
  }
  const tables = [
    "crm_orders",
    "crm_order_items",
    "crm_order_events",
    "crm_order_command_receipts",
    "crm_tasks",
    "crm_notes",
    "crm_task_events",
    "crm_task_command_receipts",
    "crm_companies",
    "contacts",
    "catalog_products",
    "user_organizations",
  ] as const;
  for (const table of tables) {
    if (!organizations.length) continue;
    const remaining = await db
      .from(table)
      .select("*", { count: "exact", head: true })
      .in("organization_id", organizations);
    if (remaining.error || remaining.count !== 0) errors.push(`${table}: limpeza não comprovada`);
  }
  if (errors.length) throw new Error(`Cleanup de pedidos incompleto: ${errors.join("; ")}`);
  return {
    deleted_organizations: deletedOrganizations,
    deleted_users: deletedUsers,
    domain_tables_checked: tables.length,
    domain_rows_remaining: 0,
  };
}

export async function seedF02Orders(): Promise<F02OrdersFixture> {
  const fixture = await seedF02Fixture();
  const db = f02E2eSandbox();
  const customers = Object.fromEntries(
    (["A", "B"] as const).map((key) => [
      key,
      {
        orgId: key === "A" ? fixture.orgA : fixture.orgB,
        contactId: randomUUID(),
        productId: randomUUID(),
        companyId: randomUUID(),
        name: `Cliente de pedidos ${key} ${fixture.suffix}`,
      },
    ]),
  ) as F02OrdersFixture["customers"];
  try {
    for (const [key, data] of Object.entries(customers)) {
      const company = await db.from("crm_companies").insert({
        id: data.companyId,
        organization_id: data.orgId,
        legal_name: `Empresa ${data.name}`,
      });
      if (company.error) throw company.error;
      const contact = await db.from("contacts").insert({
        id: data.contactId,
        organization_id: data.orgId,
        display_name: data.name,
        company_id: data.companyId,
        recurring: true,
      });
      if (contact.error) throw contact.error;
      const product = await db.from("catalog_products").insert({
        id: data.productId,
        organization_id: data.orgId,
        codigo: `PED-${fixture.suffix}`,
        nome: `Produto de pedidos ${key} ${fixture.suffix}`,
        preco_cents: 1250,
        moeda: "BRL",
        sale_unit: "cx",
        ativo: true,
      });
      if (product.error) throw product.error;
    }
    return { ...fixture, customers };
  } catch (error) {
    await cleanupF02Orders(fixture);
    throw error;
  }
}
