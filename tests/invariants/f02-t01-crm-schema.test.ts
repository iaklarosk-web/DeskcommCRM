import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sql } from "./psql-transporte";

const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260909152202_9005_crm_companies_e_unidade_de_venda.sql",
  ),
  "utf8",
);

const ORG_A = "f0200001-0000-4000-8000-000000000001";
const ORG_B = "f0200001-0000-4000-8000-000000000002";
const VIEWER_A = "f0200001-1000-4000-8000-000000000001";
const AGENT_A = "f0200001-1000-4000-8000-000000000002";
const AGENT_B = "f0200001-1000-4000-8000-000000000003";
const SUPPORT = "f0200001-1000-4000-8000-000000000004";
const SUPPORT_SESSION = "f0200001-1100-4000-8000-000000000001";
const COMPANY_A = "f0200001-2000-4000-8000-000000000001";
const COMPANY_B = "f0200001-2000-4000-8000-000000000002";
const CONTACT_A = "f0200001-3000-4000-8000-000000000001";
const CONTACT_AGENT = "f0200001-3000-4000-8000-000000000002";
const CONTACT_AGENT_B = "f0200001-3000-4000-8000-000000000003";
const PRODUCT_A = "f0200001-4000-4000-8000-000000000001";

const seed = `
  insert into auth.users(id,email) values
    ('${VIEWER_A}','f02-viewer-a@invariant.test'),
    ('${AGENT_A}','f02-agent-a@invariant.test'),
    ('${AGENT_B}','f02-agent-b@invariant.test');
  insert into public.organizations(id,slug,legal_name,display_name) values
    ('${ORG_A}','f02-schema-a','F02 Schema A','F02 A'),
    ('${ORG_B}','f02-schema-b','F02 Schema B','F02 B');
  insert into public.user_organizations(organization_id,user_id,role,accepted_at) values
    ('${ORG_A}','${VIEWER_A}','viewer',now()),
    ('${ORG_A}','${AGENT_A}','agent',now()),
    ('${ORG_B}','${AGENT_B}','agent',now());
`;

function claims(userId: string): string {
  return `select set_config('request.jwt.claims','{"sub":"${userId}"}',true);`;
}

