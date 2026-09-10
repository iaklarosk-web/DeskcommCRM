// Destino previsto: tests/invariants/f02-t03-work-schema.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "@/tests/invariants/psql-transporte";

const LEGACY_SAFETY_MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260909191659_9009_crm_tarefas_legado_seguro.sql"),
  "utf8",
);

const ORG_A = "f0200003-0000-4000-8000-000000000001";
const ORG_B = "f0200003-0000-4000-8000-000000000002";
const USER_A = "f0200003-1000-4000-8000-000000000001";
const USER_B = "f0200003-1000-4000-8000-000000000002";
const CONTACT_A = "f0200003-2000-4000-8000-000000000001";
const CONTACT_B = "f0200003-2000-4000-8000-000000000002";
const ORDER_A = "f0200003-3000-4000-8000-000000000001";
const ORDER_B = "f0200003-3000-4000-8000-000000000002";
const TASK_A = "f0200003-4000-4000-8000-000000000001";
const TASK_B = "f0200003-4000-4000-8000-000000000002";
const RECEIPT_A = "f0200003-5000-4000-8000-000000000001";
const RECEIPT_B = "f0200003-5000-4000-8000-000000000002";
const NOTE_A = "f0200003-6000-4000-8000-000000000001";
const NOTE_B = "f0200003-6000-4000-8000-000000000002";

function claims(userId: string): string {
  return `select set_config('request.jwt.claims','{"sub":"${userId}"}',true);`;
}

function erroSob(role: "anon" | "authenticated" | "service_role", command: string, user?: string) {
  try {
    sql(`
      begin;
      set local role ${role};
      ${user ? claims(user) : ""}
      ${command};
      rollback;
    `);
    return null;
  } catch (error) {
    return motivoDoErro(error);
  }
}

function affectedAs(user: string, dml: string): number {
  const out = sql(`
    begin;
    set local role authenticated;
    ${claims(user)}
    with changed as (${dml} returning 1) select count(*) from changed;
    rollback;
  `);
  const last = out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line))
    .at(-1);
  if (!last || !/^\d+$/.test(last)) throw new Error(`saída DML inesperada: ${out}`);
  return Number(last);
}

beforeAll(() => {
  sql(`
    insert into auth.users(id,email) values
      ('${USER_A}','f02-t03-a@invariant.test'),
      ('${USER_B}','f02-t03-b@invariant.test');
    insert into public.organizations(id,slug,legal_name,display_name) values
      ('${ORG_A}','f02-t03-a','F02 T03 A','F02 T03 A'),
      ('${ORG_B}','f02-t03-b','F02 T03 B','F02 T03 B');
    insert into public.user_organizations(organization_id,user_id,role,accepted_at) values
      ('${ORG_A}','${USER_A}','agent',now()),
      ('${ORG_B}','${USER_B}','agent',now());
    insert into public.contacts(id,organization_id,display_name) values
      ('${CONTACT_A}','${ORG_A}','Contato A'),
      ('${CONTACT_B}','${ORG_B}','Contato B');
    insert into public.crm_orders
      (id,organization_id,contact_id,source,status,created_by_actor_type,created_by_actor_id)
    values
      ('${ORDER_A}','${ORG_A}','${CONTACT_A}','ui','draft','user','${USER_A}'),
      ('${ORDER_B}','${ORG_B}','${CONTACT_B}','ui','draft','user','${USER_B}');
    insert into public.crm_tasks
      (id,organization_id,title,contact_id,order_id,created_by,revision)
    values
      ('${TASK_A}','${ORG_A}','Tarefa vinculada A','${CONTACT_A}','${ORDER_A}','${USER_A}',1),
      ('${TASK_B}','${ORG_B}','Tarefa vinculada B','${CONTACT_B}','${ORDER_B}','${USER_B}',1);
    insert into public.crm_task_command_receipts
      (id,organization_id,command_type,request_hash,actor_type,actor_id,
       result_task_id,result_task_revision,result_status)
    values
      ('${RECEIPT_A}','${ORG_A}','create_linked_task',decode(repeat('0a',32),'hex'),
       'user','${USER_A}','${TASK_A}',1,'pending'),
      ('${RECEIPT_B}','${ORG_B}','create_linked_task',decode(repeat('0b',32),'hex'),
       'user','${USER_B}','${TASK_B}',1,'pending');
    insert into public.crm_task_events
      (id,organization_id,task_id,order_id,contact_id,task_revision,event_type,
       from_status,to_status,actor_type,actor_id)
    values
      ('${RECEIPT_A}','${ORG_A}','${TASK_A}','${ORDER_A}','${CONTACT_A}',1,
       'created',null,'pending','user','${USER_A}'),
      ('${RECEIPT_B}','${ORG_B}','${TASK_B}','${ORDER_B}','${CONTACT_B}',1,
       'created',null,'pending','user','${USER_B}');
    insert into public.crm_notes
      (id,organization_id,contact_id,order_id,body,actor_user_id)
    values
      ('${NOTE_A}','${ORG_A}','${CONTACT_A}','${ORDER_A}','Nota A','${USER_A}'),
      ('${NOTE_B}','${ORG_B}','${CONTACT_B}','${ORDER_B}','Nota B','${USER_B}');
  `);
});

