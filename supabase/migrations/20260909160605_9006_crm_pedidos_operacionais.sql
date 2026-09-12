-- F02-T02 — pedidos operacionais, separados do `orders` de e-commerce.
-- Escrita é exclusiva do futuro TenantDb: authenticated só lê domínio/journal.

create table if not exists public.crm_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null,
  company_id uuid,
  company_name_snapshot text,
  source text not null,
  channel text,
  delivery_date date,
  status text not null default 'draft',
  revision integer not null default 1,
  currency text,
  total_cents integer,
  created_by_actor_type text not null,
  created_by_actor_id uuid,
  confirmed_at timestamptz,
  confirmed_by_actor_type text,
  confirmed_by_actor_id uuid,
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_orders_source_check check (source in ('ui','ai','automation')),
  constraint crm_orders_status_check check (status in ('draft','confirmed','in_production','delivered','cancelled')),
  constraint crm_orders_revision_check check (revision >= 1),
  constraint crm_orders_currency_check check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint crm_orders_total_check check (total_cents is null or total_cents between 0 and 2147483647),
  constraint crm_orders_actor_type_check check (created_by_actor_type in ('user','ai','automation')),
  constraint crm_orders_confirmation_actor_check check (
    confirmed_by_actor_type is null or confirmed_by_actor_type in ('user','ai','automation')
  ),
  constraint crm_orders_confirmation_pair_check check (
    (confirmed_at is null and confirmed_by_actor_type is null and confirmed_by_actor_id is null)
    or (confirmed_at is not null and confirmed_by_actor_type is not null)
  ),
  constraint crm_orders_company_snapshot_check check (
    company_name_snapshot is null or (
      company_name_snapshot=btrim(company_name_snapshot)
      and length(company_name_snapshot) between 1 and 200
    )
  ),
  constraint crm_orders_channel_check check (
    channel is null or (channel=btrim(channel) and length(channel) between 1 and 64)
  )
);

create unique index if not exists crm_orders_org_id_unique
  on public.crm_orders(organization_id,id);
create index if not exists crm_orders_org_contact_idx
  on public.crm_orders(organization_id,contact_id,created_at desc);
create index if not exists crm_orders_org_company_idx
  on public.crm_orders(organization_id,company_id) where company_id is not null;
create index if not exists crm_orders_org_delivery_status_idx
  on public.crm_orders(organization_id,delivery_date,status);

do $f02_t02$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.crm_orders'::regclass and conname='crm_orders_contact_tenant_fkey') then
    alter table public.crm_orders add constraint crm_orders_contact_tenant_fkey
      foreign key(organization_id,contact_id)
      references public.contacts(organization_id,id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.crm_orders'::regclass and conname='crm_orders_company_tenant_fkey') then
    alter table public.crm_orders add constraint crm_orders_company_tenant_fkey
      foreign key(organization_id,company_id)
      references public.crm_companies(organization_id,id) on delete restrict;
  end if;
end
$f02_t02$;

create table if not exists public.crm_order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null,
  position integer not null,
  requested_text text not null,
  product_id uuid,
  product_name_snapshot text,
  sale_unit_snapshot text,
  quantity numeric(12,3),
  unit_price_cents integer,
  currency_snapshot text,
  line_total_cents integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_order_items_position_check check (position >= 1),
  constraint crm_order_items_requested_text_check check (
    requested_text=btrim(requested_text) and length(requested_text) between 1 and 1000
  ),
  constraint crm_order_items_product_name_check check (
    product_name_snapshot is null or (
      product_name_snapshot=btrim(product_name_snapshot)
      and length(product_name_snapshot) between 1 and 200
    )
  ),
  constraint crm_order_items_sale_unit_check check (
    sale_unit_snapshot is null or (
      sale_unit_snapshot=btrim(sale_unit_snapshot)
      and length(sale_unit_snapshot) between 1 and 32
    )
  ),
  constraint crm_order_items_quantity_check check (quantity is null or quantity > 0),
  constraint crm_order_items_unit_price_check check (
    unit_price_cents is null or unit_price_cents between 0 and 2147483647
  ),
  constraint crm_order_items_currency_check check (
    currency_snapshot is null or currency_snapshot ~ '^[A-Z]{3}$'
  ),
  constraint crm_order_items_line_total_check check (
    line_total_cents is null or (
      line_total_cents between 0 and 2147483647
      and quantity is not null
      and unit_price_cents is not null
      and quantity * unit_price_cents = line_total_cents
    )
  )
);

