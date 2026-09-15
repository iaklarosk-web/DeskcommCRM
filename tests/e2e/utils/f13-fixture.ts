import { randomUUID } from "node:crypto";

import { f02E2eSandbox } from "./f02-crm-cadastros";
import { cleanupF11F12, seedF11F12, type F11F12Fixture, type LimpezaF11F12 } from "./f11-f12-fixture";

/**
 * A FIXTURE DA F13 (ADR-034 §2 T06): a de F11/F12 (A pelo seed quando
 * `E2E_TENANT` está posto, B fictícia, `admin` das duas, `dono` da plataforma)
 * mais DOIS attendants membros das duas organizações — sem eles não há
 * rodízio para medir. Cria só o que precisa, apaga só o que criou e CONFERE
 * que não sobrou linha nas tabelas que as jornadas de F13 escrevem.
 */
export interface F13Fixture extends F11F12Fixture {
  attendants: Array<{ id: string; email: string }>;
}

const TABELAS_DA_F13 = ["crm_leads", "crm_lead_links", "crm_lead_activities", "crm_companies", "crm_orders", "tenant_settings"] as const;

export async function seedF13(): Promise<F13Fixture> {
  const base = await seedF11F12();
  const db = f02E2eSandbox();
  const fixture: F13Fixture = { ...base, attendants: [] };
  try {
    for (const n of [1, 2]) {
      const email = `f13-att${n}-${base.suffix}@example.test`;
      const r = await db.auth.admin.createUser({ email, password: base.password, email_confirm: true, user_metadata: { full_name: `Atendente ${n} ${base.suffix}` } });
      if (r.error || !r.data.user) throw r.error ?? new Error(`usuário ${email} não criado`);
      fixture.attendants.push({ id: r.data.user.id, email });
      for (const lado of ["A", "B"] as const) {
        const m = await db.from("user_organizations").insert({ organization_id: base.orgs[lado], user_id: r.data.user.id, role: "agent", accepted_at: new Date().toISOString() });
        if (m.error) throw m.error;
      }
    }
    return fixture;
  } catch (erro) {
    await cleanupF13(fixture);
    throw erro;
  }
}

export interface LimpezaF13 extends LimpezaF11F12 {
  f13_tables_checked: number;
  f13_rows_remaining: number;
}

export async function cleanupF13(fixture: F13Fixture): Promise<LimpezaF13> {
  const db = f02E2eSandbox();
  const organizacoes = [fixture.orgs.A, fixture.orgs.B].filter(Boolean);
  const base = await cleanupF11F12(fixture);
  let usuarios = base.deleted_users;
  const falhas: string[] = [];
  for (const a of fixture.attendants) {
    const r = await db.auth.admin.deleteUser(a.id);
    if (r.error) falhas.push(`atendente: ${r.error.message}`);
    else usuarios++;
  }
  let restantes = 0;
  for (const tabela of TABELAS_DA_F13) {
    const c = await db.from(tabela as never).select("*", { count: "exact", head: true }).in("organization_id", organizacoes);
    if (c.error) falhas.push(`${tabela}: ${c.error.message}`);
    else restantes += c.count ?? 0;
  }
  if (falhas.length > 0) throw new Error(`Limpeza F13 incompleta: ${falhas.join("; ")}`);
  return { ...base, deleted_users: usuarios, f13_tables_checked: TABELAS_DA_F13.length, f13_rows_remaining: restantes };
}
