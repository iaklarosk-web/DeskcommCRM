import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "./psql-transporte";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260909160605_9006_crm_pedidos_operacionais.sql"),
  "utf8",
);

const ORG_A = "f0200002-0000-4000-8000-000000000001";
const ORG_B = "f0200002-0000-4000-8000-000000000002";
const USER_A = "f0200002-1000-4000-8000-000000000001";
const USER_B = "f0200002-1000-4000-8000-000000000002";
const CONTACT_A = "f0200002-2000-4000-8000-000000000001";
const CONTACT_B = "f0200002-2000-4000-8000-000000000002";
const COMPANY_A = "f0200002-3000-4000-8000-000000000001";
const COMPANY_B = "f0200002-3000-4000-8000-000000000002";
const PRODUCT_A = "f0200002-4000-4000-8000-000000000001";
const PRODUCT_B = "f0200002-4000-4000-8000-000000000002";
const ORDER_A = "f0200002-5000-4000-8000-000000000001";
const ORDER_B = "f0200002-5000-4000-8000-000000000002";
const ITEM_A1 = "f0200002-6000-4000-8000-000000000001";
const ITEM_A2 = "f0200002-6000-4000-8000-000000000002";
const ITEM_B = "f0200002-6000-4000-8000-000000000003";
const RECEIPT_A = "f0200002-7000-4000-8000-000000000001";
const RECEIPT_B = "f0200002-7000-4000-8000-000000000002";
const EVENT_A = "f0200002-8000-4000-8000-000000000001";
const EVENT_B = "f0200002-8000-4000-8000-000000000002";
const SERVICE_RECEIPT = "f0200002-7000-4000-8000-000000000099";
const SERVICE_EVENT = "f0200002-8000-4000-8000-000000000099";
const LEGACY_ORDER = "f0200002-9000-4000-8000-000000000001";

function claims(userId: string): string {
  return `select set_config('request.jwt.claims','{"sub":"${userId}"}',true);`;
}

function erroSob(papel: string, comando: string, userId?: string): string | null {
  try {
    sql(`
      set role ${papel};
      ${userId ? claims(userId) : ""}
      ${comando};
      reset role;
    `);
    return null;
  } catch (error) {
    return motivoDoErro(error);
  }
}

beforeAll(() => {
  sql(`
    insert into auth.users(id,email) values
      ('${USER_A}','f02-t02-a@invariant.test'),
      ('${USER_B}','f02-t02-b@invariant.test');
    insert into public.organizations(id,slug,legal_name,display_name) values
      ('${ORG_A}','f02-t02-a','F02 T02 A','F02 T02 A'),
      ('${ORG_B}','f02-t02-b','F02 T02 B','F02 T02 B');
    insert into public.user_organizations(organization_id,user_id,role,accepted_at) values
      ('${ORG_A}','${USER_A}','agent',now()),
      ('${ORG_B}','${USER_B}','agent',now());
    insert into public.contacts(id,organization_id,display_name) values
      ('${CONTACT_A}','${ORG_A}','Contato A'),
      ('${CONTACT_B}','${ORG_B}','Contato B');
    insert into public.crm_companies(id,organization_id,legal_name) values
      ('${COMPANY_A}','${ORG_A}','Empresa A'),
      ('${COMPANY_B}','${ORG_B}','Empresa B');
    insert into public.catalog_products(id,organization_id,codigo,nome,preco_cents,sale_unit) values
      ('${PRODUCT_A}','${ORG_A}','F02-A','Produto A',100,'un'),
      ('${PRODUCT_B}','${ORG_B}','F02-B','Produto B',250,'kg');
    insert into public.crm_orders
      (id,organization_id,contact_id,company_id,company_name_snapshot,source,status,created_by_actor_type,created_by_actor_id)
      values
      ('${ORDER_A}','${ORG_A}','${CONTACT_A}','${COMPANY_A}','Empresa A no pedido','ui','draft','user','${USER_A}'),
      ('${ORDER_B}','${ORG_B}','${CONTACT_B}','${COMPANY_B}','Empresa B no pedido','automation','draft','automation',null);
    insert into public.crm_order_items
      (id,organization_id,order_id,position,requested_text,product_id,product_name_snapshot,sale_unit_snapshot,quantity,unit_price_cents,currency_snapshot,line_total_cents)
      values
      ('${ITEM_A1}','${ORG_A}','${ORDER_A}',1,'Primeiro item','${PRODUCT_A}','Produto A','un',1.000,100,'BRL',100),
      ('${ITEM_A2}','${ORG_A}','${ORDER_A}',2,'Segundo item',null,null,null,null,null,null,null),
      ('${ITEM_B}','${ORG_B}','${ORDER_B}',1,'Item B','${PRODUCT_B}','Produto B','kg',2.000,250,'BRL',500);
    insert into public.crm_order_command_receipts
      (id,organization_id,operation,idempotency_key,request_hash,actor_type,actor_id,order_id,response_body,completed_at)
      values
      ('${RECEIPT_A}','${ORG_A}','create_draft','f02-t02-a',decode(repeat('01',32),'hex'),'user','${USER_A}','${ORDER_A}','{}',now()),
      ('${RECEIPT_B}','${ORG_B}','create_draft','f02-t02-b',decode(repeat('02',32),'hex'),'automation',null,'${ORDER_B}','{}',now());
    insert into public.crm_order_events
      (id,organization_id,receipt_id,order_id,contact_id,order_revision,event_type,changes,actor_type,actor_id)
      values
      ('${EVENT_A}','${ORG_A}','${RECEIPT_A}','${ORDER_A}','${CONTACT_A}',1,'draft_created','{}','user','${USER_A}'),
      ('${EVENT_B}','${ORG_B}','${RECEIPT_B}','${ORDER_B}','${CONTACT_B}',1,'draft_created','{}','automation',null);
  `);
});