create unique index if not exists crm_order_items_org_id_unique
  on public.crm_order_items(organization_id,id);
create index if not exists crm_order_items_org_order_idx
  on public.crm_order_items(organization_id,order_id);
create index if not exists crm_order_items_org_product_idx
  on public.crm_order_items(organization_id,product_id) where product_id is not null;

do $f02_t02$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.crm_order_items'::regclass and conname='crm_order_items_org_order_position_key') then
    alter table public.crm_order_items add constraint crm_order_items_org_order_position_key
      unique(organization_id,order_id,position) deferrable initially deferred;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.crm_order_items'::regclass and conname='crm_order_items_order_tenant_fkey') then
    alter table public.crm_order_items add constraint crm_order_items_order_tenant_fkey
      foreign key(organization_id,order_id)
      references public.crm_orders(organization_id,id) on delete cascade;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.crm_order_items'::regclass and conname='crm_order_items_product_tenant_fkey') then
    alter table public.crm_order_items add constraint crm_order_items_product_tenant_fkey
      foreign key(organization_id,product_id)
      references public.catalog_products(organization_id,id) on delete restrict;
  end if;
end
$f02_t02$;

create table if not exists public.crm_order_command_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation text not null,
  idempotency_key text not null,
  request_hash bytea not null,
  actor_type text not null,
  actor_id uuid,
  order_id uuid,
  response_body jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint crm_order_receipts_operation_check check (
    operation in ('create_draft','edit_order','confirm_order','advance_order','cancel_order')
  ),
  constraint crm_order_receipts_key_check check (
    idempotency_key=btrim(idempotency_key) and length(idempotency_key) between 1 and 200
  ),
  constraint crm_order_receipts_hash_check check (octet_length(request_hash)=32),
  constraint crm_order_receipts_actor_check check (actor_type in ('user','ai','automation')),
  constraint crm_order_receipts_response_check check (
    (response_body is null and completed_at is null)
    or (jsonb_typeof(response_body)='object' and completed_at is not null)
  )
);

create unique index if not exists crm_order_receipts_org_id_unique
  on public.crm_order_command_receipts(organization_id,id);
create unique index if not exists crm_order_receipts_idempotency_unique
  on public.crm_order_command_receipts(organization_id,operation,idempotency_key);
create index if not exists crm_order_receipts_org_order_idx
  on public.crm_order_command_receipts(organization_id,order_id) where order_id is not null;
create index if not exists crm_order_receipts_incomplete_idx
  on public.crm_order_command_receipts(organization_id,created_at) where completed_at is null;

do $f02_t02$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.crm_order_command_receipts'::regclass and conname='crm_order_receipts_order_tenant_fkey') then
    alter table public.crm_order_command_receipts add constraint crm_order_receipts_order_tenant_fkey
      foreign key(organization_id,order_id)
      references public.crm_orders(organization_id,id) on delete restrict;
  end if;
end
$f02_t02$;

create table if not exists public.crm_order_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  receipt_id uuid not null,
  order_id uuid not null,
  contact_id uuid not null,
  order_revision integer not null,
  event_type text not null,
  changes jsonb not null,
  actor_type text not null,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint crm_order_events_revision_check check (order_revision >= 1),
  constraint crm_order_events_type_check check (
    event_type in ('draft_created','order_edited','order_confirmed','order_advanced','order_cancelled')
  ),
  constraint crm_order_events_changes_check check (jsonb_typeof(changes)='object'),
  constraint crm_order_events_actor_check check (actor_type in ('user','ai','automation'))
);

create unique index if not exists crm_order_events_org_id_unique
  on public.crm_order_events(organization_id,id);
create unique index if not exists crm_order_events_receipt_unique
  on public.crm_order_events(organization_id,receipt_id);
create unique index if not exists crm_order_events_order_revision_unique
  on public.crm_order_events(organization_id,order_id,order_revision);
