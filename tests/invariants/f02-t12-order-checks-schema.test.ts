import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "@/tests/invariants/psql-transporte";

const migrationName = readdirSync(join(process.cwd(), "supabase/migrations")).find((name) =>
  name.endsWith("_9012_crm_order_checks.sql"),
);
if (!migrationName) throw new Error("migration 9012 de conferência ausente");
const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations", migrationName), "utf8");

const ORG_A = "f0200012-0000-4000-8000-000000000001";
const ORG_B = "f0200012-0000-4000-8000-000000000002";
const USER_A = "f0200012-1000-4000-8000-000000000001";
const USER_B = "f0200012-1000-4000-8000-000000000002";
const CONTACT_A = "f0200012-2000-4000-8000-000000000001";
const CONTACT_B = "f0200012-2000-4000-8000-000000000002";
const ORDER_A = "f0200012-3000-4000-8000-000000000001";
const ORDER_B = "f0200012-3000-4000-8000-000000000002";
const ITEM_A = "f0200012-4000-4000-8000-000000000001";
const ITEM_B = "f0200012-4000-4000-8000-000000000002";
const RECEIPT_A = "f0200012-5000-4000-8000-000000000001";
const RECEIPT_B = "f0200012-5000-4000-8000-000000000002";

function claims(userId: string): string {
  return `select set_config('request.jwt.claims','{"sub":"${userId}"}',true);`;
}

function erroSob(role: "anon" | "authenticated" | "service_role", command: string, user?: string) {
  try {
    sql(`begin; set local role ${role}; ${user ? claims(user) : ""} ${command}; rollback;`);
    return null;
  } catch (error) {
    return motivoDoErro(error);
  }
}

beforeAll(() => {
  sql(`
    insert into auth.users(id,email) values
      ('${USER_A}','f02-t12-a@invariant.test'),
      ('${USER_B}','f02-t12-b@invariant.test');
    insert into public.organizations(id,slug,legal_name,display_name) values
      ('${ORG_A}','f02-t12-a','F02 T12 A','F02 T12 A'),
      ('${ORG_B}','f02-t12-b','F02 T12 B','F02 T12 B');
    insert into public.user_organizations(organization_id,user_id,role,accepted_at) values
      ('${ORG_A}','${USER_A}','viewer',now()),
      ('${ORG_B}','${USER_B}','viewer',now());
    insert into public.contacts(id,organization_id,display_name) values
      ('${CONTACT_A}','${ORG_A}','Contato A'),
      ('${CONTACT_B}','${ORG_B}','Contato B');
    insert into public.crm_orders
      (id,organization_id,contact_id,source,status,created_by_actor_type,created_by_actor_id)
    values
      ('${ORDER_A}','${ORG_A}','${CONTACT_A}','ui','draft','user','${USER_A}'),
      ('${ORDER_B}','${ORG_B}','${CONTACT_B}','ui','draft','user','${USER_B}');
    insert into public.crm_order_items
      (id,organization_id,order_id,position,requested_text,quantity,sale_unit_snapshot)
    values
      ('${ITEM_A}','${ORG_A}','${ORDER_A}',1,'Item A',2.000,'kg'),
      ('${ITEM_B}','${ORG_B}','${ORDER_B}',1,'Item B',4.000,'cx');
    insert into public.crm_order_check_command_receipts
      (id,organization_id,idempotency_key,request_hash,actor_user_id,order_id,response_body,completed_at)
    values
      ('${RECEIPT_A}','${ORG_A}',gen_random_uuid(),decode(repeat('1a',32),'hex'),'${USER_A}',
       '${ORDER_A}','{}',now()),
      ('${RECEIPT_B}','${ORG_B}',gen_random_uuid(),decode(repeat('1b',32),'hex'),'${USER_B}',
       '${ORDER_B}','{}',now());
    insert into public.crm_order_check_events
      (organization_id,receipt_id,order_id,order_revision,event_no,item_id,
       ordered_quantity_snapshot,checked_quantity,sale_unit_snapshot,check_state,actor_user_id)
    values
      ('${ORG_A}','${RECEIPT_A}','${ORDER_A}',1,1,'${ITEM_A}',2.000,1.000,'kg','partial','${USER_A}'),
      ('${ORG_B}','${RECEIPT_B}','${ORDER_B}',1,1,'${ITEM_B}',4.000,4.000,'cx','checked','${USER_B}');
  `);
});

