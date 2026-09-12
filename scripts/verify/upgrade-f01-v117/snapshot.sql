select jsonb_pretty(jsonb_build_object(
 'organizations',(select jsonb_agg(jsonb_build_array(id,slug,legal_name,display_name,status,timezone,settings) order by id) from public.organizations),
 'memberships',(select jsonb_agg(jsonb_build_array(id,user_id,organization_id,role,accepted_at,revoked_at) order by id) from public.user_organizations),
 'contacts',(select jsonb_agg(jsonb_build_array(id,organization_id,name,display_name,phone_number,is_anonymized,force_human) order by id) from public.contacts),
 'sessions',(select jsonb_agg(jsonb_build_array(id,organization_id,waha_session_name,status) order by id) from public.channel_sessions),
 'conversations',(select jsonb_agg(jsonb_build_array(id,organization_id,contact_id,channel_session_id,status,bot_silenced_until) order by id) from public.conversations),
 'messages',(select jsonb_agg(jsonb_build_array(id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,body) order by id) from public.messages),
 'products',(select jsonb_agg(jsonb_build_array(id,organization_id,codigo,nome,preco_cents,moeda,controla_estoque,ativo) order by id) from public.catalog_products),
 'tasks',(select jsonb_agg(jsonb_build_array(id,organization_id,contact_id,title,status,assigned_to) order by id) from public.crm_tasks),
 'channel_accounts',(select jsonb_agg(to_jsonb(x) order by id) from public.channel_accounts x),
 'tenant_settings',(select jsonb_agg(to_jsonb(x) order by organization_id,key) from public.tenant_settings x),
 'usage',(select jsonb_agg(to_jsonb(x) order by id) from public.ai_usage_events x),
 'quarantine',(select jsonb_agg(to_jsonb(x) order by id) from public.webhook_quarantine x),
 'appointments',(select jsonb_agg(jsonb_build_array(id,organization_id,contact_id,owner_user_id,title,notes,starts_at,ends_at,status,created_by_kind,source) order by id) from public.calendar_appointments)
));
