begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001"}',true);
do $rls$
declare t text; n int; checks int:=0;
begin
 foreach t in array array['contacts','catalog_products','conversations','messages','crm_tasks','channel_accounts','tenant_settings','calendar_appointments'] loop
  execute format('select count(*) from public.%I where organization_id=$1',t) into n using '20000000-0000-4000-8000-000000000001'::uuid;
  if n<>1 then raise exception 'own rows %: % expected 1',t,n;end if;
  execute format('select count(*) from public.%I where organization_id=$1',t) into n using '20000000-0000-4000-8000-000000000002'::uuid;
  if n<>0 then raise exception 'cross read %: %',t,n;end if;
  checks:=checks+1;
 end loop;
 update public.contacts set name=name where organization_id='20000000-0000-4000-8000-000000000001';get diagnostics n=row_count;
 if n<>1 then raise exception 'own update denied: %',n;end if;
 update public.contacts set name='should not change' where organization_id='20000000-0000-4000-8000-000000000002';get diagnostics n=row_count;
 if n<>0 then raise exception 'cross update leak: %',n;end if;
 delete from public.contacts where organization_id='20000000-0000-4000-8000-000000000002';get diagnostics n=row_count;
 if n<>0 then raise exception 'cross delete leak: %',n;end if;
 begin
  insert into public.contacts(organization_id,name) values('20000000-0000-4000-8000-000000000002','forbidden fixture');
  raise exception 'cross insert was allowed';
 exception when insufficient_privilege then null;end;
 begin
  update public.contacts set organization_id='20000000-0000-4000-8000-000000000002' where organization_id='20000000-0000-4000-8000-000000000001';
  raise exception 'tenant reassignment was allowed';
 exception when insufficient_privilege then null;end;
 raise notice 'ISOLATION direction=1 read_tables=%/8 own_update=1 cross_write_denied=4/4',checks;
end $rls$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002"}',true);
do $rls$
declare t text; n int; checks int:=0;
begin
 foreach t in array array['contacts','catalog_products','conversations','messages','crm_tasks','channel_accounts','tenant_settings','calendar_appointments'] loop
  execute format('select count(*) from public.%I where organization_id=$1',t) into n using '20000000-0000-4000-8000-000000000002'::uuid;
  if n<>1 then raise exception 'own rows %: % expected 1',t,n;end if;
  execute format('select count(*) from public.%I where organization_id=$1',t) into n using '20000000-0000-4000-8000-000000000001'::uuid;
  if n<>0 then raise exception 'cross read %: %',t,n;end if;
  checks:=checks+1;
 end loop;
 update public.contacts set name=name where organization_id='20000000-0000-4000-8000-000000000002';get diagnostics n=row_count;
 if n<>1 then raise exception 'own update denied: %',n;end if;
 update public.contacts set name='should not change' where organization_id='20000000-0000-4000-8000-000000000001';get diagnostics n=row_count;
 if n<>0 then raise exception 'cross update leak: %',n;end if;
 delete from public.contacts where organization_id='20000000-0000-4000-8000-000000000001';get diagnostics n=row_count;
 if n<>0 then raise exception 'cross delete leak: %',n;end if;
 begin
  insert into public.contacts(organization_id,name) values('20000000-0000-4000-8000-000000000001','forbidden fixture');
  raise exception 'cross insert was allowed';
 exception when insufficient_privilege then null;end;
 begin
  update public.contacts set organization_id='20000000-0000-4000-8000-000000000001' where organization_id='20000000-0000-4000-8000-000000000002';
  raise exception 'tenant reassignment was allowed';
 exception when insufficient_privilege then null;end;
 raise notice 'ISOLATION direction=2 read_tables=%/8 own_update=1 cross_write_denied=4/4',checks;
end $rls$;
rollback;
