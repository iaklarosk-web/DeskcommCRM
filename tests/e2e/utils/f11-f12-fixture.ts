import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { f02E2eSandbox } from "./f02-crm-cadastros";
import { criarOrganizacaoDaFixture } from "./tenant-do-seed";

/**
 * A FIXTURE DAS DUAS ORGANIZAÇÕES da administração e da cobrança (F11-T06,
 * F12-T08). Mesmo contrato das fixtures de F02–F05: A pelo seed quando
 * `E2E_TENANT` está posto (ADR-029 §2), B fictícia; as duas nascem com
 * assinatura ATIVA em PLAN_A (o loader grava `seed`, o insert fictício grava
 * `fixture`) — `criarOrganizacaoDaFixture` cuida disso. Cria só o que precisa,
 * apaga só o que criou e CONFERE que não sobrou linha.
 *
 * ## Quem existe
 *
 * - `admin`: `tenant_admin` (papel herdado `admin`) das DUAS organizações — é
 *   quem vê `/app/billing`, contrata, troca de plano e cancela.
 * - `dono`: `platform_admin` (linha em `platform_admins`, `mfa_required=false`
 *   como nas fixtures de F02) SEM membership em A nem em B — é quem abre
 *   `/admin/tenants`, `/admin/billing` e o acompanhamento só leitura. Tem a
 *   própria organização `H` (`home`) para poder logar em `/app` antes de
 *   acompanhar, como o dono real terá.
 *
 * ## Nada real é tocado
 *
 * Gateway `mock` (a "página de pagamento" é `/app/billing/mock-checkout`), IA
 * e WhatsApp em mock, nenhum e-mail — D11/D12/D51.
 */

export type LadoDoTeste = "A" | "B";

export interface F11F12Fixture {
  suffix: string;
  password: string;
  admin: { id: string; email: string };
  dono: { id: string; email: string; home: string };
  orgs: Record<LadoDoTeste, string>;
}

/** Tabelas tenant-aware que as jornadas escrevem, conferidas na limpeza. */
const TABELAS_DO_DOMINIO = [
  "subscriptions",
  "billing_events",
  "invoices",
  "platform_support_sessions",
  "user_organizations",
  "notifications",
] as const;

async function criarUsuario(db: SupabaseClient, email: string, password: string, nome: string): Promise<string> {
  const r = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: nome } });
  if (r.error || !r.data.user) throw r.error ?? new Error(`usuário ${email} não criado`);
  return r.data.user.id;
}

export async function seedF11F12(): Promise<F11F12Fixture> {
  const db = f02E2eSandbox();
  const suffix = randomUUID().slice(0, 8);
  const password = `F11-local-${randomUUID()}!`;
  const fixture: F11F12Fixture = {
    suffix,
    password,
    admin: { id: "", email: `f11-admin-${suffix}@example.test` },
    dono: { id: "", email: `f11-dono-${suffix}@example.test`, home: "" },
    orgs: { A: "", B: "" },
  };
  try {
    fixture.admin.id = await criarUsuario(db, fixture.admin.email, password, `Admin ${suffix}`);
    fixture.dono.id = await criarUsuario(db, fixture.dono.email, password, `Dono ${suffix}`);

    for (const lado of ["A", "B"] as const) {
      fixture.orgs[lado] = await criarOrganizacaoDaFixture(db, lado, suffix, {
        slug: `f11-${lado.toLowerCase()}-${suffix}`,
        display_name: `F11 Empresa ${lado} ${suffix}`,
        legal_name: `F11 Empresa ${lado} ${suffix} Ltda.`,
      });
      const membro = await db.from("user_organizations").insert({
        organization_id: fixture.orgs[lado],
        user_id: fixture.admin.id,
        role: "admin",
        accepted_at: new Date().toISOString(),
      });
      if (membro.error) throw membro.error;
    }

    // A organização "casa" do dono: fictícia, sempre (não é lado da prova).
    const home = await db
      .from("organizations")
      .insert({
        slug: `f11-home-${suffix}`,
        display_name: `F11 Home ${suffix}`,
        legal_name: `F11 Home ${suffix}`,
        status: "active",
        onboarded_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (home.error || !home.data) throw home.error ?? new Error("organização home não criada");
    fixture.dono.home = (home.data as { id: string }).id;
    const membroHome = await db.from("user_organizations").insert({
      organization_id: fixture.dono.home,
      user_id: fixture.dono.id,
      role: "admin",
      accepted_at: new Date().toISOString(),
    });
    if (membroHome.error) throw membroHome.error;
    const pa = await db.from("platform_admins").insert({
      user_id: fixture.dono.id,
      granted_by: fixture.dono.id,
      scope: "full",
      mfa_required: false,
      reason: "F11 E2E: dono fictício da plataforma",
    });
    if (pa.error) throw pa.error;
    return fixture;
  } catch (erro) {
    await cleanupF11F12(fixture);
    throw erro;
  }
}

export interface LimpezaF11F12 {
  deleted_organizations: number;
  deleted_users: number;
  domain_tables_checked: number;
  domain_rows_remaining: number;
}

export async function cleanupF11F12(fixture: F11F12Fixture): Promise<LimpezaF11F12> {
  const db = f02E2eSandbox();
  const falhas: string[] = [];
  const organizacoes = [fixture.orgs.A, fixture.orgs.B, fixture.dono.home].filter(Boolean);
  let apagadas = 0;
  let usuarios = 0;

  if (fixture.dono.id) {
    const grant = await db.from("platform_admins").delete().eq("user_id", fixture.dono.id);
    if (grant.error) falhas.push(`platform_admins: ${grant.error.message}`);
  }
  for (const id of organizacoes) {
    const r = await db.from("organizations").delete().eq("id", id).select("id");
    if (r.error) falhas.push(`organização: ${r.error.message}`);
    else apagadas += r.data.length;
  }
  for (const u of [fixture.admin.id, fixture.dono.id].filter(Boolean)) {
    const r = await db.auth.admin.deleteUser(u);
    if (r.error) falhas.push(`usuário: ${r.error.message}`);
    else usuarios++;
  }
  let restantes = 0;
  if (organizacoes.length > 0) {
    for (const tabela of TABELAS_DO_DOMINIO) {
      const c = await db.from(tabela as never).select("*", { count: "exact", head: true }).in("organization_id", organizacoes);
      if (c.error) falhas.push(`${tabela}: ${c.error.message}`);
      else restantes += c.count ?? 0;
    }
  }
  if (falhas.length > 0) throw new Error(`Limpeza F11/F12 incompleta: ${falhas.join("; ")}`);
  return {
    deleted_organizations: apagadas,
    deleted_users: usuarios,
    domain_tables_checked: TABELAS_DO_DOMINIO.length,
    domain_rows_remaining: restantes,
  };
}
