/**
 * F05-T06 — `reminder_runs` é do BANCO e é `service_only` DE VERDADE (§5.12,
 * D23/D35, migration 9022); `conversations.saas_tags` tem vocabulário fechado;
 * `job_queue.kind` aceita os dois kinds do lembrete sem perder os herdados.
 *
 * A idempotência de D23 é do ÍNDICE — o segundo `insert` do mesmo
 * `(organization_id, customer_id, period_key)` é recusado pelo Postgres, não
 * por um `select` antes. E a FK composta impede cliente de OUTRO tenant.
 *
 * Cada bloco imprime contagem COM denominador (G-14).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "@/tests/invariants/psql-transporte";

const ORG = "f0500006-0000-4000-8000-000000000001";
const ORG_B = "f0500006-0000-4000-8000-000000000002";
const USER_A = "f0500006-9000-4000-8000-000000000001";
const USER_B = "f0500006-9000-4000-8000-000000000002";
const CONTATO = "f0500006-2000-4000-8000-000000000001";
const CONTATO_B = "f0500006-2000-4000-8000-000000000002";
const SESSAO = "f0500006-3000-4000-8000-000000000001";
const CONVERSA = "f0500006-4000-4000-8000-000000000001";

const OPERACOES = ["select", "insert", "update", "delete"] as const;

function insercao(org: string, contato: string, period = "2026-W37"): string {
  return `insert into public.reminder_runs (organization_id, customer_id, period_key)
          values ('${org}','${contato}','${period}')`;
}

function comandoDe(operacao: (typeof OPERACOES)[number]): string {
  switch (operacao) {
    case "select":
      return "select count(*) from public.reminder_runs";
    case "insert":
      return insercao(ORG, CONTATO);
    case "update":
      return "update public.reminder_runs set replied_late = true";
    case "delete":
      return "delete from public.reminder_runs";
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
      ('${USER_A}','f05-t06-a@invariant.test'),
      ('${USER_B}','f05-t06-b@invariant.test');
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}','f05-t06-lembrete','F05 T06 Lembrete','F05 T06'),
      ('${ORG_B}','f05-t06-lembrete-b','F05 T06 Lembrete B','F05 T06 B');
    insert into public.user_organizations (organization_id, user_id, role, accepted_at) values
      ('${ORG}','${USER_A}','agent',now()),
      ('${ORG_B}','${USER_B}','agent',now());
    insert into public.contacts (id, organization_id, display_name, phone_number) values
      ('${CONTATO}','${ORG}','Contato F05 T06','+5511900000062'),
      ('${CONTATO_B}','${ORG_B}','Contato F05 T06 B','+5511900000063');
    insert into public.channel_sessions
      (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${SESSAO}','${ORG}','sessao-f05-t06','\\x00'::bytea);
    insert into public.conversations
      (id, organization_id, contact_id, channel_session_id, channel, status, is_group, saas_state)
      values ('${CONVERSA}','${ORG}','${CONTATO}','${SESSAO}','whatsapp','ai_handling',false,'waiting_customer');
  `);
});

describe("F05-T06 — reminder_runs é service_only (D35) e a chave do período é do índice", () => {
  it("RLS ligada, zero policies e nenhum privilégio de cliente", () => {
    const observado = sql(`
      select
        (select relrowsecurity::int from pg_class where oid='public.reminder_runs'::regclass) || '|' ||
        (select count(*) from pg_policies where schemaname='public' and tablename='reminder_runs') || '|' ||
        (select count(*) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
          where c.oid='public.reminder_runs'::regclass and a.grantee='anon'::regrole) || '|' ||
        (select count(*) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
          where c.oid='public.reminder_runs'::regclass and a.grantee='authenticated'::regrole) || '|' ||
        (select count(*) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
          where c.oid='public.reminder_runs'::regclass and a.grantee=0) || '|' ||
        (select least(count(*),1) from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
          where c.oid='public.reminder_runs'::regclass and a.grantee='service_role'::regrole);
    `);
    expect(observado, "reminder_runs fora do desenho service_only (D35/G-54)").toBe("1|0|0|0|0|1");
    console.info("f05-t06-service-only: tabelas=1/1 rls=1 policies=0 anon=0 authenticated=0 public=0 service_role=1");
  });

  it("o segundo (tenant, cliente, período) é recusado pelo ÍNDICE; período em formato livre pelo CHECK", () => {
    const duplicado = erroDe(`begin; ${insercao(ORG, CONTATO)}; ${insercao(ORG, CONTATO)}; rollback;`);
    const outroPeriodo = erroDe(`begin; ${insercao(ORG, CONTATO)}; ${insercao(ORG, CONTATO, "2026-W38")}; rollback;`);
    const formatoLivre = erroDe(`begin; ${insercao(ORG, CONTATO, "semana 37")}; rollback;`);

    expect(duplicado ?? SEM_ERRO, "dois lembretes no mesmo período — D23 furada").toContain("reminder_runs_um_por_periodo");
    expect(outroPeriodo, "período diferente foi recusado").toBeNull();
    expect(formatoLivre ?? SEM_ERRO).toContain("reminder_runs_period_key_check");
    console.info("f05-t06-idempotencia: duplicado_recusado=1/1 outro_periodo_aceito=1/1 formato_livre_recusado=1/1");
  });

  it("cliente de OUTRO tenant é recusado pela FK composta; coerências de envio/resposta/tarefa pelo CHECK", () => {
    const cruzado = erroDe(`begin; ${insercao(ORG, CONTATO_B)}; rollback;`);
    const envioSemCorte = erroDe(`begin;
      insert into public.reminder_runs (organization_id, customer_id, period_key, sent_at)
      values ('${ORG}','${CONTATO}','2026-W40', now()); rollback;`);
    const tardeSemResposta = erroDe(`begin;
      insert into public.reminder_runs (organization_id, customer_id, period_key, replied_late)
      values ('${ORG}','${CONTATO}','2026-W41', true); rollback;`);
    const tarefaEDenegacao = erroDe(`begin;
      insert into public.reminder_runs (organization_id, customer_id, period_key, task_id, task_denied_code)
      values ('${ORG}','${CONTATO}','2026-W42', gen_random_uuid(), 'x'); rollback;`);
    const puloEmProsa = erroDe(`begin;
      insert into public.reminder_runs (organization_id, customer_id, period_key, skipped_reason)
      values ('${ORG}','${CONTATO}','2026-W43', 'o cliente estava ocupado'); rollback;`);

    expect(cruzado ?? SEM_ERRO, "cliente de outro tenant entrou em reminder_runs").toContain("reminder_runs_customer_tenant_fkey");
    expect(envioSemCorte ?? SEM_ERRO).toContain("reminder_runs_envio_coerente");
    expect(tardeSemResposta ?? SEM_ERRO).toContain("reminder_runs_resposta_coerente");
    expect(tarefaEDenegacao ?? SEM_ERRO).toContain("reminder_runs_tarefa_coerente");
    expect(puloEmProsa ?? SEM_ERRO).toContain("reminder_runs_skipped_reason_check");
    console.info("f05-t06-checks: fk_cruzada=1/1 envio=1/1 resposta=1/1 tarefa=1/1 pulo_em_prosa=1/1");
  });

  it("conversations.saas_tags só aceita awaiting_quantity; job_queue.kind aceita os dois kinds e os herdados", () => {
    const tagValida = erroDe(`begin; update public.conversations set saas_tags = array['awaiting_quantity'] where id='${CONVERSA}'; rollback;`);
    const tagLivre = erroDe(`begin; update public.conversations set saas_tags = array['vip'] where id='${CONVERSA}'; rollback;`);
    const kinds = sql(`
      select string_agg(k, ',' order by k) from (
        select unnest(regexp_matches(pg_get_constraintdef(oid), '''([a-z_]+)''', 'g')) as k
          from pg_constraint where conrelid='public.job_queue'::regclass and conname='job_queue_kind_check'
      ) x;
    `).trim();
    const kindNovo = erroDe(`begin;
      insert into public.job_queue (organization_id, contact_id, kind, payload, status)
      values ('${ORG}', null, 'recurring_reminder', '{"organization_id":"${ORG}"}'::jsonb, 'done'); rollback;`);

    expect(tagValida).toBeNull();
    expect(tagLivre ?? SEM_ERRO).toContain("conversations_saas_tags_check");
    for (const k of ["recurring_reminder", "recurring_reminder_cutoff", "outbound_message", "inbound_turn", "watchdog", "flywheel"]) {
      expect(kinds.split(","), `job_queue_kind_check perdeu ${k}`).toContain(k);
    }
    expect(kindNovo, "job_queue recusou o kind recurring_reminder").toBeNull();
    console.info(`f05-t06-vocabulario: tag_valida=1/1 tag_livre_recusada=1/1 kinds=${kinds.split(",").length}/11 kind_novo_aceito=1/1`);
  });
});

describe("F05-T06 — prova comportamental de RLS nos dois tenants", () => {
  it("authenticated recebe permission denied nas quatro operações, em A e B", () => {
    const usuarios = [USER_A, USER_B] as const;
    let negadas = 0;
    for (const usuario of usuarios) {
      for (const operacao of OPERACOES) {
        const motivo = erroSob("authenticated", comandoDe(operacao), usuario);
        expect(motivo ?? SEM_ERRO, `authenticated (${usuario}) alcançou reminder_runs no ${operacao}`).toContain("permission denied");
        negadas += 1;
      }
    }
    expect(negadas).toBe(OPERACOES.length * usuarios.length);
    console.info(`f05-t06-rls: authenticated_negado=${negadas}/${OPERACOES.length * usuarios.length}`);
  });

  it("anon recebe permission denied nas quatro operações", () => {
    let negadas = 0;
    for (const operacao of OPERACOES) {
      const motivo = erroSob("anon", comandoDe(operacao));
      expect(motivo ?? SEM_ERRO, `anon alcançou reminder_runs no ${operacao}`).toContain("permission denied");
      negadas += 1;
    }
    expect(negadas).toBe(OPERACOES.length);
    console.info(`f05-t06-rls: anon_negado=${negadas}/${OPERACOES.length}`);
  });

  it("service_role continua escrevendo e lendo (guarda de vacuidade)", () => {
    let permitidas = 0;
    for (const operacao of OPERACOES) {
      const motivo = erroSob("service_role", comandoDe(operacao));
      expect(motivo, `service_role perdeu o ${operacao} em reminder_runs`).toBeNull();
      permitidas += 1;
    }
    const lida =
      sql(`
        begin;
        set local role service_role;
        ${insercao(ORG, CONTATO)};
        select count(*)::text || '/1' from public.reminder_runs where organization_id='${ORG}' and customer_id='${CONTATO}';
        rollback;
      `)
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^\d+\/\d+$/.test(l))
        .at(-1) ?? "";
    expect(lida).toBe("1/1");
    console.info(`f05-t06-rls: service_role_permitido=${permitidas}/${OPERACOES.length} linha_lida_de_volta=${lida}`);
  });
});
