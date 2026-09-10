-- F02-T12 — conferência genérica por item e revisão comercial.
-- Timestamp criado pelo Supabase CLI; arquivo aplicado é imutável.

create table if not exists public.crm_order_check_command_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation text not null default 'record_check',
  idempotency_key uuid not null,
  request_hash bytea not null,
  actor_user_id uuid not null,
  order_id uuid,
  response_body jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint crm_order_check_receipts_operation_check
    check (operation='record_check'),
  constraint crm_order_check_receipts_hash_check
    check (octet_length(request_hash)=32),
  constraint crm_order_check_receipts_response_check check (
    (response_body is null and completed_at is null)
    or (
      jsonb_typeof(response_body)='object'
      and completed_at is not null
      and order_id is not null
    )
  )
);

create unique index if not exists crm_order_check_receipts_org_id_unique
  on public.crm_order_check_command_receipts(organization_id,id);
create unique index if not exists crm_order_check_receipts_idempotency_unique
  on public.crm_order_check_command_receipts(organization_id,operation,idempotency_key);
create index if not exists crm_order_check_receipts_order_idx
  on public.crm_order_check_command_receipts(organization_id,order_id)
  where order_id is not null;

do $f02_t12$
begin
  if not exists(select 1 from pg_constraint
    where conrelid='public.crm_order_check_command_receipts'::regclass
      and conname='crm_order_check_receipts_order_tenant_fkey') then
    alter table public.crm_order_check_command_receipts
      add constraint crm_order_check_receipts_order_tenant_fkey
      foreign key(organization_id,order_id)
      references public.crm_orders(organization_id,id) on delete restrict;
  end if;
end
$f02_t12$;

create table if not exists public.crm_order_check_events (
  id uuid primary key default gen_random_uuid(),
  event_sequence bigint generated always as identity,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  receipt_id uuid not null,
  order_id uuid not null,
  order_revision integer not null,
  event_no integer not null,
  item_id uuid not null,
  ordered_quantity_snapshot numeric(12,3),
  checked_quantity numeric(12,3) not null,
  sale_unit_snapshot text,
  check_state text not null,
  actor_user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint crm_order_check_events_revision_check check(order_revision>=1),
  constraint crm_order_check_events_no_check check(event_no>=1),
  constraint crm_order_check_events_unit_check check(
    sale_unit_snapshot is null or (
      sale_unit_snapshot=btrim(sale_unit_snapshot)
      and length(sale_unit_snapshot) between 1 and 32
    )
  ),
  constraint crm_order_check_events_state_check check(
    check_state in('pending','partial','checked')
  ),
  constraint crm_order_check_events_quantities_check check(
    (
      ordered_quantity_snapshot is null
      and checked_quantity=0
      and check_state='pending'
    ) or (
      ordered_quantity_snapshot is not null
      and ordered_quantity_snapshot>0
      and checked_quantity between 0 and ordered_quantity_snapshot
      and (checked_quantity=0 or sale_unit_snapshot is not null)
      and (
        (checked_quantity=0 and check_state='pending')
        or (checked_quantity>0 and checked_quantity<ordered_quantity_snapshot
            and check_state='partial')
        or (checked_quantity=ordered_quantity_snapshot and check_state='checked')
      )
    )
  )
);

create unique index if not exists crm_order_check_events_sequence_unique
  on public.crm_order_check_events(event_sequence);
create unique index if not exists crm_order_check_events_org_id_unique
  on public.crm_order_check_events(organization_id,id);
create unique index if not exists crm_order_check_events_receipt_unique
  on public.crm_order_check_events(organization_id,receipt_id);
create unique index if not exists crm_order_check_events_order_no_unique
  on public.crm_order_check_events(organization_id,order_id,order_revision,event_no);
create index if not exists crm_order_check_events_order_sequence_idx
  on public.crm_order_check_events(organization_id,order_id,event_sequence desc);
create index if not exists crm_order_check_events_current_item_idx
  on public.crm_order_check_events(
    organization_id,order_id,order_revision,item_id,event_sequence desc
  );

do $f02_t12$
begin
  if not exists(select 1 from pg_constraint
    where conrelid='public.crm_order_check_events'::regclass
      and conname='crm_order_check_events_receipt_tenant_fkey') then
    alter table public.crm_order_check_events
      add constraint crm_order_check_events_receipt_tenant_fkey
      foreign key(organization_id,receipt_id)
      references public.crm_order_check_command_receipts(organization_id,id)
      on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint
    where conrelid='public.crm_order_check_events'::regclass
      and conname='crm_order_check_events_order_tenant_fkey') then
    alter table public.crm_order_check_events
      add constraint crm_order_check_events_order_tenant_fkey
      foreign key(organization_id,order_id)
      references public.crm_orders(organization_id,id) on delete restrict;
  end if;
end
$f02_t12$;

alter table public.crm_order_check_command_receipts enable row level security;
alter table public.crm_order_check_events enable row level security;

drop policy if exists crm_order_check_events_select on public.crm_order_check_events;
create policy crm_order_check_events_select
  on public.crm_order_check_events for select to authenticated
  using(organization_id in(select public.fn_user_org_ids()));