describe("F02-T03 — RLS e postura de notas/tarefas vinculadas", () => {
  it("mantém notas/eventos append-only e receipts privados por ACL", () => {
    const result = sql(`
      select
        has_table_privilege('authenticated','public.crm_notes','select')::int,
        has_table_privilege('authenticated','public.crm_task_events','select')::int,
        (has_table_privilege('authenticated','public.crm_notes','insert') or
         has_table_privilege('authenticated','public.crm_notes','update') or
         has_table_privilege('authenticated','public.crm_notes','delete'))::int,
        (has_table_privilege('authenticated','public.crm_task_events','insert') or
         has_table_privilege('authenticated','public.crm_task_events','update') or
         has_table_privilege('authenticated','public.crm_task_events','delete'))::int,
        (has_table_privilege('authenticated','public.crm_task_command_receipts','select') or
         has_table_privilege('authenticated','public.crm_task_command_receipts','insert') or
         has_table_privilege('authenticated','public.crm_task_command_receipts','update') or
         has_table_privilege('authenticated','public.crm_task_command_receipts','delete'))::int,
        (has_table_privilege('anon','public.crm_notes','select') or
         has_table_privilege('anon','public.crm_notes','insert') or
         has_table_privilege('anon','public.crm_notes','update') or
         has_table_privilege('anon','public.crm_notes','delete') or
         has_table_privilege('anon','public.crm_task_events','select') or
         has_table_privilege('anon','public.crm_task_events','insert') or
         has_table_privilege('anon','public.crm_task_events','update') or
         has_table_privilege('anon','public.crm_task_events','delete') or
         has_table_privilege('anon','public.crm_task_command_receipts','select') or
         has_table_privilege('anon','public.crm_task_command_receipts','insert') or
         has_table_privilege('anon','public.crm_task_command_receipts','update') or
         has_table_privilege('anon','public.crm_task_command_receipts','delete'))::int,
        (has_table_privilege('service_role','public.crm_notes','select') and
         has_table_privilege('service_role','public.crm_notes','insert') and
         has_table_privilege('service_role','public.crm_task_events','select') and
         has_table_privilege('service_role','public.crm_task_events','insert') and
         has_table_privilege('service_role','public.crm_task_command_receipts','select') and
         has_table_privilege('service_role','public.crm_task_command_receipts','insert'))::int,
        (has_table_privilege('service_role','public.crm_notes','update') or
         has_table_privilege('service_role','public.crm_notes','delete') or
         has_table_privilege('service_role','public.crm_task_events','update') or
         has_table_privilege('service_role','public.crm_task_events','delete') or
         has_table_privilege('service_role','public.crm_task_command_receipts','update') or
         has_table_privilege('service_role','public.crm_task_command_receipts','delete'))::int,
        (select count(*) from pg_policies
          where schemaname='public' and tablename='crm_task_command_receipts');
    `);
    expect(result, "ACL T03 expôs receipt privado ou abriu escrita no domínio append-only").toBe(
      "1|1|0|0|0|0|1|0|0",
    );
  });

  it("membros leem notas, eventos e tarefas somente no próprio tenant nos dois sentidos", () => {
    for (const [user, ownOrg, otherOrg] of [
      [USER_A, ORG_A, ORG_B],
      [USER_B, ORG_B, ORG_A],
    ] as const) {
      const result = sql(`
        begin;
        set local role authenticated;
        ${claims(user)}
        select
          (select count(*) from public.crm_notes where organization_id='${ownOrg}'),
          (select count(*) from public.crm_notes where organization_id='${otherOrg}'),
          (select count(*) from public.crm_task_events where organization_id='${ownOrg}'),
          (select count(*) from public.crm_task_events where organization_id='${otherOrg}'),
          (select count(*) from public.crm_tasks where organization_id='${ownOrg}' and order_id is not null),
          (select count(*) from public.crm_tasks where organization_id='${otherOrg}' and order_id is not null);
        rollback;
      `);
      expect(result, `isolamento T03 falhou para ${user}`).toContain("1|0|1|0|1|0");
    }
  });

  it("authenticated recebe permission denied nas quatro operações do receipt em A e B", () => {
    for (const [user, org] of [
      [USER_A, ORG_A],
      [USER_B, ORG_B],
    ] as const) {
      for (const command of [
        "select count(*) from public.crm_task_command_receipts",
        `insert into public.crm_task_command_receipts
          (id,organization_id,command_type,request_hash,actor_type,result_task_id,result_task_revision,result_status)
         values(gen_random_uuid(),'${org}','create_linked_task',decode(repeat('00',32),'hex'),'user',gen_random_uuid(),1,'pending')`,
        "update public.crm_task_command_receipts set result_status='done'",
        "delete from public.crm_task_command_receipts",
      ]) {
        expect(
          erroSob("authenticated", command, user),
          `authenticated executou receipt T03 (${user}): ${command}`,
        ).toContain("permission denied");
      }
    }
  });

  it("bloqueia INSERT/UPDATE/DELETE diretos da tarefa vinculada nos dois tenants", () => {
    for (const [user, org, contact, order, linkedTask] of [
      [USER_A, ORG_A, CONTACT_A, ORDER_A, TASK_A],
      [USER_B, ORG_B, CONTACT_B, ORDER_B, TASK_B],
    ] as const) {
      expect(
        erroSob(
          "authenticated",
          `insert into public.crm_tasks
            (organization_id,title,contact_id,order_id)
           values('${org}','Forjada','${contact}','${order}')`,
          user,
        ),
      ).toContain("row-level security");
      expect(
        affectedAs(user, `update public.crm_tasks set title='Forjada' where id='${linkedTask}'`),
      ).toBe(0);
      expect(affectedAs(user, `delete from public.crm_tasks where id='${linkedTask}'`)).toBe(0);
    }
  });

  it("preserva CRUD authenticated da tarefa legada sem order_id", () => {
    const legacy = "f0200003-7000-4000-8000-000000000001";
    expect(
      affectedAs(
        USER_A,
        `insert into public.crm_tasks(id,organization_id,title)
         values('${legacy}','${ORG_A}','Legada')`,
      ),
    ).toBe(1);
    // O helper revoga a transação; materializa a linha para os dois controles seguintes.
    sql(
      `insert into public.crm_tasks(id,organization_id,title)
       values('${legacy}','${ORG_A}','Legada')`,
    );
    expect(
      affectedAs(USER_A, `update public.crm_tasks set title='Legada 2' where id='${legacy}'`),
    ).toBe(1);
    expect(affectedAs(USER_A, `delete from public.crm_tasks where id='${legacy}'`)).toBe(1);
  });

  it("service_role insere, mas não altera ou exclui notas/eventos/receipts", () => {
    for (const table of ["crm_notes", "crm_task_events", "crm_task_command_receipts"]) {
      expect(
        erroSob("service_role", `update public.${table} set organization_id=organization_id`),
      ).toContain("permission denied");
      expect(erroSob("service_role", `delete from public.${table}`)).toContain("permission denied");
    }
  });

  it("DELETE organization remove tarefa vinculada, receipt, evento e nota", () => {
    const result = sql(`
      begin;
      do $proof$
      declare
        v_org uuid := 'f0200003-8000-4000-8000-000000000001';
        v_contact uuid := 'f0200003-8000-4000-8000-000000000002';
        v_order uuid := 'f0200003-8000-4000-8000-000000000003';
        v_task uuid := 'f0200003-8000-4000-8000-000000000004';
        v_receipt uuid := 'f0200003-8000-4000-8000-000000000005';
        v_note uuid := 'f0200003-8000-4000-8000-000000000006';
      begin
        insert into public.organizations(id,slug,legal_name,display_name)
          values(v_org,'f02-t03-cascade','F02 T03 Cascade','F02 T03 Cascade');
        insert into public.contacts(id,organization_id,display_name)
          values(v_contact,v_org,'Contato cascade');
        insert into public.crm_orders
          (id,organization_id,contact_id,source,created_by_actor_type)
          values(v_order,v_org,v_contact,'ui','user');
        insert into public.crm_tasks
          (id,organization_id,title,contact_id,order_id)
          values(v_task,v_org,'Tarefa cascade',v_contact,v_order);
        insert into public.crm_task_command_receipts
          (id,organization_id,command_type,request_hash,actor_type,
           result_task_id,result_task_revision,result_status)
          values(v_receipt,v_org,'create_linked_task',decode(repeat('ca',32),'hex'),
                 'user',v_task,1,'pending');
        insert into public.crm_task_events
          (id,organization_id,task_id,order_id,contact_id,task_revision,event_type,
           from_status,to_status,actor_type)
          values(v_receipt,v_org,v_task,v_order,v_contact,1,'created',null,'pending','user');
        insert into public.crm_notes
          (id,organization_id,contact_id,order_id,body,actor_user_id)
          values(v_note,v_org,v_contact,v_order,'Nota cascade',v_receipt);
        delete from public.organizations where id=v_org;
        if exists(select 1 from public.contacts where organization_id=v_org)
          or exists(select 1 from public.crm_orders where organization_id=v_org)
          or exists(select 1 from public.crm_tasks where organization_id=v_org)
          or exists(select 1 from public.crm_task_command_receipts where organization_id=v_org)
          or exists(select 1 from public.crm_task_events where organization_id=v_org)
          or exists(select 1 from public.crm_notes where organization_id=v_org)
        then
          raise exception 'f02_t03_organization_cascade_incomplete';
        end if;
      end
      $proof$;
      rollback;
      select 'cascade-proved';
    `);
    expect(result).toContain("cascade-proved");
  });

  it("instala a FK validada e mantém o guard de anonimização privado", () => {
    const result = sql(`
      select
        (select count(*) from pg_constraint
          where conrelid='public.crm_tasks'::regclass
            and conname='crm_tasks_contact_tenant_fkey'
            and convalidated),
        (select count(*) from pg_trigger
          where tgrelid='public.crm_tasks'::regclass
            and tgname='trg_crm_tasks_guard_anonymized_contact'
            and tgenabled='O' and not tgisinternal),
        (select count(*) from pg_proc
          where oid='public.fn_crm_tasks_guard_anonymized_contact()'::regprocedure
            and prosecdef
            and pg_get_userbyid(proowner)='postgres'),
        (select count(*) from pg_proc p,
          lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
          where p.oid='public.fn_crm_tasks_guard_anonymized_contact()'::regprocedure
            and acl.grantee=0 and acl.privilege_type='EXECUTE'),
        has_function_privilege('anon','public.fn_crm_tasks_guard_anonymized_contact()','execute')::int,
        has_function_privilege('authenticated','public.fn_crm_tasks_guard_anonymized_contact()','execute')::int,
        has_function_privilege('service_role','public.fn_crm_tasks_guard_anonymized_contact()','execute')::int,
        (select count(*) from pg_trigger
          where tgrelid='public.contacts'::regclass
            and tgname='trg_redigir_tarefas_ao_anonimizar'
            and tgenabled='O' and not tgisinternal);
    `);
    expect(result, "guard de tarefa não ficou privado, ativo e compatível com a redação 0210").toBe(
      "1|1|1|0|0|0|0|1",
    );
  });

  it("9008 falha sobre legado contaminado; 9009 repara uma vez sem perder tarefa", () => {
    const result = sql(`
      begin;
      insert into public.organizations(id,slug,legal_name,display_name) values
        ('f0200003-9000-4000-8000-000000000001','f02-t03-upgrade-a','Upgrade A','Upgrade A'),
        ('f0200003-9000-4000-8000-000000000002','f02-t03-upgrade-b','Upgrade B','Upgrade B');
      insert into public.contacts(id,organization_id,display_name,is_anonymized,anonymized_at) values
        ('f0200003-9100-4000-8000-000000000001','f0200003-9000-4000-8000-000000000002','Contato B ativo',false,null),
        ('f0200003-9100-4000-8000-000000000002','f0200003-9000-4000-8000-000000000002','Contato B anonimizado',true,now()),
        ('f0200003-9100-4000-8000-000000000003','f0200003-9000-4000-8000-000000000001','Contato A anonimizado',true,now());

      alter table public.crm_tasks drop constraint crm_tasks_contact_tenant_fkey;
      drop trigger trg_crm_tasks_guard_anonymized_contact on public.crm_tasks;
      insert into public.crm_tasks(id,organization_id,title,description,contact_id) values
        ('f0200003-9200-4000-8000-000000000001','f0200003-9000-4000-8000-000000000001','Título preservado','Descrição preservada','f0200003-9100-4000-8000-000000000001'),
        ('f0200003-9200-4000-8000-000000000002','f0200003-9000-4000-8000-000000000001','PII cross antiga','PII cross descrição','f0200003-9100-4000-8000-000000000002'),
        ('f0200003-9200-4000-8000-000000000003','f0200003-9000-4000-8000-000000000001','PII tardia','PII tardia descrição','f0200003-9100-4000-8000-000000000003');

      -- O baseline de prova já contém a FK diferível de pedido da 9008. Ela não
      -- existia no upgrade real pré-9008; materializar seus eventos pendentes
      -- impede que o artefato posterior masque a 23503 do vínculo contaminado.
      set constraints all immediate;

      -- Esta é a DDL da 9008. Sem o pré-requisito, a validação precisa falhar
      -- sobre a fixture contaminada, em vez de a prova apenas supor o problema.
      do $proof$
      declare v_failed boolean := false;
      begin
        begin
          execute $ddl$
            alter table public.crm_tasks
              add constraint crm_tasks_contact_tenant_fkey
              foreign key (organization_id, contact_id)
              references public.contacts (organization_id, id)
              on delete set null (contact_id)
          $ddl$;
        exception when foreign_key_violation then
          v_failed := true;
        end;
        if not v_failed then
          raise exception '9008 aceitou vínculo legado cross-tenant sem 9009';
        end if;
      end
      $proof$;

      ${LEGACY_SAFETY_MIGRATION}
      do $proof$
      begin
        if not exists (
          select 1 from public.crm_tasks
           where id='f0200003-9200-4000-8000-000000000001'
             and contact_id is null
             and title='Título preservado'
             and description='Descrição preservada'
        ) then raise exception 'reparo alterou tarefa cross-tenant ativa além do vínculo'; end if;
        if not exists (
          select 1 from public.crm_tasks
           where id='f0200003-9200-4000-8000-000000000002'
             and contact_id is null
             and title='Tarefa anonimizada'
             and description is null
        ) then raise exception 'reparo não redigiu contato cross-tenant já anonimizado'; end if;
        if not exists (
          select 1 from public.crm_tasks
           where id='f0200003-9200-4000-8000-000000000003'
             and contact_id='f0200003-9100-4000-8000-000000000003'
             and title='Tarefa anonimizada'
             and description is null
        ) then raise exception 'backfill não redigiu texto tardio no tenant correto'; end if;
        if (
          select count(*) from public.api_audit_log
           where resource_id in (
             'f0200003-9200-4000-8000-000000000001',
             'f0200003-9200-4000-8000-000000000002',
             'f0200003-9200-4000-8000-000000000003'
           )
             and action='crm_task.updated'
        ) <> 3 then raise exception 'reparo não gerou exatamente três audits técnicos'; end if;
        if exists (
          select 1 from public.api_audit_log
           where resource_id in (
             'f0200003-9200-4000-8000-000000000001',
             'f0200003-9200-4000-8000-000000000002',
             'f0200003-9200-4000-8000-000000000003'
           )
             and metadata::text ~ 'Título|Descrição|PII'
        ) then raise exception 'audit técnico copiou texto da tarefa'; end if;
      end
      $proof$;

      ${LEGACY_SAFETY_MIGRATION}
      do $proof$
      begin
        if (
          select count(*) from public.api_audit_log
           where resource_id in (
             'f0200003-9200-4000-8000-000000000001',
             'f0200003-9200-4000-8000-000000000002',
             'f0200003-9200-4000-8000-000000000003'
           ) and action='crm_task.updated'
        ) <> 3 then raise exception 'reaplicação duplicou audit técnico'; end if;
        if not exists (
          select 1 from pg_constraint
           where conrelid='public.crm_tasks'::regclass
             and conname='crm_tasks_contact_tenant_fkey' and convalidated
        ) then raise exception 'FK composta não terminou validada'; end if;
      end
      $proof$;
      rollback;
      select 'legacy-upgrade-proved';
    `);
    expect(result).toContain("legacy-upgrade-proved");
  });

  it("redige INSERT e UPDATE tardios sem alterar tarefa de contato ativo", () => {
    const result = sql(`
      begin;
      insert into public.organizations(id,slug,legal_name,display_name)
        values('f0200003-a000-4000-8000-000000000001','f02-t03-late-write','Late write','Late write');
      insert into public.contacts(id,organization_id,display_name,is_anonymized,anonymized_at) values
        ('f0200003-a100-4000-8000-000000000001','f0200003-a000-4000-8000-000000000001','Contato anonimizado',true,now()),
        ('f0200003-a100-4000-8000-000000000002','f0200003-a000-4000-8000-000000000001','Contato ativo',false,null);
      insert into public.crm_tasks(id,organization_id,title,description,contact_id) values
        ('f0200003-a200-4000-8000-000000000001','f0200003-a000-4000-8000-000000000001','PII no insert','PII na descrição','f0200003-a100-4000-8000-000000000001'),
        ('f0200003-a200-4000-8000-000000000002','f0200003-a000-4000-8000-000000000001','Texto operacional','Descrição operacional','f0200003-a100-4000-8000-000000000002');
      update public.crm_tasks
         set title='PII no update',description='PII novamente'
       where id='f0200003-a200-4000-8000-000000000001';
      update public.crm_tasks
         set title='Texto operacional 2',description='Descrição operacional 2'
       where id='f0200003-a200-4000-8000-000000000002';
      do $proof$
      begin
        if not exists (
          select 1 from public.crm_tasks
           where id='f0200003-a200-4000-8000-000000000001'
             and title='Tarefa anonimizada' and description is null
        ) then raise exception 'guard deixou PII tardia ligada ao contato anonimizado'; end if;
        if not exists (
          select 1 from public.crm_tasks
           where id='f0200003-a200-4000-8000-000000000002'
             and title='Texto operacional 2' and description='Descrição operacional 2'
        ) then raise exception 'guard alterou tarefa de contato ativo'; end if;
      end
      $proof$;
      rollback;
      select 'late-write-redacted';
    `);
    expect(result, "guard deixou PII tardia ligada ao contato anonimizado").toContain(
      "late-write-redacted",
    );
  });
});
