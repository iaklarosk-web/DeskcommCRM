/**
 * F19-T01 — a migration 9033 abriu a cobrança ao gateway `stripe` SEM abrir a
 * mesa (ADR-042 §3; D52 b, D57): os três CHECKs aceitam exatamente o
 * vocabulário novo e continuam recusando texto livre; as três colunas e o
 * índice existem; as quatro tabelas da F12 continuam `service_only` (D35) —
 * medido de novo aqui porque coluna nova em tabela sem RLS de cliente é o
 * lugar onde um GRANT esquecido apareceria.
 *
 * Prova COMPORTAMENTAL (RETOMADA regra 6): `authenticated` com JWT e `anon`
 * negados nas quatro operações sobre a assinatura com `gateway='stripe'`, e
 * `service_role` escrevendo o evento `stripe`/`cancelled` e lendo de volta
 * (guarda de vacuidade). Cada bloco imprime contagem COM denominador (G-14).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "@/tests/invariants/psql-transporte";

const ORG = "f1900001-0000-4000-8000-000000000001";
const ORG_B = "f1900001-0000-4000-8000-000000000002";
const USER_A = "f1900001-9000-4000-8000-000000000001";
const USER_B = "f1900001-9000-4000-8000-000000000002";
const SUB_A = "f1900001-5000-4000-8000-000000000001";
const SUB_B = "f1900001-5000-4000-8000-000000000002";

const OPERACOES = ["select", "insert", "update", "delete"] as const;
const SEM_ERRO = "<o comando PASSOU: o papel alcançou a tabela>";

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
      return "select count(*) from public.subscriptions where gateway = 'stripe'";
    case "insert":
      return `insert into public.billing_events (organization_id, subscription_id, gateway, event_ref, event_type, occurred_at, livemode)
              values ('${ORG}','${SUB_A}','stripe','evt_rls','payment_confirmed',now(),false)`;
    case "update":
      return "update public.subscriptions set customer_ref = 'cus_x' where gateway = 'stripe'";
    case "delete":
      return "delete from public.billing_events where gateway = 'stripe'";
  }
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${USER_A}','f19-t01-a@invariant.test'),
      ('${USER_B}','f19-t01-b@invariant.test');
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}','f19-t01-stripe','F19 T01 Stripe','F19 T01'),
      ('${ORG_B}','f19-t01-stripe-b','F19 T01 Stripe B','F19 T01 B');
    insert into public.user_organizations (organization_id, user_id, role, accepted_at) values
      ('${ORG}','${USER_A}','admin',now()),
      ('${ORG_B}','${USER_B}','admin',now());
    insert into public.subscriptions (id, organization_id, plan_code, status, origin, gateway, gateway_ref, customer_ref, trial_ends_at, current_period_start, current_period_end) values
      ('${SUB_A}','${ORG}','PLAN_A','active','fixture','stripe','sub_f19a','cus_f19a',now()+interval '7 days',now(),now()+interval '30 days'),
      ('${SUB_B}','${ORG_B}','PLAN_B','active','fixture','stripe','sub_f19b','cus_f19b',null,now(),now()+interval '30 days');
  `);
});

describe("F19-T01 — vocabulário: stripe e cancelled entram, texto livre continua fora", () => {
  it("subscriptions.gateway e billing_events.gateway aceitam stripe e recusam outro gateway (checks=2/2)", () => {
    const stripeSub = erroDe(`begin; update public.subscriptions set gateway = 'stripe' where id = '${SUB_A}'; rollback;`);
    const outroSub = erroDe(`begin; update public.subscriptions set gateway = 'pagseguro' where id = '${SUB_A}'; rollback;`);
    const stripeEvt = erroDe(`begin; insert into public.billing_events (organization_id, subscription_id, gateway, event_ref, event_type, occurred_at)
      values ('${ORG}','${SUB_A}','stripe','evt_1','payment_confirmed',now()); rollback;`);
    const outroEvt = erroDe(`begin; insert into public.billing_events (organization_id, subscription_id, gateway, event_ref, event_type, occurred_at)
      values ('${ORG}','${SUB_A}','pagseguro','evt_2','payment_confirmed',now()); rollback;`);
    expect(stripeSub, "stripe recusado em subscriptions").toBeNull();
    expect(outroSub ?? SEM_ERRO).toContain("subscriptions_gateway_check");
    expect(stripeEvt, "stripe recusado em billing_events").toBeNull();
    expect(outroEvt ?? SEM_ERRO).toContain("billing_events_gateway_check");
    console.info("f19-t01-gateway: stripe_aceito=2/2 outro_recusado=2/2 checks=2/2");
  });

  it("billing_events.event_type aceita cancelled e recusa refund (o CHECK tem exatamente 3 valores)", () => {
    const cancelado = erroDe(`begin; insert into public.billing_events (organization_id, subscription_id, gateway, event_ref, event_type, occurred_at, livemode)
      values ('${ORG}','${SUB_A}','stripe','evt_3','cancelled',now(),false); rollback;`);
    const refund = erroDe(`begin; insert into public.billing_events (organization_id, subscription_id, gateway, event_ref, event_type, occurred_at)
      values ('${ORG}','${SUB_A}','stripe','evt_4','refund',now()); rollback;`);
    const valores = sql(`
      select string_agg(k, ',' order by k) from (
        select unnest(regexp_matches(pg_get_constraintdef(oid), '''([a-z_]+)''', 'g')) as k
        from pg_constraint where conname = 'billing_events_event_type_check'
      ) x;
    `).trim();
    expect(cancelado, "cancelled recusado").toBeNull();
    expect(refund ?? SEM_ERRO).toContain("billing_events_event_type_check");
    expect(valores).toBe("cancelled,payment_confirmed,payment_failed");
    console.info("f19-t01-event-type: cancelled_aceito=1/1 refund_recusado=1/1 valores=3/3");
  });

  it("as três colunas e o índice existem, com o tipo declarado (colunas=3/3 indice=1/1)", () => {
    const colunas = sql(`
      select table_name || '.' || column_name || ':' || data_type from information_schema.columns
      where table_schema = 'public'
        and ((table_name = 'subscriptions' and column_name in ('customer_ref', 'trial_ends_at'))
          or (table_name = 'billing_events' and column_name = 'livemode'))
      order by 1;
    `).trim().split("\n").map((l) => l.trim());
    const indice = sql(`select count(*) from pg_indexes where schemaname = 'public' and indexname = 'subscriptions_gateway_ref_idx'`).trim();
    expect(colunas).toEqual([
      "billing_events.livemode:boolean",
      "subscriptions.customer_ref:text",
      "subscriptions.trial_ends_at:timestamp with time zone",
    ]);
    expect(indice).toBe("1");
    console.info(`f19-t01-colunas: colunas=${colunas.length}/3 indice=${indice}/1`);
  });
});

describe("F19-T01 — as quatro tabelas da cobrança continuam service_only (D35) depois da 9033", () => {
  it("RLS ligada, zero policies e nenhum privilégio de anon/authenticated/public (tabelas=4/4)", () => {
    let conferidas = 0;
    for (const tabela of ["plans", "subscriptions", "billing_events", "invoices"]) {
      const observado = sql(`
        select
          (select relrowsecurity from pg_class where oid = 'public.${tabela}'::regclass)::text || '|' ||
          (select count(*) from pg_policies where schemaname = 'public' and tablename = '${tabela}')::text || '|' ||
          (select count(*) from pg_class c, aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
            where c.oid = 'public.${tabela}'::regclass
              and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 0))::text
      `).trim();
      expect(observado, tabela).toBe("true|0|0");
      conferidas++;
    }
    console.info(`f19-t01-service-only: tabelas=${conferidas}/4 rls=1 policies=0 anon=0 authenticated=0 public=0`);
  });

  it("authenticated (A e B) e anon recebem permission denied nas quatro operações sobre linhas stripe", () => {
    let negadas = 0;
    const esperado = OPERACOES.length * 3;
    for (const operacao of OPERACOES) {
      for (const [papel, usuario] of [["authenticated", USER_A], ["authenticated", USER_B], ["anon", undefined]] as const) {
        const erro = erroSob(papel, comandoDe(operacao), usuario);
        expect(erro ?? SEM_ERRO, `${papel}/${usuario ?? "-"}/${operacao}`).toContain("permission denied");
        negadas++;
      }
    }
    console.info(`f19-t01-rls: negado=${negadas}/${esperado} (4 operações × authenticated A, authenticated B, anon)`);
  });

  it("service_role escreve o evento stripe/cancelled com livemode e lê de volta (guarda de vacuidade)", () => {
    const lido = sql(`
      begin;
      set local role service_role;
      insert into public.billing_events (organization_id, subscription_id, gateway, event_ref, event_type, occurred_at, livemode)
        values ('${ORG}','${SUB_A}','stripe','evt_vacuidade','cancelled',now(),false);
      select gateway || '|' || event_type || '|' || livemode::text || '|' || (select customer_ref from public.subscriptions where id = '${SUB_A}')
        from public.billing_events where event_ref = 'evt_vacuidade';
      rollback;
    `).trim();
    // psql -tA ecoa BEGIN/SET/INSERT antes da linha: a prova é a ÚLTIMA linha
    // não vazia antes do ROLLBACK, não o transcript inteiro.
    const linhas = lido.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && l !== "ROLLBACK");
    expect(linhas.at(-1)).toBe("stripe|cancelled|false|cus_f19a");
    console.info("f19-t01-rls: service_role_permitido=1/1 linha_lida_de_volta=1/1");
  });
});