-- Uma única consulta fornece estado atual e página histórica do mesmo snapshot.
create or replace function public.fn_crm_order_checks(
  p_org uuid,
  p_order uuid,
  p_limit integer default 50,
  p_before_sequence text default null
) returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $f02_t12$
declare
  v_result jsonb;
  v_before_sequence bigint;
begin
  if p_org is null or p_order is null or p_limit not between 1 and 100
     or (p_before_sequence is not null and p_before_sequence!~'^[1-9][0-9]*$') then
    raise exception 'crm_order_checks_invalid_arguments' using errcode='22023';
  end if;
  if p_before_sequence is not null then
    begin
      v_before_sequence:=p_before_sequence::bigint;
    exception when numeric_value_out_of_range then
      raise exception 'crm_order_checks_invalid_arguments' using errcode='22023';
    end;
  end if;

  with raw_history as (
    select e.* from public.crm_order_check_events e
     where e.organization_id=p_org and e.order_id=p_order
       and (v_before_sequence is null or e.event_sequence<v_before_sequence)
     order by e.event_sequence desc
     limit p_limit+1
  ), page_history as (
    select * from raw_history order by event_sequence desc limit p_limit
  )
  select jsonb_build_object(
    'order_id',o.id,
    'order_revision',o.revision,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_id',i.id,
        'ordered_quantity',i.quantity::text,
        'checked_quantity',coalesce(last_event.checked_quantity::text,'0.000'),
        'sale_unit',i.sale_unit_snapshot,
        'state',coalesce(last_event.check_state,'pending'),
        'event_id',last_event.id,
        'event_sequence',last_event.event_sequence::text,
        'checked_by_user_id',last_event.actor_user_id,
        'checked_at',last_event.created_at
      ) order by i.position,i.id)
      from public.crm_order_items i
      left join lateral(
        select e.id,e.event_sequence,e.checked_quantity,e.check_state,
               e.actor_user_id,e.created_at
          from public.crm_order_check_events e
         where e.organization_id=i.organization_id and e.order_id=i.order_id
           and e.order_revision=o.revision and e.item_id=i.id
         order by e.event_sequence desc limit 1
      ) last_event on true
      where i.organization_id=o.organization_id and i.order_id=o.id
    ),'[]'::jsonb),
    'history',coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_id',h.id,
        'event_sequence',h.event_sequence::text,
        'order_id',h.order_id,
        'order_revision',h.order_revision,
        'item_id',h.item_id,
        'ordered_quantity',h.ordered_quantity_snapshot::text,
        'checked_quantity',h.checked_quantity::text,
        'sale_unit',h.sale_unit_snapshot,
        'state',h.check_state,
        'checked_by_user_id',h.actor_user_id,
        'checked_at',h.created_at
      ) order by h.event_sequence desc) from page_history h
    ),'[]'::jsonb),
    'next_before_sequence',case
      when (select count(*) from raw_history)>p_limit
      then (select min(event_sequence)::text from page_history)
      else null end
  ) into v_result
  from public.crm_orders o
  where o.organization_id=p_org and o.id=p_order;

  return v_result;
end
$f02_t12$;

comment on table public.crm_order_check_command_receipts is
  'Recibos privados de idempotência da conferência; hash e replay sem grants de cliente.';
comment on table public.crm_order_check_events is
  'Journal append-only de quantidades conferidas por item e revisão; sem descrição ou PII textual.';
comment on column public.crm_order_check_events.item_id is
  'Snapshot da identidade do item no momento do evento, sem FK: edição posterior pode remover o item.';
comment on function public.fn_crm_order_checks(uuid,uuid,integer,text) is
  'Leitura security-invoker de estado atual e histórico paginado; RLS das tabelas decide o tenant.';

do $f02_t12$
declare v_invalid integer;
begin
  if exists(select 1 from pg_tables where schemaname='public'
    and tablename in('crm_order_check_command_receipts','crm_order_check_events')
    and not rowsecurity) then
    raise exception 'F02-T12 criou tabela sem RLS';
  end if;
  if exists(select 1 from pg_policies where schemaname='public'
    and tablename='crm_order_check_command_receipts') then
    raise exception 'recibos de conferência devem ter zero policies';
  end if;
  select count(*) into v_invalid from pg_constraint
   where conrelid in(
     'public.crm_order_check_command_receipts'::regclass,
     'public.crm_order_check_events'::regclass
   ) and contype='f' and not convalidated;
  if v_invalid<>0 then
    raise exception 'F02-T12 deixou % FK(s) sem validação',v_invalid;
  end if;
end
$f02_t12$;

alter function public.fn_crm_order_checks(uuid,uuid,integer,text) owner to postgres;
revoke all on function public.fn_crm_order_checks(uuid,uuid,integer,text)
  from public,anon,authenticated,service_role;
grant execute on function public.fn_crm_order_checks(uuid,uuid,integer,text)
  to authenticated,service_role;

revoke all on public.crm_order_check_command_receipts,public.crm_order_check_events
  from public,anon,authenticated,service_role;
grant select on public.crm_order_check_events to authenticated;
grant select,insert,update on public.crm_order_check_command_receipts to service_role;
grant select,insert on public.crm_order_check_events to service_role;
revoke all on sequence public.crm_order_check_events_event_sequence_seq
  from public,anon,authenticated,service_role;
grant usage on sequence public.crm_order_check_events_event_sequence_seq to service_role;

notify pgrst,'reload schema';