describe("F02-T12 — schema, RLS e grants da conferência", () => {
  it("mantém recibos privados, eventos append-only e função security invoker", () => {
    const result = sql(`
      select
        (select relrowsecurity::int from pg_class where oid='public.crm_order_check_command_receipts'::regclass),
        (select relrowsecurity::int from pg_class where oid='public.crm_order_check_events'::regclass),
        (select count(*) from pg_policies where schemaname='public' and tablename='crm_order_check_command_receipts'),
        has_table_privilege('authenticated','public.crm_order_check_events','select')::int,
        (has_table_privilege('authenticated','public.crm_order_check_events','insert') or
         has_table_privilege('authenticated','public.crm_order_check_events','update') or
         has_table_privilege('authenticated','public.crm_order_check_events','delete'))::int,
        (has_table_privilege('authenticated','public.crm_order_check_command_receipts','select') or
         has_table_privilege('authenticated','public.crm_order_check_command_receipts','insert') or
         has_table_privilege('authenticated','public.crm_order_check_command_receipts','update') or
         has_table_privilege('authenticated','public.crm_order_check_command_receipts','delete'))::int,
        (has_table_privilege('anon','public.crm_order_check_events','select') or
         has_table_privilege('anon','public.crm_order_check_command_receipts','select'))::int,
        (has_table_privilege('service_role','public.crm_order_check_events','select') and
         has_table_privilege('service_role','public.crm_order_check_events','insert') and
         has_table_privilege('service_role','public.crm_order_check_command_receipts','select') and
         has_table_privilege('service_role','public.crm_order_check_command_receipts','insert') and
         has_table_privilege('service_role','public.crm_order_check_command_receipts','update'))::int,
        (has_table_privilege('service_role','public.crm_order_check_events','update') or
         has_table_privilege('service_role','public.crm_order_check_events','delete') or
         has_table_privilege('service_role','public.crm_order_check_command_receipts','delete'))::int,
        has_function_privilege('authenticated','public.fn_crm_order_checks(uuid,uuid,integer,text)','execute')::int,
        has_function_privilege('anon','public.fn_crm_order_checks(uuid,uuid,integer,text)','execute')::int,
        (select prosecdef::int from pg_proc where oid='public.fn_crm_order_checks(uuid,uuid,integer,text)'::regprocedure),
        has_sequence_privilege('service_role','public.crm_order_check_events_event_sequence_seq','usage')::int,
        has_sequence_privilege('authenticated','public.crm_order_check_events_event_sequence_seq','usage')::int;
    `);
    expect(result, "ACL expôs recibo/hash ou abriu escrita no journal").toBe(
      "1|1|0|1|0|0|0|1|0|1|0|0|1|0",
    );
  });

  it("membros leem somente eventos e estado do próprio tenant nos dois sentidos", () => {
    for (const [user, ownOrg, ownOrder, otherOrg, otherOrder] of [
      [USER_A, ORG_A, ORDER_A, ORG_B, ORDER_B],
      [USER_B, ORG_B, ORDER_B, ORG_A, ORDER_A],
    ] as const) {
      const result = sql(`
        begin; set local role authenticated; ${claims(user)}
        select
          (select count(*) from public.crm_order_check_events where organization_id='${ownOrg}'),
          (select count(*) from public.crm_order_check_events where organization_id='${otherOrg}'),
          (public.fn_crm_order_checks('${ownOrg}','${ownOrder}',50,null)->>'order_id'='${ownOrder}')::int,
          (public.fn_crm_order_checks('${otherOrg}','${otherOrder}',50,null) is null)::int;
        rollback;
      `);
      expect(result, `vazamento de conferência para ${user}`).toContain("1|0|1|1");
    }
  });

  it("nega quatro operações authenticated no recibo em A e B", () => {
    for (const [user, org] of [
      [USER_A, ORG_A],
      [USER_B, ORG_B],
    ] as const) {
      for (const command of [
        "select count(*) from public.crm_order_check_command_receipts",
        `insert into public.crm_order_check_command_receipts
          (organization_id,idempotency_key,request_hash,actor_user_id)
         values('${org}',gen_random_uuid(),decode(repeat('00',32),'hex'),'${user}')`,
        "update public.crm_order_check_command_receipts set completed_at=completed_at",
        "delete from public.crm_order_check_command_receipts",
      ]) {
        expect(erroSob("authenticated", command, user), command).toContain("permission denied");
      }
    }
  });

  it("nega escrita direta de eventos e preserva leitura authenticated", () => {
    for (const [user, org] of [
      [USER_A, ORG_A],
      [USER_B, ORG_B],
    ] as const) {
      expect(erroSob("authenticated", "select count(*) from public.crm_order_check_events", user)).toBeNull();
      expect(
        erroSob(
          "authenticated",
          `insert into public.crm_order_check_events
            (organization_id,receipt_id,order_id,order_revision,event_no,item_id,
             checked_quantity,check_state,actor_user_id)
           values('${org}',gen_random_uuid(),gen_random_uuid(),1,1,gen_random_uuid(),0,'pending','${user}')`,
          user,
        ),
      ).toContain("permission denied");
      expect(erroSob("authenticated", "update public.crm_order_check_events set event_no=event_no", user)).toContain("permission denied");
      expect(erroSob("authenticated", "delete from public.crm_order_check_events", user)).toContain("permission denied");
    }
  });

  it("impõe estados exatos para zero, parcial e conferido", () => {
    const invalid = [
      "null,1.000,null,'partial'",
      "2.000,0.000,'kg','partial'",
      "2.000,1.000,'kg','checked'",
      "2.000,2.001,'kg','checked'",
      "2.000,2.000,'kg','partial'",
      "2.000,1.000,null,'partial'",
    ];
    for (const [index, values] of invalid.entries()) {
      const receipt = `f0200012-5100-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const error = erroSob(
        "service_role",
        `insert into public.crm_order_check_command_receipts
          (id,organization_id,idempotency_key,request_hash,actor_user_id,order_id)
         values('${receipt}','${ORG_A}',gen_random_uuid(),decode(repeat('22',32),'hex'),'${USER_A}','${ORDER_A}');
         insert into public.crm_order_check_events
          (organization_id,receipt_id,order_id,order_revision,event_no,item_id,
           ordered_quantity_snapshot,checked_quantity,sale_unit_snapshot,check_state,actor_user_id)
         values('${ORG_A}','${receipt}','${ORDER_A}',1,${index + 2},'${ITEM_A}',${values},'${USER_A}')`,
      );
      expect(error, `forma inválida aceita: ${values}`).toContain(
        "crm_order_check_events_quantities_check",
      );
    }
  });

  it("não cria FK de item e mantém o evento ao remover item em revisão posterior", () => {
    const result = sql(`
      begin;
      delete from public.crm_order_items where organization_id='${ORG_A}' and id='${ITEM_A}';
      update public.crm_orders set revision=revision+1 where organization_id='${ORG_A}' and id='${ORDER_A}';
      select
        (select count(*) from pg_constraint c
          where c.conrelid='public.crm_order_check_events'::regclass and c.contype='f'
            and exists(select 1 from unnest(c.conkey) k
              join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k
             where a.attname='item_id')),
        (select count(*) from public.crm_order_items where id='${ITEM_A}'),
        (select count(*) from public.crm_order_check_events where item_id='${ITEM_A}');
      rollback;
    `);
    expect(result, "evento histórico restringiu a edição/removal do item").toContain("0|0|1");
  });

  it("usa FKs tenant compostas validadas e índices que começam pelas referências", () => {
    const result = sql(`
      select
        count(*) filter(where contype='f'),
        count(*) filter(where contype='f' and convalidated),
        count(*) filter(where conname like '%tenant_fkey')
      from pg_constraint where conrelid in(
        'public.crm_order_check_command_receipts'::regclass,
        'public.crm_order_check_events'::regclass
      );
    `);
    expect(result).toBe("5|5|3");
    expect(
      sql(`select count(*) from pg_indexes where schemaname='public' and indexname in(
        'crm_order_check_receipts_order_idx','crm_order_check_events_order_sequence_idx',
        'crm_order_check_events_current_item_idx')`),
    ).toBe("3");
  });

  it("remove o grafo completo ao excluir a organização", () => {
    const result = sql(`
      begin;
      delete from public.organizations where id='${ORG_A}';
      select
        (select count(*) from public.crm_order_check_events where organization_id='${ORG_A}'),
        (select count(*) from public.crm_order_check_command_receipts where organization_id='${ORG_A}'),
        (select count(*) from public.crm_orders where organization_id='${ORG_A}');
      rollback;
    `);
    expect(result, "FK RESTRICT impediu ou deixou órfãos no cascade da organização").toContain("0|0|0");
  });

  it("reaplica a migration sem perder recibos, eventos ou identidades", () => {
    const before = sql(`select
      (select id::text from public.crm_order_check_command_receipts where id='${RECEIPT_A}'),
      (select item_id::text from public.crm_order_check_events where receipt_id='${RECEIPT_A}'),
      (select count(*) from public.crm_order_check_events where organization_id in('${ORG_A}','${ORG_B}'))`);
    sql(MIGRATION);
    sql(MIGRATION);
    const after = sql(`select
      (select id::text from public.crm_order_check_command_receipts where id='${RECEIPT_A}'),
      (select item_id::text from public.crm_order_check_events where receipt_id='${RECEIPT_A}'),
      (select count(*) from public.crm_order_check_events where organization_id in('${ORG_A}','${ORG_B}'))`);
    expect(after).toBe(before);
  });
});
