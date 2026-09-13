/**
 * F05-T05 — `notifications` e `email_outbox` são do BANCO, e são `service_only`
 * DE VERDADE (§5.16, D12/D35, migration 9021).
 *
 * O que este arquivo mede, e por que precisa de Postgres: a recusa é medida sob
 * `set local role` + JWT, nos DOIS tenants, nas QUATRO operações, nas DUAS
 * tabelas; o evento é ENUM de SEIS valores no CHECK e não só no TypeScript
 * (G-78); `payload` recusa o que não é objeto; `email_outbox` recusa
 * destinatário/assunto/corpo vazios — que é o que `not null` sozinho aceitaria.
 *
 * Cada bloco imprime contagem COM denominador (G-14).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { EVENTOS_DE_NOTIFICACAO } from "@/src/notifications/eventos";
import { motivoDoErro, sql } from "@/tests/invariants/psql-transporte";

const ORG = "f0500005-0000-4000-8000-000000000001";
const ORG_B = "f0500005-0000-4000-8000-000000000002";
const USER_A = "f0500005-9000-4000-8000-000000000001";
const USER_B = "f0500005-9000-4000-8000-000000000002";

const TABELAS = ["notifications", "email_outbox"] as const;
type Tabela = (typeof TABELAS)[number];

/** As QUATRO operações. Nome + SQL: o denominador sai da lista, não do banco. */
const OPERACOES = ["select", "insert", "update", "delete"] as const;

function insercao(tabela: Tabela, org: string, usuario: string, evento = "handoff.created"): string {
  if (tabela === "notifications") {
    return `insert into public.notifications (organization_id, user_id, event, payload)
            values ('${org}','${usuario}','${evento}','{"conversation_id":"x"}'::jsonb)`;
  }
  return `insert into public.email_outbox
            (organization_id, user_id, event, to_email, subject, body)
          values ('${org}','${usuario}','${evento}','pessoa@ficticio.test','Assunto','Corpo.')`;
}

function comandoDe(tabela: Tabela, operacao: (typeof OPERACOES)[number]): string {
  switch (operacao) {
    case "select":
      return `select count(*) from public.${tabela}`;
    case "insert":
      return insercao(tabela, ORG, USER_A);
    case "update":
      return tabela === "notifications"
        ? "update public.notifications set read_at = now()"
        : "update public.email_outbox set subject = 'x'";
    case "delete":
      return `delete from public.${tabela}`;
  }
}

function claims(userId: string): string {
  return `select set_config('request.jwt.claims','{"sub":"${userId}"}',true);`;
}

function erroDe(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (erro) {
    return motivoDoErro(erro);
  }
}

function aceita(script: string): boolean {
  return erroDe(`${script};`) === null;
}

