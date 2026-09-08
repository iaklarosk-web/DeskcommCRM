do $seed$
declare i integer; u uuid; o uuid; s uuid; c uuid; v uuid; suffix text;
begin
 for i in 1..2 loop
  suffix:=lpad(i::text,12,'0');
  u:=('10000000-0000-4000-8000-'||suffix)::uuid;
  o:=('20000000-0000-4000-8000-'||suffix)::uuid;
  s:=('30000000-0000-4000-8000-'||suffix)::uuid;
  c:=('40000000-0000-4000-8000-'||suffix)::uuid;
  v:=('50000000-0000-4000-8000-'||suffix)::uuid;
  insert into auth.users(id,email) values(u,'upgrade-'||i||'@example.invalid');
  insert into public.organizations(id,slug,legal_name,display_name,timezone)
   values(o,'upgrade-proof-'||i,'Upgrade Proof '||i,'Fixture '||i,case when i=1 then 'America/Sao_Paulo' else 'America/Manaus' end);
  insert into public.user_organizations(user_id,organization_id,role,accepted_at) values(u,o,'admin',now());
  insert into public.channel_sessions(id,organization_id,waha_session_name,webhook_secret_encrypted)
   values(s,o,'upgrade-proof-'||i,'\x00'::bytea);
  insert into public.contacts(id,organization_id,name,display_name,phone_number)
   values(c,o,'Cliente ficticio '||i,'Cliente ficticio '||i,'+550000000000'||i);
  insert into public.conversations(id,organization_id,contact_id,channel_session_id,status)
   values(v,o,c,s,'open');
  insert into public.messages(id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,body)
   values(('60000000-0000-4000-8000-'||suffix)::uuid,o,v,s,c,'text','inbound','Pedido ficticio '||i);
  insert into public.catalog_products(id,organization_id,codigo,nome,preco_cents,controla_estoque)
   values(('70000000-0000-4000-8000-'||suffix)::uuid,o,'PROOF-'||i,'Produto ficticio '||i,12345+i,false);
  insert into public.crm_tasks(id,organization_id,contact_id,title,status)
   values(('80000000-0000-4000-8000-'||suffix)::uuid,o,c,'Conferir fixture '||i,'pending');
  insert into public.channel_accounts(id,organization_id,provider,account_key,status)
   values(('90000000-0000-4000-8000-'||suffix)::uuid,o,'mock','proof-'||i,'active');
  insert into public.tenant_settings(organization_id,key,value,source)
   values(o,'branding.name',to_jsonb('Minha marca '||i),'tenant_admin');
  insert into public.ai_usage_events(id,organization_id,conversation_id,model,operation,prompt_tokens,completion_tokens,estimated_cost_cents,provider_request_id)
   values(('a0000000-0000-4000-8000-'||suffix)::uuid,o,v,'fixture-model','chat',123,45,7,'fixture-'||i);
  insert into public.calendar_appointments(organization_id,contact_id,owner_user_id,title,notes,starts_at,ends_at,status,created_by_kind,source)
   values(o,c,u,'Agenda ficticia '||i,'Nota a preservar',timestamptz '2030-01-15 12:00:00+00',timestamptz '2030-01-15 12:30:00+00','confirmed','user','ui');
 end loop;
 insert into public.webhook_quarantine(provider,account_key,payload,reason)
 values('mock','unknown-fixture','{"synthetic":true}'::jsonb,'fixture_unknown');
end $seed$;
