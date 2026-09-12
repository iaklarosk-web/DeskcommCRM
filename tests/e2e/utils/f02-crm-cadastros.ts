import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { isLoopbackHttpUrl } from "../../lib/loopback-url";

/**
 * Esta prova não usa `.env.local`: só aceita o ambiente que o Playwright
 * publicou e falha antes de criar dados se o host não for loopback.
 */
export function f02E2eSandbox() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const sandboxId = process.env.F02_E2E_SANDBOX_ID ?? "";
  if (!isLoopbackHttpUrl(url)) {
    throw new Error("F02 E2E recusado: NEXT_PUBLIC_SUPABASE_URL não é loopback.");
  }
  // Dois ambientes dedicados e NUNCA produção: o sandbox descartável do gate
  // e o staging desta VPS (ADR-028 §2), ambos em loopback — o marcador diz
  // qual, e o `verify.sh` confere as portas de cada um.
  if (sandboxId !== "f02-crm-cadastros-disposable" && sandboxId !== "crm-staging") {
    throw new Error("F02 E2E recusado: sandbox descartável dedicado não foi identificado.");
  }
  if (!serviceRole)
    throw new Error("F02 E2E recusado: service role ausente no ambiente do runner.");
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface F02Fixture {
  suffix: string;
  password: string;
  manager: { id: string; email: string };
  viewer: { id: string; email: string };
  orgA: string;
  orgB: string;
  contactId?: string;
  companyId?: string;
  productId?: string;
}

export async function seedF02Fixture(): Promise<F02Fixture> {
  const db = f02E2eSandbox();
  const suffix = randomUUID().slice(0, 8);
  const password = `F02-local-${randomUUID()}!`;
  const manager = { email: `f02-manager-${suffix}@example.test` };
  const viewer = { email: `f02-viewer-${suffix}@example.test` };
  const fixture: F02Fixture = {
    suffix,
    password,
    manager: { id: "", ...manager },
    viewer: { id: "", ...viewer },
    orgA: "",
    orgB: "",
  };
  try {
    for (const user of [fixture.manager, fixture.viewer]) {
      const { data, error } = await db.auth.admin.createUser({
        email: user.email,
        password,
        email_confirm: true,
      });
      if (error || !data.user) throw error ?? new Error("usuário de fixture não criado");
      user.id = data.user.id;
    }
    for (const name of ["A", "B"]) {
      const { data, error } = await db
        .from("organizations")
        .insert({
          slug: `f02-${name.toLowerCase()}-${suffix}`,
          display_name: `F02 ${name} ${suffix}`,
          legal_name: `F02 ${name} ${suffix} Ltda.`,
          status: "active",
          onboarded_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("organização de fixture não criada");
      if (name === "A") fixture.orgA = data.id;
      else fixture.orgB = data.id;
    }
    const memberships = [
      {
        organization_id: fixture.orgA,
        user_id: fixture.manager.id,
        role: "manager",
        accepted_at: new Date().toISOString(),
      },
      {
        organization_id: fixture.orgB,
        user_id: fixture.manager.id,
        role: "manager",
        accepted_at: new Date().toISOString(),
      },
      {
        organization_id: fixture.orgA,
        user_id: fixture.viewer.id,
        role: "viewer",
        accepted_at: new Date().toISOString(),
      },
    ];
    const { error } = await db.from("user_organizations").insert(memberships);
    if (error) throw error;
    return fixture;
  } catch (error) {
    await cleanupF02Fixture(fixture);
    throw error;
  }
}

/** Apaga somente ids registrados nesta execução; não busca nem varre dados alheios. */
export async function cleanupF02Fixture(fixture: F02Fixture): Promise<void> {
  const db = f02E2eSandbox();
  const failures: string[] = [];
  const remove = async (
    label: string,
    operation: PromiseLike<{ error: { message: string } | null }>,
  ) => {
    const { error } = await operation;
    if (error) failures.push(`${label}: ${error.message}`);
  };
  if (fixture.productId)
    await remove(
      "produto",
      db
        .from("catalog_products")
        .delete()
        .eq("id", fixture.productId)
        .eq("organization_id", fixture.orgA),
    );
  if (fixture.contactId)
    await remove(
      "contato",
      db.from("contacts").delete().eq("id", fixture.contactId).eq("organization_id", fixture.orgA),
    );
  if (fixture.companyId)
    await remove(
      "empresa",
      db
        .from("crm_companies")
        .delete()
        .eq("id", fixture.companyId)
        .eq("organization_id", fixture.orgA),
    );
  for (const orgId of [fixture.orgA, fixture.orgB].filter(Boolean)) {
    await remove(
      "membership da organização da fixture",
      db.from("user_organizations").delete().eq("organization_id", orgId),
    );
    await remove("organização da fixture", db.from("organizations").delete().eq("id", orgId));
  }
  for (const userId of [fixture.manager.id, fixture.viewer.id].filter(Boolean)) {
    await remove("usuário da fixture", db.auth.admin.deleteUser(userId));
  }
  if (failures.length > 0) throw new Error(`Cleanup F02 incompleto: ${failures.join("; ")}`);
}