function erroSob(
  papel: "anon" | "authenticated" | "service_role",
  comando: string,
  usuario?: string,
): string | null {
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
      ('${USER_A}','f05-t05-a@invariant.test'),
      ('${USER_B}','f05-t05-b@invariant.test');
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}','f05-t05-notif','F05 T05 Notif','F05 T05'),
      ('${ORG_B}','f05-t05-notif-b','F05 T05 Notif B','F05 T05 B');
    insert into public.user_organizations (organization_id, user_id, role, accepted_at) values
      ('${ORG}','${USER_A}','agent',now()),
      ('${ORG_B}','${USER_B}','agent',now());
  `);
});

describe("F05-T05 — notifications e email_outbox são service_only (D35)", () => {
  it("RLS ligada, zero policies e nenhum privilégio de cliente, nas duas", () => {
    let conferidas = 0;
    for (const tabela of TABELAS) {
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
      // rls|policies|anon|authenticated|PUBLIC|service_role
      expect(observado, `${tabela} fora do desenho service_only (D35/G-54)`).toBe("1|0|0|0|0|1");
      conferidas += 1;
    }
    console.info(
      `f05-t05-service-only: tabelas=${conferidas}/${TABELAS.length} rls=1 policies=0 anon=0 authenticated=0 public=0 service_role=1`,
    );
  });

  it("o evento é ENUM de seis valores no CHECK, nas duas tabelas (G-78)", () => {
    // Arrange — a lista do TypeScript é a afirmação; o CHECK tem de casar com ela.
    expect(EVENTOS_DE_NOTIFICACAO.length, "§5.16 tem seis eventos").toBe(6);

    let aceitos = 0;
    let recusados = 0;
    for (const tabela of TABELAS) {
      for (const evento of EVENTOS_DE_NOTIFICACAO) {
        expect(
          aceita(`begin; ${insercao(tabela, ORG, USER_A, evento)}; rollback`),
          `${tabela} recusou o evento ${evento} de §5.16`,
        ).toBe(true);
        aceitos += 1;
      }
      const motivo = erroDe(`begin; ${insercao(tabela, ORG, USER_A, "avisar o chefe")}; rollback;`);
      expect(motivo ?? SEM_ERRO, `${tabela} aceitou evento em prosa`).toContain(`${tabela}_event_check`);
      recusados += 1;
    }
    const esperado = TABELAS.length * EVENTOS_DE_NOTIFICACAO.length;
    expect(aceitos).toBe(esperado);
    console.info(
      `f05-t05-enum: eventos_aceitos=${aceitos}/${esperado} prosa_recusada=${recusados}/${TABELAS.length}`,
    );
  });

  it("payload que não é objeto e e-mail com campo vazio são recusados pelo CHECK", () => {
    const payloadArray = erroDe(`begin;
      insert into public.notifications (organization_id, user_id, event, payload)
      values ('${ORG}','${USER_A}','job.blocked','[1,2]'::jsonb); rollback;`);
    const destinatarioVazio = erroDe(`begin;
      insert into public.email_outbox (organization_id, user_id, event, to_email, subject, body)
      values ('${ORG}','${USER_A}','job.blocked','   ','Assunto','Corpo.'); rollback;`);
    const assuntoVazio = erroDe(`begin;
      insert into public.email_outbox (organization_id, user_id, event, to_email, subject, body)
      values ('${ORG}','${USER_A}','job.blocked','a@b.test','','Corpo.'); rollback;`);

    expect(payloadArray ?? SEM_ERRO).toContain("notifications_payload_objeto");
    expect(destinatarioVazio ?? SEM_ERRO).toContain("email_outbox_campos_preenchidos");
    expect(assuntoVazio ?? SEM_ERRO).toContain("email_outbox_campos_preenchidos");
    console.info("f05-t05-checks: payload_nao_objeto_recusado=1/1 email_campo_vazio_recusado=2/2");
  });

  it("os avisos HERDADOS permanecem ao lado — a F05 amplia, não substitui", () => {
    const herdados = sql(
      `select count(*)::int from pg_tables where schemaname='public'
        and tablename in ('agent_inbox_items','event_log');`,
    ).trim();
    expect(herdados, "agent_inbox_items ou event_log sumiu").toBe("2");
    console.info("f05-t05-heranca: agent_inbox_items+event_log=2/2");
  });
});

/**
 * A PROVA COMPORTAMENTAL exigida por `rls-completude-varredura.test.ts`, nas
 * duas tabelas. O catálogo acima descreve a FORMA da proteção; o que fecha a
 * lacuna é TENTAR — sob `set local role`, com o JWT de um usuário real, membro
 * de uma organização real — e medir a recusa do Postgres pelo nome, nos DOIS
 * tenants. `service_role` é a guarda de vacuidade.
 */
describe("F05-T05 — prova comportamental de RLS nos dois tenants", () => {
  it("authenticated recebe permission denied nas quatro operações, em A e B, nas duas tabelas", () => {
    const usuarios = [USER_A, USER_B] as const;
    let negadas = 0;
    for (const tabela of TABELAS) {
      for (const usuario of usuarios) {
        for (const operacao of OPERACOES) {
          const motivo = erroSob("authenticated", comandoDe(tabela, operacao), usuario);
          expect(
            motivo ?? SEM_ERRO,
            `authenticated (${usuario}) alcançou ${tabela} no ${operacao} — service_only furado (D35/G-54)`,
          ).toContain("permission denied");
          negadas += 1;
        }
      }
    }
    const esperado = TABELAS.length * OPERACOES.length * usuarios.length;
    expect(negadas).toBe(esperado);
    console.info(`f05-t05-rls: authenticated_negado=${negadas}/${esperado}`);
  });

  it("anon recebe permission denied nas quatro operações, nas duas tabelas", () => {
    let negadas = 0;
    for (const tabela of TABELAS) {
      for (const operacao of OPERACOES) {
        const motivo = erroSob("anon", comandoDe(tabela, operacao));
        expect(
          motivo ?? SEM_ERRO,
          `anon alcançou ${tabela} no ${operacao} — a anon key lê o aviso da pessoa`,
        ).toContain("permission denied");
        negadas += 1;
      }
    }
    const esperado = TABELAS.length * OPERACOES.length;
    expect(negadas).toBe(esperado);
    console.info(`f05-t05-rls: anon_negado=${negadas}/${esperado}`);
  });

  it("service_role continua escrevendo e lendo nas duas (guarda de vacuidade)", () => {
    let permitidas = 0;
    for (const tabela of TABELAS) {
      for (const operacao of OPERACOES) {
        const motivo = erroSob("service_role", comandoDe(tabela, operacao));
        expect(motivo, `service_role perdeu o ${operacao} em ${tabela} — o produto para de avisar`).toBeNull();
        permitidas += 1;
      }
      const lida =
        sql(`
          begin;
          set local role service_role;
          ${insercao(tabela, ORG, USER_A)};
          select count(*)::text || '/1' from public.${tabela}
            where organization_id='${ORG}' and user_id='${USER_A}';
          rollback;
        `)
          .split("\n")
          .map((linha) => linha.trim())
          .filter((linha) => /^\d+\/\d+$/.test(linha))
          .at(-1) ?? "";
      expect(lida, `service_role escreveu em ${tabela} e não leu de volta`).toBe("1/1");
    }
    const esperado = TABELAS.length * OPERACOES.length;
    expect(permitidas).toBe(esperado);
    console.info(`f05-t05-rls: service_role_permitido=${permitidas}/${esperado} linha_lida_de_volta=2/2`);
  });
});
