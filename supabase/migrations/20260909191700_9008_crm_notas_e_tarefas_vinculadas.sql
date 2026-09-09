-- F02-T03 — notas humanas e tarefas vinculadas a pedidos.
-- Notas humanas append-only e tarefas vinculadas a pedidos com journal atômico.

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.crm_orders'::regclass
      and conname = 'crm_orders_org_id_contact_key'
  ) then
    alter table public.crm_orders
      add constraint crm_orders_org_id_contact_key
      unique (organization_id, id, contact_id);
  end if;
end
$migration$;

alter table public.crm_tasks add column if not exists order_id uuid;
alter table public.crm_tasks add column if not exists revision integer not null default 1;
do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.crm_tasks'::regclass
      and conname = 'crm_tasks_revision_positive'
  ) then
    alter table public.crm_tasks add constraint crm_tasks_revision_positive
      check (revision >= 1);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.crm_tasks'::regclass
      and conname = 'crm_tasks_linked_shape'
  ) then
    alter table public.crm_tasks add constraint crm_tasks_linked_shape check (
      order_id is null or (contact_id is not null and lead_id is null)
    );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.crm_tasks'::regclass
      and conname = 'crm_tasks_org_id_order_contact_key'
  ) then
    alter table public.crm_tasks add constraint crm_tasks_org_id_order_contact_key
      unique (organization_id, id, order_id, contact_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.crm_tasks'::regclass
      and conname = 'crm_tasks_order_contact_tenant_fkey'
  ) then
    alter table public.crm_tasks add constraint crm_tasks_order_contact_tenant_fkey
      foreign key (organization_id, order_id, contact_id)
      references public.crm_orders (organization_id, id, contact_id)
      on delete no action deferrable initially deferred;
  end if;
end
$migration$;

-- Conserva o SET NULL legado e passa a provar o tenant do contato.
do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.crm_tasks'::regclass
      and conname = 'crm_tasks_contact_tenant_fkey'
  ) then
    alter table public.crm_tasks add constraint crm_tasks_contact_tenant_fkey
      foreign key (organization_id, contact_id)
      references public.contacts (organization_id, id)
      on delete set null (contact_id);
  end if;
end
$migration$;

create index if not exists crm_tasks_org_order_idx
  on public.crm_tasks (organization_id, order_id, created_at desc, id)
  where order_id is not null;

-- A policy permissiva crm_tasks_write continua servindo tarefas legadas. Estas
-- três cercas tornam qualquer linha vinculada read-only para JWT authenticated.
drop policy if exists crm_tasks_linked_insert_guard on public.crm_tasks;
create policy crm_tasks_linked_insert_guard on public.crm_tasks
  as restrictive for insert to authenticated
  with check (order_id is null);
drop policy if exists crm_tasks_linked_update_guard on public.crm_tasks;
create policy crm_tasks_linked_update_guard on public.crm_tasks
  as restrictive for update to authenticated
  using (order_id is null) with check (order_id is null);
drop policy if exists crm_tasks_linked_delete_guard on public.crm_tasks;
create policy crm_tasks_linked_delete_guard on public.crm_tasks
  as restrictive for delete to authenticated
  using (order_id is null);

-- A 0210 nasceu depois da varredura geral de suporte; fecha também esse acesso
-- direto para as tarefas legadas, sem mudar a permissão normal de agent+.
drop policy if exists crm_tasks_support_insert on public.crm_tasks;
create policy crm_tasks_support_insert on public.crm_tasks
  as restrictive for insert to authenticated
  with check (public.fn_support_write_allowed(organization_id));
drop policy if exists crm_tasks_support_update on public.crm_tasks;
create policy crm_tasks_support_update on public.crm_tasks
  as restrictive for update to authenticated
  using (public.fn_support_write_allowed(organization_id))
  with check (public.fn_support_write_allowed(organization_id));
drop policy if exists crm_tasks_support_delete on public.crm_tasks;
create policy crm_tasks_support_delete on public.crm_tasks
  as restrictive for delete to authenticated
  using (public.fn_support_write_allowed(organization_id));

create table if not exists public.crm_task_command_receipts (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  command_type text not null check (
    command_type in ('create_linked_task', 'edit_linked_task', 'set_linked_task_status')
  ),
  request_hash bytea not null check (octet_length(request_hash) = 32),
  actor_type text not null check (actor_type in ('user', 'ai', 'automation')),
  actor_id uuid,
  result_task_id uuid not null,
  result_task_revision integer not null check (result_task_revision >= 1),
  result_status text not null check (
    result_status in ('pending', 'in_progress', 'done', 'cancelled')
  ),
  created_at timestamptz not null default now(),
  constraint crm_task_command_receipts_org_id_key unique (organization_id, id),
  constraint crm_task_command_receipts_result_key unique (
    organization_id, id, result_task_id, result_task_revision, result_status
  )
);

