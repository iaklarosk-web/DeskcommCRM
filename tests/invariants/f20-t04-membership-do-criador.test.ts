/**
 * F20-T04 — criar tenant para OUTRA pessoa não deixa o criador dentro
 * (ADR-045 §5; D60).
 *
 * `fn_create_tenant_with_owner` inseria, sem condição,
 * `user_organizations(org, ator, 'admin', accepted_at = now())`: o
 * `platform_admin` virava admin definitivo de toda empresa que criasse, sem
 * motivo, sem prazo e fora do acompanhamento só-leitura de D51 — que exige
 * motivo (10–500), escopo e vencimento, tudo auditado. Era uma porta lateral
 * sobre o próprio desenho de suporte (VARREDURA §B28).
 *
 * A regra nova: a membership do criador nasce SÓ quando o convite é para ele
 * mesmo. Para outra pessoa, a empresa nasce com assinatura e convite pendente,
 * e com ZERO membros — e é por isso que esta task vem DEPOIS da ação de
 * convite no `/admin` (D60 b): sem ela, um convite que vencesse sem aceite
 * deixaria a organização órfã.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "@/tests/invariants/psql-transporte";

const ATOR = "f2000005-9000-4000-8000-000000000001";
const EMAIL_DO_ATOR = "dono.plataforma@f20.test";

function criarTenant(chave: string, slug: string, ownerEmail: string): string {
  const pedido = JSON.stringify({
    display_name: slug,
    slug,
    legal_name: slug,
    cnpj: null,
    plan: "PLAN_A",
    owner_email: ownerEmail,
  }).replace(/'/g, "''");
  return sql(
    `select public.fn_create_tenant_with_owner('${ATOR}', '${chave}', '${pedido}'::jsonb, 'abcdef') ->> 'id'`,
  ).trim().split("\n").map((l) => l.trim()).at(-1)!;
}

const membros = (org: string) =>
  sql(`select count(*) from public.user_organizations where organization_id = '${org}'`)
    .trim().split("\n").map((l) => l.trim()).at(-1);

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${ATOR}','${EMAIL_DO_ATOR}');
    insert into public.platform_admins (user_id, scope, granted_by, reason) values ('${ATOR}', 'full', '${ATOR}', 'prova do invariante F20-T04')
      on conflict (user_id) do nothing;
  `);
});

describe("F20-T04 — a membership do criador (D60)", () => {
  it("convite para o PRÓPRIO criador: ele entra como admin, como antes (criador_membro_quando_e_dele=1/1)", () => {
    const org = criarTenant("f2000005-1111-4000-8000-000000000001", "f20-para-mim", EMAIL_DO_ATOR);
    const linha = sql(`select role || '|' || (accepted_at is not null)::text from public.user_organizations
                        where organization_id = '${org}' and user_id = '${ATOR}'`)
      .trim().split("\n").map((l) => l.trim()).at(-1);
    expect(membros(org)).toBe("1");
    expect(linha).toBe("admin|true");
    console.info("f20-t04: criador_membro_quando_e_dele=1/1");
  });

  it("convite para OUTRA pessoa: a empresa nasce sem membro nenhum (criador_fora_quando_e_de_outro=1/1)", () => {
    const org = criarTenant("f2000005-2222-4000-8000-000000000002", "f20-para-outro", "cliente@empresa.test");
    expect(membros(org), "o criador entrou numa empresa que não é dele").toBe("0");
    // A empresa existe e está ativa: o que falta é a pessoa aceitar.
    const status = sql(`select status from public.organizations where id = '${org}'`)
      .trim().split("\n").map((l) => l.trim()).at(-1);
    expect(status).toBe("active");
    console.info("f20-t04: criador_fora_quando_e_de_outro=1/1 empresa_ativa=1/1");
  });

  it("o e-mail é comparado sem caixa e sem espaços — 'DONO.Plataforma@F20.test ' ainda é dele", () => {
    const org = criarTenant("f2000005-3333-4000-8000-000000000003", "f20-caixa-alta", " DONO.Plataforma@F20.test ");
    expect(membros(org)).toBe("1");
    console.info("f20-t04: comparacao_normalizada=1/1");
  });
});
