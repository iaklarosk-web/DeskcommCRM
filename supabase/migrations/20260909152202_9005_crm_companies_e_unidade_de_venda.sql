-- F02-T01 — contrato comercial aditivo.
--
-- Mantém contacts/catalog_products e seus IDs. Empresa é opcional no contato;
-- recorrência nasce desligada; unidade de venda ausente continua NULL. Nenhum
-- destes estados classifica ou corrige silenciosamente as linhas legadas.

create table if not exists public.crm_companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  legal_name text not null,
  trade_name text,
  cnpj text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $f02_t01$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.crm_companies'::regclass
       and conname = 'crm_companies_legal_name_format'
  ) then
    alter table public.crm_companies add constraint crm_companies_legal_name_format
      check (legal_name = btrim(legal_name) and length(legal_name) between 1 and 200);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.crm_companies'::regclass
       and conname = 'crm_companies_trade_name_format'
  ) then
    alter table public.crm_companies add constraint crm_companies_trade_name_format
      check (trade_name is null or (trade_name = btrim(trade_name) and length(trade_name) between 1 and 200));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.crm_companies'::regclass
       and conname = 'crm_companies_cnpj_format'
  ) then
    alter table public.crm_companies add constraint crm_companies_cnpj_format
      check (cnpj is null or cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$');
  end if;
end
$f02_t01$;

create unique index if not exists crm_companies_org_id_unique
  on public.crm_companies (organization_id, id);
create unique index if not exists crm_companies_org_cnpj_unique
  on public.crm_companies (organization_id, cnpj) where cnpj is not null;
create index if not exists crm_companies_org_legal_name_idx
  on public.crm_companies (organization_id, legal_name);

alter table public.contacts add column if not exists company_id uuid;
alter table public.contacts add column if not exists recurring boolean not null default false;

create unique index if not exists contacts_org_id_unique
  on public.contacts (organization_id, id);
create index if not exists contacts_org_company_id_idx
  on public.contacts (organization_id, company_id) where company_id is not null;

do $f02_t01$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.contacts'::regclass
       and conname = 'contacts_company_tenant_fkey'
  ) then
    alter table public.contacts add constraint contacts_company_tenant_fkey
      foreign key (organization_id, company_id)
      references public.crm_companies (organization_id, id)
      on delete restrict;
  end if;
end
$f02_t01$;

alter table public.catalog_products add column if not exists sale_unit text;

do $f02_t01$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.catalog_products'::regclass
       and conname = 'catalog_products_sale_unit_format'
  ) then
    alter table public.catalog_products add constraint catalog_products_sale_unit_format
      check (sale_unit is null or (sale_unit = btrim(sale_unit) and length(sale_unit) between 1 and 32));
  end if;
end
$f02_t01$;

create unique index if not exists catalog_products_org_id_unique
  on public.catalog_products (organization_id, id);

-- contacts tinha policy permissiva por tenant sem role. Estas cercas preservam
-- SELECT e exigem agent+ para todo DML direto, como a API já exige.
drop policy if exists contacts_f02_write_insert_guard on public.contacts;
create policy contacts_f02_write_insert_guard on public.contacts as restrictive
  for insert to authenticated
  with check (public.fn_role_at_least(organization_id, 'agent'));

drop policy if exists contacts_f02_write_update_guard on public.contacts;
create policy contacts_f02_write_update_guard on public.contacts as restrictive
  for update to authenticated
  using (public.fn_role_at_least(organization_id, 'agent'))
  with check (public.fn_role_at_least(organization_id, 'agent'));

drop policy if exists contacts_f02_write_delete_guard on public.contacts;
create policy contacts_f02_write_delete_guard on public.contacts as restrictive
  for delete to authenticated
  using (public.fn_role_at_least(organization_id, 'agent'));

alter table public.crm_companies enable row level security;

drop policy if exists crm_companies_select on public.crm_companies;
create policy crm_companies_select on public.crm_companies
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists crm_companies_insert on public.crm_companies;
create policy crm_companies_insert on public.crm_companies
  for insert to authenticated
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  );

drop policy if exists crm_companies_update on public.crm_companies;
create policy crm_companies_update on public.crm_companies
  for update to authenticated
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  );