create index if not exists crm_order_events_org_order_created_idx
  on public.crm_order_events(organization_id,order_id,created_at);
create index if not exists crm_order_events_org_contact_created_idx
  on public.crm_order_events(organization_id,contact_id,created_at,id);

do $f02_t02$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.crm_order_events'::regclass and conname='crm_order_events_receipt_tenant_fkey') then
    alter table public.crm_order_events add constraint crm_order_events_receipt_tenant_fkey
      foreign key(organization_id,receipt_id)
      references public.crm_order_command_receipts(organization_id,id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.crm_order_events'::regclass and conname='crm_order_events_order_tenant_fkey') then
    alter table public.crm_order_events add constraint crm_order_events_order_tenant_fkey
      foreign key(organization_id,order_id)
      references public.crm_orders(organization_id,id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.crm_order_events'::regclass and conname='crm_order_events_contact_tenant_fkey') then
    alter table public.crm_order_events add constraint crm_order_events_contact_tenant_fkey
      foreign key(organization_id,contact_id)
      references public.contacts(organization_id,id) on delete restrict;
  end if;
end
$f02_t02$;

alter table public.crm_orders enable row level security;
alter table public.crm_order_items enable row level security;
alter table public.crm_order_command_receipts enable row level security;
alter table public.crm_order_events enable row level security;

drop policy if exists crm_orders_select on public.crm_orders;
create policy crm_orders_select on public.crm_orders for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists crm_order_items_select on public.crm_order_items;
create policy crm_order_items_select on public.crm_order_items for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists crm_order_events_select on public.crm_order_events;
create policy crm_order_events_select on public.crm_order_events for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));

drop trigger if exists trg_crm_orders_updated_at on public.crm_orders;
create trigger trg_crm_orders_updated_at before update on public.crm_orders
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_crm_order_items_updated_at on public.crm_order_items;
create trigger trg_crm_order_items_updated_at before update on public.crm_order_items
  for each row execute function public.fn_set_updated_at();

comment on table public.crm_orders is 'Pedidos operacionais do CRM. Distintos de orders, que preserva pedidos externos de e-commerce.';
comment on column public.crm_orders.delivery_date is 'Data explicitamente informada. NULL é pendência; não implica data de produção.';
comment on table public.crm_order_items is 'Itens estáveis do pedido; snapshots não são reescritos por mudanças futuras no catálogo.';
comment on table public.crm_order_command_receipts is 'Recibos privados de idempotência: reservados e concluídos na mesma transação do comando.';
comment on table public.crm_order_events is 'Journal append-only por recibo e revisão, com instante atribuído pelo banco.';
comment on column public.crm_order_events.contact_id is 'Contato capturado no evento; não muda se o pedido for depois associado a outro contato.';

do $f02_t02$
declare v_invalid integer;
begin
  if exists(
    select 1 from pg_tables
     where schemaname='public'
       and tablename in ('crm_orders','crm_order_items','crm_order_command_receipts','crm_order_events')
       and not rowsecurity
  ) then raise exception 'F02-T02 criou tabela sem RLS'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='crm_order_command_receipts') then
    raise exception 'recibos de comando devem ter zero policies';
  end if;
  select count(*) into v_invalid from pg_constraint
   where conrelid in (
     'public.crm_orders'::regclass,
     'public.crm_order_items'::regclass,
     'public.crm_order_command_receipts'::regclass,
     'public.crm_order_events'::regclass
   ) and contype='f' and not convalidated;
  if v_invalid<>0 then raise exception 'F02-T02 deixou % FK(s) sem validação',v_invalid; end if;
end
$f02_t02$;

notify pgrst, 'reload schema';

-- G-54: ACL explícito. O journal é append-only até para service_role.
revoke all on public.crm_orders,public.crm_order_items,public.crm_order_command_receipts,public.crm_order_events
  from public,anon,authenticated,service_role;
grant select on public.crm_orders,public.crm_order_items,public.crm_order_events to authenticated;
grant all on public.crm_orders,public.crm_order_items,public.crm_order_command_receipts to service_role;
grant select,insert on public.crm_order_events to service_role;
