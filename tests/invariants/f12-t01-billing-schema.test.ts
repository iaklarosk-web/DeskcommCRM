/**
 * F12-T01 — `plans`, `subscriptions`, `billing_events` e `invoices` são do
 * BANCO e são `service_only` DE VERDADE (D35, ADR-030 §3, migration 9023);
 * os estados da assinatura são enum com coerências; o evento do gateway é
 * único por `(gateway, event_ref)` (G-57); os três eventos de notificação da
 * cobrança entraram nos dois CHECKs de 9021 por ADIÇÃO.
 *
 * Prova COMPORTAMENTAL de RLS (RETOMADA regra 6): duas organizações e dois
 * usuários reais, `permission denied` medido sob `set local role authenticated`
 * + JWT nas quatro operações para os DOIS usuários, as mesmas quatro negadas
 * para `anon`, e controle positivo de `service_role` que escreve e lê a linha
 * de volta (guarda de vacuidade). Cada bloco imprime contagem COM denominador
 * (G-14).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "@/tests/invariants/psql-transporte";

const ORG = "f1200001-0000-4000-8000-000000000001";
const ORG_B = "f1200001-0000-4000-8000-000000000002";
/** Terceira organização, SEM assinatura: é onde o insert de `subscriptions` pode nascer. */
const ORG_C = "f1200001-0000-4000-8000-000000000003";
const USER_A = "f1200001-9000-4000-8000-000000000001";
const USER_B = "f1200001-9000-4000-8000-000000000002";
const SUB_A = "f1200001-5000-4000-8000-000000000001";
const SUB_B = "f1200001-5000-4000-8000-000000000002";

const OPERACOES = ["select", "insert", "update", "delete"] as const;
const TABELAS = ["subscriptions", "billing_events", "invoices"] as const;
type Tabela = (typeof TABELAS)[number];

function insercao(tabela: Tabela, org: string, sub: string, ref = "evt-1"): string {
  switch (tabela) {
    case "subscriptions":
      return `insert into public.subscriptions (organization_id, plan_code, status, origin)
              values ('${org}','PLAN_A','pending_payment','fixture')`;
    case "billing_events":
      return `insert into public.billing_events (organization_id, subscription_id, gateway, event_ref, event_type, occurred_at)
              values ('${org}','${sub}','mock','${ref}','payment_confirmed',now())`;
    case "invoices":
      return `insert into public.invoices (organization_id, subscription_id, plan_code, period_start, period_end, amount_cents, due_at)
              values ('${org}','${sub}','PLAN_A',now(),now()+interval '30 days',0,now())`;
  }
}

function comandoDe(tabela: Tabela, operacao: (typeof OPERACOES)[number]): string {
  switch (operacao) {
    case "select":
      return `select count(*) from public.${tabela}`;
    case "insert":
      return tabela === "subscriptions" ? insercao(tabela, ORG_C, SUB_A) : insercao(tabela, ORG, SUB_A);
    case "update":
      return tabela === "subscriptions"
        ? "update public.subscriptions set cancel_reason = 'x'"
        : tabela === "billing_events"
          ? "update public.billing_events set applied = true"
          : "update public.invoices set currency = 'BRL'";
    case "delete":
      return `delete from public.${tabela}`;
  }
}

const claims = (userId: string) =>
  `select set_config('request.jwt.claims','{"sub":"${userId}"}',true);`;

function erroDe(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (erro) {
    return motivoDoErro(erro);
  }
}

function erroSob(papel: "anon" | "authenticated" | "service_role", comando: string, usuario?: string): string | null {
  return erroDe(`
    begin;
    set local role ${papel};
    ${usuario ? claims(usuario) : ""}
    ${comando};
    rollback;
  `);
}