alter table public.crm_task_command_receipts enable row level security;
revoke all on public.crm_task_command_receipts from public, anon, authenticated, service_role;
grant select, insert on public.crm_task_command_receipts to service_role;
-- Zero policies: hash e metadados de idempotência nunca entram em SELECT de domínio.

create table if not exists public.crm_task_events (
  -- Mesmo UUID do receipt: relação 1:1 e um único fato por comando concluído.
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null,
  order_id uuid not null,
  contact_id uuid not null,
  task_revision integer not null check (task_revision >= 1),
  event_type text not null check (event_type in ('created', 'edited', 'status_changed')),
  from_status text check (
    from_status is null or from_status in ('pending', 'in_progress', 'done', 'cancelled')
  ),
  to_status text not null check (
    to_status in ('pending', 'in_progress', 'done', 'cancelled')
  ),
  actor_type text not null check (actor_type in ('user', 'ai', 'automation')),
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint crm_task_events_created_shape check (
    (event_type = 'created' and from_status is null)
    or (
      event_type = 'edited'
      and from_status is not null
      and from_status = to_status
    )
    or (
      event_type = 'status_changed'
      and from_status is not null
      and from_status <> to_status
    )
  ),
  constraint crm_task_events_org_task_revision_key
    unique (organization_id, task_id, task_revision),
  constraint crm_task_events_receipt_fkey
    foreign key (organization_id, id, task_id, task_revision, to_status)
    references public.crm_task_command_receipts (
      organization_id, id, result_task_id, result_task_revision, result_status
    )
    on delete restrict,
  constraint crm_task_events_task_order_contact_fkey
    foreign key (organization_id, task_id, order_id, contact_id)
    references public.crm_tasks (organization_id, id, order_id, contact_id)
    on delete restrict
);

create index if not exists crm_task_events_order_time_idx
  on public.crm_task_events (organization_id, order_id, created_at desc, id);
create index if not exists crm_task_events_contact_time_idx
  on public.crm_task_events (organization_id, contact_id, created_at desc, id);

alter table public.crm_task_events enable row level security;
drop policy if exists crm_task_events_select on public.crm_task_events;
create policy crm_task_events_select on public.crm_task_events
  for select to authenticated using (
    organization_id in (select public.fn_user_org_ids())
  );
revoke all on public.crm_task_events from public, anon, authenticated, service_role;
grant select on public.crm_task_events to authenticated;
grant select, insert on public.crm_task_events to service_role;

create table if not exists public.crm_notes (
  -- ID obrigatório e fornecido pelo cliente: chave natural de idempotência.
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null,
  order_id uuid,
  body text not null check (length(btrim(body)) between 1 and 4096),
  actor_user_id uuid not null,
  created_at timestamptz not null default now(),
  redacted_at timestamptz,
  constraint crm_notes_contact_tenant_fkey
    foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id) on delete restrict,
  constraint crm_notes_order_contact_tenant_fkey
    foreign key (organization_id, order_id, contact_id)
    references public.crm_orders (organization_id, id, contact_id) on delete restrict
);

create index if not exists crm_notes_contact_time_idx
  on public.crm_notes (organization_id, contact_id, created_at desc, id);
create index if not exists crm_notes_order_time_idx
  on public.crm_notes (organization_id, order_id, created_at desc, id)
  where order_id is not null;

alter table public.crm_notes enable row level security;
drop policy if exists crm_notes_select on public.crm_notes;
create policy crm_notes_select on public.crm_notes
  for select to authenticated using (
    organization_id in (select public.fn_user_org_ids())
  );
revoke all on public.crm_notes from public, anon, authenticated, service_role;
grant select on public.crm_notes to authenticated;
grant select, insert on public.crm_notes to service_role;

create or replace function public.fn_crm_notes_redact_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.crm_notes
     set body = '[Nota anonimizada]',
         redacted_at = coalesce(redacted_at, pg_catalog.now())
   where organization_id = new.organization_id
     and contact_id = new.id
     and (redacted_at is null or body is distinct from '[Nota anonimizada]');
  return new;
end;
$$;
alter function public.fn_crm_notes_redact_contact() owner to postgres;
revoke execute on function public.fn_crm_notes_redact_contact()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_crm_notes_redact_contact on public.contacts;
create trigger trg_crm_notes_redact_contact
after update of is_anonymized on public.contacts
for each row
when (new.is_anonymized is true)
execute function public.fn_crm_notes_redact_contact();
