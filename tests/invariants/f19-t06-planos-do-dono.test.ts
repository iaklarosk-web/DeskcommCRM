/**
 * F19-T06 — a migration 9034 gravou a decisão D14/D58 nos planos (ADR-044 §2):
 * os três códigos PLAN_A/B/C existem com o NOME real, o PREÇO real em centavos
 * de BRL e `source='owner'`; nenhum continua placeholder; a reaplicação do
 * apêndice não muda nada (idempotente); e `plans` continua `service_only`
 * (D35) — a linha que mudou de valor é o lugar onde um GRANT esquecido ao
 * cliente apareceria.
 *
 * Prova COMPORTAMENTAL (RETOMADA regra 6): `authenticated` com JWT e `anon`
 * negados nas quatro operações sobre `plans`; `service_role` lê os 3/3 (guarda
 * de vacuidade). Cada bloco imprime contagem COM denominador (G-14).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "@/tests/invariants/psql-transporte";

const USER = "f1900006-9000-4000-8000-000000000001";
const ORG = "f1900006-0000-4000-8000-000000000001";
const OPERACOES = ["select", "insert", "update", "delete"] as const;
const SEM_ERRO = "<o comando PASSOU: o papel alcançou a tabela>";

/** A decisão do dono (D58 b), em centavos de BRL — a prova cita o valor, não o lê do código. */
const PLANOS_DO_DONO = [
  ["PLAN_A", "Essencial", 19700],
  ["PLAN_B", "Profissional", 59700],
  ["PLAN_C", "Empresarial", 149700],
] as const;

function erroDe(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (erro) {
    return motivoDoErro(erro);
  }
}

const claims = (userId: string) => `select set_config('request.jwt.claims','{"sub":"${userId}"}',true);`;

function erroSob(papel: "anon" | "authenticated" | "service_role", comando: string, usuario?: string): string | null {
  return erroDe(`begin; set local role ${papel}; ${usuario ? claims(usuario) : ""} ${comando}; rollback;`);
}

function comandoDe(operacao: (typeof OPERACOES)[number]): string {
  switch (operacao) {
    case "select":
      return "select count(*) from public.plans where source = 'owner'";
    case "insert":
      return "insert into public.plans (code, name, price_cents, source) values ('PLAN_X', 'Intruso', 100, 'owner')";
    case "update":
      return "update public.plans set price_cents = 1 where code = 'PLAN_A'";
    case "delete":
      return "delete from public.plans where code = 'PLAN_A'";
  }
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${USER}','f19-t06@invariant.test');
    insert into public.organizations (id, slug, legal_name, display_name) values ('${ORG}','f19-t06-planos','F19 T06 Planos','F19 T06');
    insert into public.user_organizations (organization_id, user_id, role, accepted_at) values ('${ORG}','${USER}','admin',now());
  `);
});

describe("F19-T06 — os planos têm o nome e o preço que o dono decidiu (D14/D58)", () => {
  it("PLAN_A/B/C são Essencial 19700, Profissional 59700, Empresarial 149700 em BRL com source=owner (planos_owner=3/3)", () => {
    const linhas = sql(`select code || '|' || name || '|' || price_cents || '|' || currency || '|' || source from public.plans where code in ('PLAN_A','PLAN_B','PLAN_C') order by code`)
      .trim()
      .split("\n")
      .map((l) => l.trim());
    expect(linhas).toEqual(PLANOS_DO_DONO.map(([code, nome, preco]) => `${code}|${nome}|${preco}|BRL|owner`));
    const placeholders = sql(`select count(*) from public.plans where source = 'placeholder'`).trim();
    expect(placeholders).toBe("0");
    console.info(`f19-t06-planos: planos_owner=${linhas.length}/3 placeholders_restantes=${placeholders}/0`);
  });

  it("reaplicar a atualização da 9034 não sobrescreve uma edição posterior do dono (idempotente=1/1)", () => {
    // O apêndice grava só onde ainda é placeholder; sobre owner é no-op. Simula uma
    // edição posterior do dono e reaplica o mesmo UPDATE da migration: o valor editado fica.
    const saida = sql(`
      begin;
      update public.plans set price_cents = 20000 where code = 'PLAN_A';
      update public.plans set name = 'Essencial', price_cents = 19700, source = 'owner' where code = 'PLAN_A' and source = 'placeholder';
      select price_cents from public.plans where code = 'PLAN_A';
      rollback;
    `).split("\n").map((l) => l.trim());
    expect(saida).toContain("UPDATE 0");
    expect(saida).toContain("20000");
    const intacto = sql(`select price_cents from public.plans where code = 'PLAN_A'`).trim();
    expect(intacto).toBe("19700");
    console.info("f19-t06-idempotente: reaplicacao_preserva_edicao=1/1 valor_do_dono_intacto=1/1");
  });

  it("plans continua service_only: anon e authenticated negados nas 4 operações, service_role lê 3/3 (rls=8/8)", () => {
    const negadas: string[] = [];
    for (const papel of ["anon", "authenticated"] as const) {
      for (const operacao of OPERACOES) {
        const erro = erroSob(papel, comandoDe(operacao), papel === "authenticated" ? USER : undefined) ?? SEM_ERRO;
        if (/permission denied|violates row-level security/i.test(erro)) negadas.push(`${papel}:${operacao}`);
        else negadas.push(`${papel}:${operacao}:PASSOU(${erro})`);
      }
    }
    const passaram = negadas.filter((n) => n.includes(":PASSOU"));
    expect(passaram, "algum papel de cliente alcançou plans").toEqual([]);
    const lidos = sql(`begin; set local role service_role; select count(*) from public.plans where source = 'owner'; rollback;`)
      .split("\n").map((l) => l.trim());
    expect(lidos).toContain("3");
    console.info(`f19-t06-rls: negadas=${negadas.length - passaram.length}/8 service_role_le=3/3`);
  });
});
