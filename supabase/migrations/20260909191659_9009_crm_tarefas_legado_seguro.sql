-- F02-T03 — pré-requisito de segurança para tarefas legadas.
--
-- A 0210 aceitava contact_id por UUID global. Antes de a 9008 validar o vínculo
-- composto por tenant, preservamos a tarefa e removemos apenas vínculos antigos
-- que apontavam para um contato de outra organização. O ID anterior permanece
-- no audit técnico, sem copiar título ou descrição.

create or replace function public.fn_crm_tasks_guard_anonymized_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_is_anonymized boolean;
begin
  if new.contact_id is null then
    return new;
  end if;

  -- A trava compartilha a mesma linha que a anonimização atualiza. INSERT fica
  -- serializado. Em UPDATE concorrente, o ciclo tarefa -> contato versus
  -- contato -> tarefa pode produzir 40P01; qualquer vítima perde a transação
  -- inteira e o estado confirmado nunca combina contato anonimizado com PII.
  select c.is_anonymized
    into v_is_anonymized
    from public.contacts c
   where c.organization_id = new.organization_id
     and c.id = new.contact_id
   for share;

  if found and v_is_anonymized then
    new.title := 'Tarefa anonimizada';
    new.description := null;
  end if;

  return new;
end;
$function$;

alter function public.fn_crm_tasks_guard_anonymized_contact() owner to postgres;
revoke all on function public.fn_crm_tasks_guard_anonymized_contact()
  from public, anon, authenticated, service_role;

create or replace trigger trg_crm_tasks_guard_anonymized_contact
before insert or update of organization_id, contact_id, title, description
on public.crm_tasks
for each row
execute function public.fn_crm_tasks_guard_anonymized_contact();

do $migration$
declare
  v_cross_scanned integer;
  v_cross_repaired integer;
  v_anonymized_scanned integer;
  v_anonymized_repaired integer;
begin
  -- SHARE ROW EXCLUSIVE conflita com INSERT/UPDATE/DELETE e permanece até o fim
  -- deste DO. Assim reparo e validação da FK observam a mesma fronteira.
  lock table public.crm_tasks in share row exclusive mode;

  select count(*)::integer
    into v_cross_scanned
    from public.crm_tasks t
    join public.contacts c on c.id = t.contact_id
   where c.organization_id <> t.organization_id;

  with repaired as (
    update public.crm_tasks t
       set contact_id = null,
           title = case
             when c.is_anonymized then 'Tarefa anonimizada'
             else t.title
           end,
           description = case
             when c.is_anonymized then null
             else t.description
           end
      from public.contacts c
     where c.id = t.contact_id
       and c.organization_id <> t.organization_id
    returning t.id, t.organization_id, c.id as previous_contact_id,
      c.is_anonymized
  ), audited as (
    insert into public.api_audit_log
      (organization_id, action, resource_type, resource_id, bypassed_rls, metadata)
    select organization_id,
           'crm_task.updated',
           'crm_tasks',
           id,
           true,
           jsonb_build_object(
             'reason', 'cross_tenant_legacy_contact',
             'fields_changed', case
               when is_anonymized then
                 jsonb_build_array('contact_id', 'title', 'description')
               else jsonb_build_array('contact_id')
             end,
             'previous_contact_id', previous_contact_id
           )
      from repaired
    returning 1
  )
  select count(*)::integer into v_cross_repaired from audited;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.crm_tasks'::regclass
       and conname = 'crm_tasks_contact_tenant_fkey'
  ) then
    execute $ddl$
      alter table public.crm_tasks
        add constraint crm_tasks_contact_tenant_fkey
        foreign key (organization_id, contact_id)
        references public.contacts (organization_id, id)
        on delete set null (contact_id)
    $ddl$;
  elsif exists (
    select 1
      from pg_constraint
     where conrelid = 'public.crm_tasks'::regclass
       and conname = 'crm_tasks_contact_tenant_fkey'
       and not convalidated
  ) then
    execute 'alter table public.crm_tasks validate constraint crm_tasks_contact_tenant_fkey';
  end if;

  -- Limpa texto que uma escrita tardia possa ter recolocado antes desta
  -- proteção. Aqui o vínculo já é composto; o caso cross-tenant anonimizado foi
  -- redigido na atualização anterior, antes de perder o contact_id.
  select count(*)::integer
    into v_anonymized_scanned
    from public.crm_tasks t
    join public.contacts c
      on c.organization_id = t.organization_id
     and c.id = t.contact_id
   where c.is_anonymized
     and (t.title <> 'Tarefa anonimizada' or t.description is not null);

  with redacted as (
    update public.crm_tasks t
       set title = 'Tarefa anonimizada',
           description = null
      from public.contacts c
     where c.organization_id = t.organization_id
       and c.id = t.contact_id
       and c.is_anonymized
       and (t.title <> 'Tarefa anonimizada' or t.description is not null)
    returning t.id, t.organization_id
  ), audited as (
    insert into public.api_audit_log
      (organization_id, action, resource_type, resource_id, bypassed_rls, metadata)
    select organization_id,
           'crm_task.updated',
           'crm_tasks',
           id,
           true,
           jsonb_build_object(
             'reason', 'anonymized_contact_late_write',
             'fields_changed', jsonb_build_array('title', 'description')
           )
      from redacted
    returning 1
  )
  select count(*)::integer into v_anonymized_repaired from audited;

  raise notice
    'crm_tasks legacy safety: cross_scanned=%, cross_repaired=%, anonymized_scanned=%, anonymized_repaired=%',
    v_cross_scanned,
    v_cross_repaired,
    v_anonymized_scanned,
    v_anonymized_repaired;
end;
$migration$;

comment on function public.fn_crm_tasks_guard_anonymized_contact() is
  'Trigger privado: serializa a tarefa com o contato e impede texto livre ligado a contato anonimizado.';

notify pgrst, 'reload schema';

-- Trigger function privada: não existe chamador direto, inclusive service role.
revoke all on function public.fn_crm_tasks_guard_anonymized_contact()
  from public, anon, authenticated, service_role;
