do $checks$
declare x record; failures int:=0;
begin
 if (select count(*) from pg_tables where schemaname='public' and tablename in ('channel_accounts','tenant_settings','ai_usage_events','webhook_quarantine') and rowsecurity)<>4 then
  raise exception 'F01 RLS missing';
 end if;
 for x in select unnest(array['channel_accounts','tenant_settings','ai_usage_events','webhook_quarantine']) t loop
  if has_table_privilege('anon','public.'||x.t,'select,insert,update,delete') then raise exception 'anon privilege on %',x.t; end if;
 end loop;
 for x in select unnest(array['ai_usage_events','webhook_quarantine']) t loop
  if has_table_privilege('authenticated','public.'||x.t,'select,insert,update,delete') then raise exception 'authenticated privilege on %',x.t; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename=x.t) then raise exception 'policy on service-only %',x.t; end if;
 end loop;
 begin
  insert into public.channel_accounts(organization_id,provider,account_key) values('20000000-0000-4000-8000-000000000001','bogus','negative-provider');
  raise exception 'provider CHECK absent';
 exception when check_violation then failures:=failures+1; end;
 begin
  insert into public.channel_accounts(organization_id,provider,account_key,status) values('20000000-0000-4000-8000-000000000001','mock','negative-status','bogus');
  raise exception 'status CHECK absent';
 exception when check_violation then failures:=failures+1; end;
 begin
  insert into public.tenant_settings(organization_id,key,value,source) values('20000000-0000-4000-8000-000000000001','negative-source','{}','bogus');
  raise exception 'source CHECK absent';
 exception when check_violation then failures:=failures+1; end;
 begin
  insert into public.ai_usage_events(organization_id,model,operation) values('20000000-0000-4000-8000-000000000001','fixture','bogus');
  raise exception 'operation CHECK absent';
 exception when check_violation then failures:=failures+1; end;
 begin
  insert into public.channel_accounts(organization_id,provider,account_key) values('20000000-0000-4000-8000-000000000002','mock','proof-1');
  raise exception 'channel unique absent';
 exception when unique_violation then failures:=failures+1; end;
 begin
  insert into public.tenant_settings(organization_id,key,value) values('20000000-0000-4000-8000-000000000001','branding.name','"duplicate"');
  raise exception 'settings primary key absent';
 exception when unique_violation then failures:=failures+1; end;
 if failures<>6 then raise exception 'negative checks incomplete: %',failures; end if;
 raise notice 'F01_SECURITY rls=4/4 anon_denied=4/4 service_only=2/2 constraints_negative=6/6';
end $checks$;
