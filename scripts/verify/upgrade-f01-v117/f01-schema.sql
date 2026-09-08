select jsonb_pretty(jsonb_build_object(
 'constraints',(select jsonb_agg(jsonb_build_array(c.conrelid::regclass::text,c.conname,pg_get_constraintdef(c.oid)) order by c.conrelid::regclass::text,c.conname) from pg_constraint c where c.conrelid in ('public.channel_accounts'::regclass,'public.tenant_settings'::regclass,'public.ai_usage_events'::regclass,'public.webhook_quarantine'::regclass)),
 'indexes',(select jsonb_agg(jsonb_build_array(tablename,indexname,indexdef) order by tablename,indexname) from pg_indexes where schemaname='public' and tablename in ('channel_accounts','tenant_settings','ai_usage_events','webhook_quarantine')),
 'resolver',(select pg_get_functiondef('public.current_organization_id()'::regprocedure))
));