const SEM_ERRO = "<o comando PASSOU: o papel alcançou a tabela>";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${USER_A}','f12-t01-a@invariant.test'),
      ('${USER_B}','f12-t01-b@invariant.test');
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}','f12-t01-cobranca','F12 T01 Cobrança','F12 T01'),
      ('${ORG_B}','f12-t01-cobranca-b','F12 T01 Cobrança B','F12 T01 B'),
      ('${ORG_C}','f12-t01-cobranca-c','F12 T01 Cobrança C','F12 T01 C');
    insert into public.user_organizations (organization_id, user_id, role, accepted_at) values
      ('${ORG}','${USER_A}','admin',now()),
      ('${ORG_B}','${USER_B}','admin',now());
    insert into public.subscriptions (id, organization_id, plan_code, status, origin, current_period_start, current_period_end) values
      ('${SUB_A}','${ORG}','PLAN_A','active','fixture',now(),now()+interval '30 days'),
      ('${SUB_B}','${ORG_B}','PLAN_B','active','fixture',now(),now()+interval '30 days');
  `);
});

describe("F12-T01 — catálogo: quatro tabelas service_only (D35) e os planos placeholder", () => {
  it("RLS ligada, zero policies e nenhum privilégio de cliente nas quatro tabelas", () => {
    let conferidas = 0;
    for (const tabela of ["plans", ...TABELAS]) {
      const observado = sql(`
        select
          (select relrowsecurity::int from pg_class where oid='public.${tabela}'::regclass) || '|' ||
          (select count(*) from pg_policies where schemaname='public' and tablename='${tabela}') || '|' ||
          (select count(*) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
            where c.oid='public.${tabela}'::regclass and a.grantee='anon'::regrole) || '|' ||
          (select count(*) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
            where c.oid='public.${tabela}'::regclass and a.grantee='authenticated'::regrole) || '|' ||
          (select count(*) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
            where c.oid='public.${tabela}'::regclass and a.grantee=0) || '|' ||
          (select least(count(*),1) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
            where c.oid='public.${tabela}'::regclass and a.grantee='service_role'::regrole);
      `);
      expect(observado, `${tabela} fora do desenho service_only (D35/G-54)`).toBe("1|0|0|0|0|1");
      conferidas += 1;
    }
    console.info(`f12-t01-service-only: tabelas=${conferidas}/4 rls=1 policies=0 anon=0 authenticated=0 public=0 service_role=1`);
  });

  it("PLAN_A/B/C existem como placeholder: name = code, price_cents = 0, source = placeholder (D14)", () => {
    const linhas = sql(`
      select code || '|' || name || '|' || price_cents || '|' || source || '|' || coalesce(limits->>'users.invite','-')
        from public.plans where code in ('PLAN_A','PLAN_B','PLAN_C') order by code;
    `).trim().split("\n").map((l) => l.trim()).filter(Boolean);
    expect(linhas).toEqual(["PLAN_A|PLAN_A|0|placeholder|3", "PLAN_B|PLAN_B|0|placeholder|10", "PLAN_C|PLAN_C|0|placeholder|-"]);
    const precoNegativo = erroDe(`begin; update public.plans set price_cents = -1 where code='PLAN_A'; rollback;`);
    const codigoLivre = erroDe(`begin; insert into public.plans (code, name) values ('plano básico','x'); rollback;`);
    expect(precoNegativo ?? SEM_ERRO).toContain("plans_price_cents_check");
    expect(codigoLivre ?? SEM_ERRO).toContain("plans_code_check");
    console.info("f12-t01-planos: placeholders=3/3 preco_zero=3/3 preco_negativo_recusado=1/1 codigo_livre_recusado=1/1");
  });
});

describe("F12-T01 — assinatura: uma por organização, estados fechados e coerências", () => {
  it("a segunda assinatura da MESMA organização é recusada pelo ÍNDICE; estado em prosa pelo CHECK", () => {
    const segunda = erroDe(`begin; ${insercao("subscriptions", ORG, SUB_A)}; rollback;`);
    const estadoLivre = erroDe(`begin;
      insert into public.subscriptions (organization_id, plan_code, status, origin)
      values ('${ORG_C}','PLAN_A','trial','fixture'); rollback;`);
    const origemLivre = erroDe(`begin;
      insert into public.subscriptions (organization_id, plan_code, status, origin)
      values ('${ORG_C}','PLAN_A','pending_payment','promo'); rollback;`);
    const planoInexistente = erroDe(`begin;
      update public.subscriptions set plan_code = 'PLAN_Z' where id='${SUB_A}'; rollback;`);
    expect(segunda ?? SEM_ERRO, "duas assinaturas na mesma organização").toContain("subscriptions_uma_por_organizacao");
    expect(estadoLivre ?? SEM_ERRO).toContain("subscriptions_status_check");
    expect(origemLivre ?? SEM_ERRO).toContain("subscriptions_origin_check");
    expect(planoInexistente ?? SEM_ERRO).toContain("subscriptions_plan_code_fkey");
    console.info("f12-t01-assinatura: segunda_recusada=1/1 estado_livre_recusado=1/1 origem_livre_recusada=1/1 plano_inexistente_recusado=1/1");
  });

  it("past_due exige failed_at+grace_until, blocked exige blocked_at, cancelled exige cancelled_at, active exige período", () => {
    const casos: Array<[string, string]> = [
      ["update public.subscriptions set status='past_due' where id='" + SUB_A + "'", "subscriptions_past_due_coerente"],
      ["update public.subscriptions set status='blocked' where id='" + SUB_A + "'", "subscriptions_blocked_coerente"],
      ["update public.subscriptions set status='cancelled' where id='" + SUB_A + "'", "subscriptions_cancelled_coerente"],
      ["update public.subscriptions set current_period_start=null where id='" + SUB_A + "'", "subscriptions_active_coerente"],
      ["update public.subscriptions set current_period_end=current_period_start where id='" + SUB_A + "'", "subscriptions_periodo_coerente"],
    ];
    let recusadas = 0;
    for (const [comando, constraint] of casos) {
      expect(erroDe(`begin; ${comando}; rollback;`) ?? SEM_ERRO, comando).toContain(constraint);
      recusadas += 1;
    }
    const coerente = erroDe(`begin;
      update public.subscriptions set status='past_due', failed_at=now(), grace_until=now()+interval '7 days' where id='${SUB_A}';
      update public.subscriptions set status='blocked', blocked_at=now() where id='${SUB_A}';
      update public.subscriptions set status='cancelled', cancelled_at=now() where id='${SUB_A}';
      rollback;`);
    expect(coerente).toBeNull();
    console.info(`f12-t01-coerencia: incoerentes_recusadas=${recusadas}/${casos.length} coerentes_aceitas=3/3`);
  });

  it("o evento do gateway é único por (gateway, event_ref); fatura paga sem paid_at e período invertido são recusados", () => {
    const duplicado = erroDe(`begin; ${insercao("billing_events", ORG, SUB_A, "evt-dup")}; ${insercao("billing_events", ORG, SUB_A, "evt-dup")}; rollback;`);
    const outroRef = erroDe(`begin; ${insercao("billing_events", ORG, SUB_A, "evt-1")}; ${insercao("billing_events", ORG, SUB_A, "evt-2")}; rollback;`);
    const tipoLivre = erroDe(`begin;
      insert into public.billing_events (organization_id, gateway, event_ref, event_type, occurred_at)
      values ('${ORG}','mock','evt-3','refund',now()); rollback;`);
    const aplicadoEIgnorado = erroDe(`begin;
      insert into public.billing_events (organization_id, gateway, event_ref, event_type, occurred_at, applied, ignored_reason)
      values ('${ORG}','mock','evt-4','payment_failed',now(),true,'out_of_order'); rollback;`);
    const pagaSemData = erroDe(`begin;
      insert into public.invoices (organization_id, subscription_id, plan_code, period_start, period_end, amount_cents, due_at, status)
      values ('${ORG}','${SUB_A}','PLAN_A',now(),now()+interval '30 days',0,now(),'paid'); rollback;`);
    const periodoInvertido = erroDe(`begin;
      insert into public.invoices (organization_id, subscription_id, plan_code, period_start, period_end, amount_cents, due_at)
      values ('${ORG}','${SUB_A}','PLAN_A',now(),now()-interval '1 day',0,now()); rollback;`);
    expect(duplicado ?? SEM_ERRO, "o mesmo evento entrou duas vezes — G-57 furada").toContain("billing_events_ref_unica");
    expect(outroRef, "referência diferente foi recusada").toBeNull();
    expect(tipoLivre ?? SEM_ERRO).toContain("billing_events_event_type_check");
    expect(aplicadoEIgnorado ?? SEM_ERRO).toContain("billing_events_desfecho_coerente");
    expect(pagaSemData ?? SEM_ERRO).toContain("invoices_paga_coerente");
    expect(periodoInvertido ?? SEM_ERRO).toContain("invoices_periodo");
    console.info("f12-t01-eventos: duplicado_recusado=1/1 outro_ref_aceito=1/1 tipo_livre_recusado=1/1 desfecho_incoerente_recusado=1/1 fatura_incoerente_recusada=2/2");
  });

  it("os três eventos de notificação da cobrança entraram nos dois CHECKs de 9021 sem perder os seis (por adição); a 9028 acrescentou o do limite diário", () => {
    // F15-T02 (ADR-036): a última definição (9028) tem os nove desta task mais `ai.limit_reached`.
    const eventos = [
      "handoff.created", "task.assigned", "confirmation.requested", "customer.replied_while_human",
      "reminder.no_reply", "job.blocked", "subscription.payment_failed", "subscription.blocked", "subscription.activated",
      "ai.limit_reached",
    ];
    let aceitos = 0;
    for (const tabela of ["notifications", "email_outbox"]) {
      const lista = sql(`
        select string_agg(k, ',' order by k) from (
          select unnest(regexp_matches(pg_get_constraintdef(oid), '''([a-z_.]+)''', 'g')) as k
            from pg_constraint where conrelid='public.${tabela}'::regclass and conname='${tabela}_event_check'
        ) x;
      `).trim().split(",");
      for (const evento of eventos) {
        expect(lista, `${tabela}_event_check perdeu ${evento}`).toContain(evento);
        aceitos += 1;
      }
      expect(lista.length, `${tabela}_event_check tem vocabulário a mais`).toBe(eventos.length);
    }
    console.info(`f12-t01-notificacoes: eventos_no_check=${aceitos}/${eventos.length * 2} tabelas=2/2`);
  });
});

describe("F12-T01 — prova comportamental de RLS nos dois tenants, nas três tabelas tenant-aware", () => {
  it("authenticated recebe permission denied nas quatro operações, em A e B, para cada tabela", () => {
    const usuarios = [USER_A, USER_B] as const;
    let negadas = 0;
    for (const tabela of TABELAS) {
      for (const usuario of usuarios) {
        for (const operacao of OPERACOES) {
          const motivo = erroSob("authenticated", comandoDe(tabela, operacao), usuario);
          expect(motivo ?? SEM_ERRO, `authenticated (${usuario}) alcançou ${tabela} no ${operacao}`).toContain("permission denied");
          negadas += 1;
        }
      }
    }
    const esperado = TABELAS.length * OPERACOES.length * usuarios.length;
    expect(negadas).toBe(esperado);
    console.info(`f12-t01-rls: authenticated_negado=${negadas}/${esperado} (3 tabelas × 2 usuários × 4 operações)`);
  });

  it("anon recebe permission denied nas quatro operações, para cada tabela (e em plans)", () => {
    let negadas = 0;
    for (const tabela of TABELAS) {
      for (const operacao of OPERACOES) {
        const motivo = erroSob("anon", comandoDe(tabela, operacao));
        expect(motivo ?? SEM_ERRO, `anon alcançou ${tabela} no ${operacao}`).toContain("permission denied");
        negadas += 1;
      }
    }
    const planos = erroSob("anon", "select count(*) from public.plans");
    expect(planos ?? SEM_ERRO, "anon leu o catálogo de planos").toContain("permission denied");
    const esperado = TABELAS.length * OPERACOES.length;
    expect(negadas).toBe(esperado);
    console.info(`f12-t01-rls: anon_negado=${negadas}/${esperado} plans_anon_negado=1/1`);
  });

  it("service_role continua escrevendo e lendo (guarda de vacuidade), em cada tabela", () => {
    let permitidas = 0;
    let lidas = 0;
    for (const tabela of TABELAS) {
      for (const operacao of OPERACOES) {
        const motivo = erroSob("service_role", comandoDe(tabela, operacao));
        expect(motivo, `service_role perdeu o ${operacao} em ${tabela}`).toBeNull();
        permitidas += 1;
      }
      // `subscriptions` nasce em C (A e B já têm a sua); as outras duas em B,
      // que ainda não tem evento nem fatura — a contagem lida é a linha nova.
      const org = tabela === "subscriptions" ? ORG_C : ORG_B;
      const lida =
        sql(`
          begin;
          set local role service_role;
          ${insercao(tabela, org, SUB_B, "evt-vac")};
          select count(*)::text || '/1' from public.${tabela} where organization_id='${org}';
          rollback;
        `)
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => /^\d+\/\d+$/.test(l))
          .at(-1) ?? "";
      expect(lida, tabela).toBe("1/1");
      lidas += 1;
    }
    console.info(`f12-t01-rls: service_role_permitido=${permitidas}/${TABELAS.length * OPERACOES.length} linha_lida_de_volta=${lidas}/${TABELAS.length}`);
  });
});