describe("F02-T01 — empresas e campos comerciais", () => {
  it("instala constraints validadas, índices compostos e RLS completa", () => {
    const result = sql(`
      select
        (select count(*) from information_schema.columns
          where table_schema='public' and
            ((table_name='crm_companies' and column_name in ('id','organization_id','legal_name','trade_name','cnpj','created_at','updated_at'))
             or (table_name='contacts' and column_name in ('company_id','recurring'))
             or (table_name='catalog_products' and column_name='sale_unit'))),
        (select count(*) from pg_constraint
          where conname in ('crm_companies_legal_name_format','crm_companies_trade_name_format','crm_companies_cnpj_format','contacts_company_tenant_fkey','catalog_products_sale_unit_format')
            and convalidated),
        (select count(*) from pg_indexes
          where schemaname='public' and indexname in ('crm_companies_org_id_unique','crm_companies_org_cnpj_unique','contacts_org_id_unique','contacts_org_company_id_idx','catalog_products_org_id_unique')),
        (select count(*) from pg_policies
          where schemaname='public' and tablename='crm_companies'),
        (select count(*) from pg_policy
          where polrelid='public.crm_companies'::regclass and not polpermissive);
    `);
    expect(result).toBe("10|5|5|7|3");
  });

  it("reaplica o upgrade sem trocar IDs ou fabricar empresa e unidade", () => {
    const result = sql(`
      begin;
      drop table public.crm_companies cascade;
      drop policy contacts_f02_write_insert_guard on public.contacts;
      drop policy contacts_f02_write_update_guard on public.contacts;
      drop policy contacts_f02_write_delete_guard on public.contacts;
      alter table public.contacts drop column company_id, drop column recurring;
      alter table public.catalog_products drop column sale_unit;
      drop index public.contacts_org_id_unique;
      drop index public.catalog_products_org_id_unique;
      ${seed}
      insert into public.contacts(id,organization_id,display_name)
        values('${CONTACT_A}','${ORG_A}','Contato preservado');
      insert into public.catalog_products(id,organization_id,codigo,nome,preco_cents)
        values('${PRODUCT_A}','${ORG_A}','F02-PRESERVA','Produto preservado',1234);
      ${MIGRATION}
      ${MIGRATION}
      do $proof$
      begin
        if not exists (
          select 1 from public.contacts
           where id='${CONTACT_A}' and organization_id='${ORG_A}'
             and company_id is null and recurring=false
        ) then raise exception 'contato ou estado inicial alterado'; end if;
        if not exists (
          select 1 from public.catalog_products
           where id='${PRODUCT_A}' and organization_id='${ORG_A}' and sale_unit is null
        ) then raise exception 'produto ou unidade ausente alterados'; end if;
      end
      $proof$;
      rollback;
      select 'preserved';
    `);
    expect(result).toContain("preserved");
  });

  it("a FK composta recusa empresa de outro tenant e permanece validada", () => {
    const result = sql(`
      begin;
      ${seed}
      insert into public.crm_companies(id,organization_id,legal_name)
        values
          ('${COMPANY_A}','${ORG_A}','Empresa A'),
          ('${COMPANY_B}','${ORG_B}','Empresa B');
      do $proof$
      begin
        begin
          insert into public.contacts(organization_id,display_name,company_id)
            values('${ORG_B}','Contato cruzado','${COMPANY_A}');
          raise exception 'FK cruzada escapou';
        exception when foreign_key_violation then null;
        end;
      end
      $proof$;
      rollback;
      select 'tenant-fk-proved';
    `);
    expect(result).toContain("tenant-fk-proved");
  });

  it("recusa excluir empresa vinculada e o cascade do tenant remove as duas linhas", () => {
    const result = sql(`
      begin;
      ${seed}
      insert into public.crm_companies(id,organization_id,legal_name)
        values('${COMPANY_A}','${ORG_A}','Empresa descartável');
      insert into public.contacts(id,organization_id,display_name,company_id)
        values('${CONTACT_A}','${ORG_A}','Contato preservado','${COMPANY_A}');
      do $proof$ begin
        begin
          delete from public.crm_companies where id='${COMPANY_A}';
          raise exception 'empresa vinculada foi excluída';
        exception when foreign_key_violation then null;
        end;
        if not exists(select 1 from public.contacts where id='${CONTACT_A}' and company_id='${COMPANY_A}')
           or not exists(select 1 from public.crm_companies where id='${COMPANY_A}') then
          raise exception 'recusa não preservou as duas linhas';
        end if;
      end $proof$;
      delete from public.organizations where id='${ORG_A}';
      do $proof$ begin
        if exists(select 1 from public.contacts where id='${CONTACT_A}')
           or exists(select 1 from public.crm_companies where id='${COMPANY_A}') then
          raise exception 'cascade do tenant deixou linha comercial';
        end if;
      end $proof$;
      rollback;
      select 'deletes-proved';
    `);
    expect(result).toContain("deletes-proved");
  });

  it("viewer lê sem escrever; agent escreve somente no próprio tenant", () => {
    const result = sql(`
      begin;
      ${seed}
      insert into public.crm_companies(id,organization_id,legal_name)
        values
          ('${COMPANY_A}','${ORG_A}','Empresa A'),
          ('${COMPANY_B}','${ORG_B}','Empresa B');
      insert into public.contacts(id,organization_id,display_name,company_id)
        values('${CONTACT_A}','${ORG_A}','Contato A','${COMPANY_A}');

      set local role authenticated;
      ${claims(VIEWER_A)}
      do $proof$
      declare v_rows integer;
      begin
        if (select count(*) from public.crm_companies)<>1 then raise exception 'viewer não leu A'; end if;
        begin
          insert into public.crm_companies(organization_id,legal_name) values('${ORG_A}','Viewer proibido');
          raise exception 'viewer escreveu';
        exception when insufficient_privilege then null;
        end;
        update public.crm_companies set legal_name='Viewer alterou' where id='${COMPANY_A}';
        get diagnostics v_rows = row_count;
        if v_rows<>0 then raise exception 'viewer alterou empresa'; end if;
        delete from public.crm_companies where id='${COMPANY_A}';
        get diagnostics v_rows = row_count;
        if v_rows<>0 then raise exception 'viewer excluiu empresa'; end if;
        begin
          insert into public.contacts(organization_id,display_name,recurring)
            values('${ORG_A}','Viewer contato',true);
          raise exception 'viewer inseriu contato';
        exception when insufficient_privilege then null;
        end;
        update public.contacts set recurring=true,company_id=null where id='${CONTACT_A}';
        get diagnostics v_rows = row_count;
        if v_rows<>0 then raise exception 'viewer alterou contato'; end if;
        delete from public.contacts where id='${CONTACT_A}';
        get diagnostics v_rows = row_count;
        if v_rows<>0 then raise exception 'viewer excluiu contato'; end if;
      end $proof$;

      reset role;
      set local role authenticated;
      ${claims(AGENT_A)}
      insert into public.crm_companies(organization_id,legal_name) values('${ORG_A}','Agent permitido');
      insert into public.contacts(id,organization_id,display_name,company_id)
        values('${CONTACT_AGENT}','${ORG_A}','Contato agent','${COMPANY_A}');
      update public.contacts set recurring=true where id='${CONTACT_A}';
      do $proof$
      declare v_rows integer;
      begin
        begin
          insert into public.crm_companies(organization_id,legal_name) values('${ORG_B}','Cruzada proibida');
          raise exception 'agent cruzou tenant';
        exception when insufficient_privilege then null;
        end;
        begin
          update public.crm_companies set organization_id='${ORG_B}' where id='${COMPANY_A}';
          raise exception 'agent mudou empresa de tenant';
        exception when insufficient_privilege then null;
        end;
        begin
          update public.contacts set company_id='${COMPANY_B}' where id='${CONTACT_A}';
          raise exception 'agent vinculou contato a empresa de outro tenant';
        exception when foreign_key_violation then null;
        end;
        if (select count(*) from public.crm_companies where organization_id='${ORG_B}')<>0 then
          raise exception 'agent leu tenant B';
        end if;
        if not exists(select 1 from public.contacts where id='${CONTACT_A}' and recurring) then
          raise exception 'agent não alterou campos comerciais';
        end if;
        delete from public.contacts where id='${CONTACT_AGENT}';
        get diagnostics v_rows = row_count;
        if v_rows<>1 then raise exception 'agent não excluiu contato próprio'; end if;
      end $proof$;

      reset role;
      set local role authenticated;
      ${claims(AGENT_B)}
      insert into public.contacts(id,organization_id,display_name,company_id)
        values('${CONTACT_AGENT_B}','${ORG_B}','Contato agent B','${COMPANY_B}');
      do $proof$ begin
        begin
          update public.crm_companies set organization_id='${ORG_A}' where id='${COMPANY_B}';
          raise exception 'agent B mudou empresa para tenant A';
        exception when insufficient_privilege then null;
        end;
        begin
          update public.contacts set company_id='${COMPANY_A}' where id='${CONTACT_AGENT_B}';
          raise exception 'agent B vinculou contato à empresa A';
        exception when foreign_key_violation then null;
        end;
      end $proof$;

      reset role;
      rollback;
      select 'roles-proved';
    `);
    expect(result).toContain("roles-proved");
  });

  it("suporte readonly lê a empresa assistida e não altera nenhuma linha", () => {
    const result = sql(`
      begin;
      insert into auth.users(id,email) values('${SUPPORT}','f02-support@invariant.test');
      insert into auth.sessions(id,user_id,aal) values('${SUPPORT_SESSION}','${SUPPORT}','aal1');
      insert into public.organizations(id,slug,legal_name,display_name) values
        ('${ORG_A}','f02-support-a','F02 Support A','F02 SA'),
        ('${ORG_B}','f02-support-b','F02 Support B','F02 SB');
      insert into public.user_organizations(organization_id,user_id,role,accepted_at) values
        ('${ORG_A}','${SUPPORT}','admin',now()),
        ('${ORG_B}','${SUPPORT}','admin',now());
      insert into public.platform_admins(user_id,granted_by,scope,mfa_required,reason)
        values('${SUPPORT}','${SUPPORT}','full',false,'F02 local invariant');
      insert into public.crm_companies(id,organization_id,legal_name)
        values('${COMPANY_B}','${ORG_B}','Empresa assistida');
      insert into public.contacts(id,organization_id,display_name,company_id)
        values('${CONTACT_A}','${ORG_B}','Contato assistido','${COMPANY_B}');
      select public.fn_start_support('${SUPPORT}','${SUPPORT_SESSION}','${ORG_B}','${ORG_A}','support_readonly',3600);

      set local role authenticated;
      select set_config('request.jwt.claims','{"sub":"${SUPPORT}","session_id":"${SUPPORT_SESSION}","aal":"aal1"}',true);
      do $proof$
      declare v_rows integer;
      begin
        if (select count(*) from public.crm_companies where id='${COMPANY_B}')<>1 then
          raise exception 'suporte readonly não leu empresa assistida';
        end if;
        begin
          insert into public.crm_companies(organization_id,legal_name) values('${ORG_B}','Inserção proibida');
          raise exception 'suporte readonly inseriu';
        exception when insufficient_privilege then null;
        end;
        update public.crm_companies set legal_name='Alteração proibida' where id='${COMPANY_B}';
        get diagnostics v_rows = row_count;
        if v_rows<>0 then raise exception 'suporte readonly alterou empresa'; end if;
        delete from public.crm_companies where id='${COMPANY_B}';
        get diagnostics v_rows = row_count;
        if v_rows<>0 then raise exception 'suporte readonly excluiu empresa'; end if;
        begin
          insert into public.contacts(organization_id,display_name,recurring)
            values('${ORG_B}','Contato proibido',true);
          raise exception 'suporte readonly inseriu contato';
        exception when insufficient_privilege then null;
        end;
        update public.contacts set recurring=true,company_id=null where id='${CONTACT_A}';
        get diagnostics v_rows = row_count;
        if v_rows<>0 then raise exception 'suporte readonly alterou contato'; end if;
        delete from public.contacts where id='${CONTACT_A}';
        get diagnostics v_rows = row_count;
        if v_rows<>0 then raise exception 'suporte readonly excluiu contato'; end if;
      end $proof$;

      reset role;
      do $proof$ begin
        if not exists(select 1 from public.crm_companies where id='${COMPANY_B}' and legal_name='Empresa assistida')
           or not exists(select 1 from public.contacts where id='${CONTACT_A}' and company_id='${COMPANY_B}' and recurring=false) then
          raise exception 'dados assistidos não foram preservados';
        end if;
      end $proof$;
      rollback;
      select 'support-readonly-proved';
    `);
    expect(result).toContain("support-readonly-proved");
  });
});