describe("F02-T02 — schema de pedidos operacionais", () => {
  it("instala tenant FKs validadas, journal com contato e posição diferível", () => {
    const result = sql(`
      select
        (select count(*) from pg_constraint where conname in (
          'crm_orders_contact_tenant_fkey','crm_orders_company_tenant_fkey',
          'crm_order_items_order_tenant_fkey','crm_order_items_product_tenant_fkey',
          'crm_order_receipts_order_tenant_fkey','crm_order_events_receipt_tenant_fkey',
          'crm_order_events_order_tenant_fkey','crm_order_events_contact_tenant_fkey'
        ) and convalidated),
        (select case when condeferrable and condeferred then 'deferred' else 'wrong' end from pg_constraint
          where conname='crm_order_items_org_order_position_key'),
        (select count(*) from pg_indexes where schemaname='public' and indexname in (
          'crm_orders_org_contact_idx','crm_order_items_org_order_idx',
          'crm_order_events_org_contact_created_idx','crm_order_receipts_idempotency_unique'
        )),
        (select count(*) from pg_constraint c
          join unnest(c.conkey) with ordinality as k(attnum,ord) on true
          join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
          where c.conrelid in ('public.crm_orders'::regclass,'public.crm_order_command_receipts'::regclass,'public.crm_order_events'::regclass)
            and c.contype='f' and a.attname in ('created_by_actor_id','confirmed_by_actor_id','actor_id'));
    `);
    expect(result).toBe("8|deferred|4|0");
  });

  it("mantém domínio read-only, recibo privado e journal append-only por ACL", () => {
    const result = sql(`
      select
        has_table_privilege('authenticated','public.crm_orders','select')::int,
        has_table_privilege('authenticated','public.crm_order_items','select')::int,
        has_table_privilege('authenticated','public.crm_order_events','select')::int,
        (has_table_privilege('authenticated','public.crm_orders','insert') or
         has_table_privilege('authenticated','public.crm_orders','update') or
         has_table_privilege('authenticated','public.crm_orders','delete'))::int,
        (has_table_privilege('authenticated','public.crm_order_command_receipts','select') or
         has_table_privilege('authenticated','public.crm_order_command_receipts','insert') or
         has_table_privilege('authenticated','public.crm_order_command_receipts','update') or
         has_table_privilege('authenticated','public.crm_order_command_receipts','delete'))::int,
        (has_table_privilege('anon','public.crm_orders','select') or
         has_table_privilege('anon','public.crm_orders','insert') or
         has_table_privilege('anon','public.crm_orders','update') or
         has_table_privilege('anon','public.crm_orders','delete'))::int,
        (has_table_privilege('service_role','public.crm_order_events','select') and
         has_table_privilege('service_role','public.crm_order_events','insert'))::int,
        (has_table_privilege('service_role','public.crm_order_events','update') or
         has_table_privilege('service_role','public.crm_order_events','delete'))::int,
        (select count(*) from pg_policies where schemaname='public' and tablename='crm_order_command_receipts');
    `);
    expect(result, "ACL/RLS dos pedidos deixou uma porta direta inesperada").toBe(
      "1|1|1|0|0|0|1|0|0",
    );
  });

  it("membros leem só o próprio domínio nos dois sentidos", () => {
    const result = sql(`
      begin;
      set local role authenticated;
      ${claims(USER_A)}
      select
        (select count(*) from public.crm_orders where organization_id='${ORG_A}'),
        (select count(*) from public.crm_orders where organization_id='${ORG_B}'),
        (select count(*) from public.crm_order_items where organization_id='${ORG_A}'),
        (select count(*) from public.crm_order_events where organization_id='${ORG_B}');
      ${claims(USER_B)}
      select
        (select count(*) from public.crm_orders where organization_id='${ORG_B}'),
        (select count(*) from public.crm_orders where organization_id='${ORG_A}'),
        (select count(*) from public.crm_order_items where organization_id='${ORG_B}'),
        (select count(*) from public.crm_order_events where organization_id='${ORG_A}');
      rollback;
    `);
    expect(result).toContain("1|0|2|0");
    expect(result).toContain("1|0|1|0");
  });

  it("authenticated recebe permission denied nas quatro operações do recibo em A e B", () => {
    for (const [userId, orgId] of [
      [USER_A, ORG_A],
      [USER_B, ORG_B],
    ] as const) {
      const commands = [
        "select count(*) from public.crm_order_command_receipts",
        `insert into public.crm_order_command_receipts (organization_id,operation,idempotency_key,request_hash,actor_type) values ('${orgId}','create_draft','negado',decode(repeat('00',32),'hex'),'user')`,
        "update public.crm_order_command_receipts set completed_at=now()",
        "delete from public.crm_order_command_receipts",
      ];
      for (const command of commands) {
        expect(
          erroSob("authenticated", command, userId),
          `authenticated executou recibo em ${orgId}: ${command}`,
        ).toContain("permission denied");
      }
    }
  });

  it("aceita pendências como NULL, recusa tenant cruzado e exige total exato", () => {
    const result = sql(`
      begin;
      insert into public.crm_orders
        (organization_id,contact_id,source,status,created_by_actor_type)
        values('${ORG_A}','${CONTACT_A}','ai','draft','ai');
      insert into public.crm_order_items
        (organization_id,order_id,position,requested_text)
        values('${ORG_A}','${ORDER_A}',3,'Pedido ainda sem produto, quantidade ou preço');
      do $proof$ begin
        begin
          insert into public.crm_orders(organization_id,contact_id,source,created_by_actor_type)
            values('${ORG_A}','${CONTACT_B}','ui','user');
          raise exception 'contato cross-tenant aceito';
        exception when foreign_key_violation then null;
        end;
        begin
          insert into public.crm_orders(organization_id,contact_id,company_id,source,created_by_actor_type)
            values('${ORG_A}','${CONTACT_A}','${COMPANY_B}','ui','user');
          raise exception 'empresa cross-tenant aceita';
        exception when foreign_key_violation then null;
        end;
        begin
          insert into public.crm_order_items
            (organization_id,order_id,position,requested_text,product_id)
            values('${ORG_A}','${ORDER_A}',4,'Produto cruzado','${PRODUCT_B}');
          raise exception 'produto cross-tenant aceito';
        exception when foreign_key_violation then null;
        end;
        begin
          insert into public.crm_order_items
            (organization_id,order_id,position,requested_text,quantity,unit_price_cents,line_total_cents)
            values('${ORG_A}','${ORDER_A}',5,'Total inexato',0.500,101,51);
          raise exception 'total arredondado aceito';
        exception when check_violation then null;
        end;
        begin
          insert into public.crm_order_events
            (organization_id,receipt_id,order_id,contact_id,order_revision,event_type,changes,actor_type)
            values('${ORG_A}','${RECEIPT_B}','${ORDER_A}','${CONTACT_A}',2,'order_edited','{}','user');
          raise exception 'recibo cross-tenant aceito';
        exception when foreign_key_violation then null;
        end;
        begin
          insert into public.crm_order_command_receipts
            (organization_id,operation,idempotency_key,request_hash,actor_type)
            values('${ORG_A}','create_draft','f02-t02-a',decode(repeat('03',32),'hex'),'user');
          raise exception 'chave idempotente duplicada aceita';
        exception when unique_violation then null;
        end;
        begin
          insert into public.crm_order_events
            (organization_id,receipt_id,order_id,contact_id,order_revision,event_type,changes,actor_type)
            values('${ORG_A}','${RECEIPT_A}','${ORDER_A}','${CONTACT_A}',2,'order_edited','{}','user');
          raise exception 'segundo evento do recibo aceito';
        exception when unique_violation then null;
        end;
      end $proof$;
      rollback;
      select 'constraints-proved';
    `);
    expect(result).toContain("constraints-proved");
  });

  it("troca posições 1↔2 sem IDs temporários e rejeita duplicata no commit", () => {
    const swapped = sql(`
      begin;
      update public.crm_order_items set position=2 where id='${ITEM_A1}';
      update public.crm_order_items set position=1 where id='${ITEM_A2}';
      commit;
      select string_agg(id::text || ':' || position::text,',' order by id)
        from public.crm_order_items where order_id='${ORDER_A}';
    `);
    expect(swapped).toContain(`${ITEM_A1}:2`);
    expect(swapped).toContain(`${ITEM_A2}:1`);

    const duplicate = erroSob(
      "postgres",
      `begin; update public.crm_order_items set position=1 where order_id='${ORDER_A}'; commit`,
    );
    expect(duplicate, "posição duplicada chegou ao commit").toContain("duplicate key value");
  });

  it("service_role insere no journal, mas não altera nem exclui eventos", () => {
    const inserted = sql(`
      begin;
      set local role service_role;
      insert into public.crm_order_command_receipts
        (id,organization_id,operation,idempotency_key,request_hash,actor_type,order_id,response_body,completed_at)
        values('${SERVICE_RECEIPT}','${ORG_A}','edit_order','service-journal',decode(repeat('09',32),'hex'),'user','${ORDER_A}','{}',now());
      insert into public.crm_order_events
        (id,organization_id,receipt_id,order_id,contact_id,order_revision,event_type,changes,actor_type)
        values('${SERVICE_EVENT}','${ORG_A}','${SERVICE_RECEIPT}','${ORDER_A}','${CONTACT_A}',99,'order_edited','{}','user');
      select count(*) from public.crm_order_events where id='${SERVICE_EVENT}';
      rollback;
    `);
    expect(inserted).toContain("1");
    expect(erroSob("service_role", "update public.crm_order_events set changes='{}'")).toContain(
      "permission denied",
    );
    expect(erroSob("service_role", "delete from public.crm_order_events")).toContain(
      "permission denied",
    );
  });

  it("aplica o upgrade duas vezes e preserva o orders legado", () => {
    const result = sql(`
      begin;
      -- O baseline atual contém 9008. Retira somente as FKs posteriores que
      -- referenciam crm_orders para reconstruir o instante anterior à 9006;
      -- o ROLLBACK restaura o domínio T03 depois da prova.
      alter table public.crm_tasks
        drop constraint crm_tasks_order_contact_tenant_fkey;
      alter table public.crm_notes
        drop constraint crm_notes_order_contact_tenant_fkey;
      drop table public.crm_order_events;
      drop table public.crm_order_command_receipts;
      drop table public.crm_order_items;
      drop table public.crm_orders;
      insert into public.orders
        (id,organization_id,external_id,external_provider,status,total_cents,currency,ordered_at,payload)
        values('${LEGACY_ORDER}','${ORG_A}','legacy-f02-t02','shopify','pending',1234,'BRL',now(),'{"preserved":true}');
      ${MIGRATION}
      ${MIGRATION}
      do $proof$ begin
        if not exists(
          select 1 from public.orders where id='${LEGACY_ORDER}' and external_id='legacy-f02-t02'
            and total_cents=1234 and payload='{"preserved":true}'::jsonb
        ) then raise exception 'orders legado foi alterado'; end if;
        if (select count(*) from pg_tables where schemaname='public' and tablename in
          ('crm_orders','crm_order_items','crm_order_command_receipts','crm_order_events'))<>4
        then raise exception 'tabelas T02 ausentes'; end if;
      end $proof$;
      rollback;
      select 'legacy-preserved';
    `);
    expect(result).toContain("legacy-preserved");
  });
});