drop policy if exists crm_companies_delete on public.crm_companies;
create policy crm_companies_delete on public.crm_companies
  for delete to authenticated
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  );

-- A 0220 só cercou as tabelas existentes naquela data. A tabela nova precisa
-- nascer com as três cercas restritivas para suporte readonly.
drop policy if exists support_write_insert on public.crm_companies;
create policy support_write_insert on public.crm_companies as restrictive
  for insert to authenticated
  with check (public.fn_support_write_allowed(organization_id));

drop policy if exists support_write_update on public.crm_companies;
create policy support_write_update on public.crm_companies as restrictive
  for update to authenticated
  using (public.fn_support_write_allowed(organization_id))
  with check (public.fn_support_write_allowed(organization_id));

drop policy if exists support_write_delete on public.crm_companies;
create policy support_write_delete on public.crm_companies as restrictive
  for delete to authenticated
  using (public.fn_support_write_allowed(organization_id));

drop trigger if exists trg_crm_companies_updated_at on public.crm_companies;
create trigger trg_crm_companies_updated_at
  before update on public.crm_companies
  for each row execute function public.fn_set_updated_at();

comment on table public.crm_companies is
  'Empresas clientes de uma organização. Não se confunde com organizations, que representa o tenant.';
comment on column public.crm_companies.cnpj is
  'CNPJ canônico sem máscara: 12 posições alfanuméricas e 2 dígitos verificadores. NULL quando não informado.';
comment on column public.contacts.company_id is
  'Vínculo opcional à empresa cliente do mesmo tenant. A empresa vinculada não pode ser excluída antes de desfazer o vínculo.';
comment on column public.contacts.recurring is
  'Estado explícito de recorrência. false é o estado inicial e não classifica retroativamente o cliente.';
comment on column public.catalog_products.sale_unit is
  'Unidade comercial livre e curta. NULL significa que a operação ainda não configurou a unidade.';

-- Verificação estrutural e de dívida: a FK nasce validada porque a coluna nova
-- está NULL e crm_companies nasce vazia.
do $f02_t01$
declare
  v_invalid_constraints integer;
  v_restrictive_policies integer;
  v_contact_role_policies integer;
begin
  if not exists (
    select 1 from pg_tables
     where schemaname = 'public' and tablename = 'crm_companies' and rowsecurity
  ) then
    raise exception 'crm_companies ausente ou sem RLS';
  end if;

  select count(*) into v_invalid_constraints
    from pg_constraint
   where conrelid in (
     'public.crm_companies'::regclass,
     'public.contacts'::regclass,
     'public.catalog_products'::regclass
   )
     and conname in (
       'crm_companies_legal_name_format',
       'crm_companies_trade_name_format',
       'crm_companies_cnpj_format',
       'contacts_company_tenant_fkey',
       'catalog_products_sale_unit_format'
     )
     and not convalidated;
  if v_invalid_constraints <> 0 then
    raise exception 'F02-T01 deixou % constraint(s) sem validação', v_invalid_constraints;
  end if;

  select count(*) into v_restrictive_policies
    from pg_policy
   where polrelid = 'public.crm_companies'::regclass
     and not polpermissive
     and polname in ('support_write_insert', 'support_write_update', 'support_write_delete');
  if v_restrictive_policies <> 3 then
    raise exception 'crm_companies requer 3 cercas de suporte; encontrou %', v_restrictive_policies;
  end if;

  select count(*) into v_contact_role_policies
    from pg_policy
   where polrelid = 'public.contacts'::regclass
     and not polpermissive
     and polname in (
       'contacts_f02_write_insert_guard',
       'contacts_f02_write_update_guard',
       'contacts_f02_write_delete_guard'
     );
  if v_contact_role_policies <> 3 then
    raise exception 'contacts requer 3 cercas de role F02; encontrou %', v_contact_role_policies;
  end if;
end
$f02_t01$;

notify pgrst, 'reload schema';

-- G-54: contrato explícito de grants no fim da migration.
revoke all on public.crm_companies from public, anon, authenticated;
grant select, insert, update, delete on public.crm_companies to authenticated;
grant all on public.crm_companies to service_role;
revoke all on public.contacts, public.catalog_products from anon;
grant select, insert, update, delete on public.contacts, public.catalog_products to authenticated;
grant all on public.contacts, public.catalog_products to service_role;
