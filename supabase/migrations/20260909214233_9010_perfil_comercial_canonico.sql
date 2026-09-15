-- F02-T08: perfil comercial canônico. Timestamp gerado pelo Supabase CLI.
-- Mantém aliases antigos como histórico privado quando o admin salva a fonte
-- canônica correspondente. Não faz backfill nem escolhe valor por timestamp.

create schema if not exists private;

create table if not exists private.tenant_setting_alias_archive (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  alias_key text not null,
  value jsonb not null,
  schema_version integer not null,
  source text not null,
  legacy_updated_by uuid,
  legacy_updated_at timestamptz not null,
  destination text not null,
  resolved_by uuid not null,
  resolved_at timestamptz not null default now(),
  constraint tenant_setting_alias_archive_source
    check (source in ('seed','tenant_admin','template')),
  constraint tenant_setting_alias_archive_pair check (
    (alias_key='business.timezone' and destination='organizations.timezone') or
    (alias_key='branding.name' and destination='organizations.settings.branding.app_name') or
    (alias_key='branding.primary_color' and destination='organizations.settings.branding.accent_hex') or
    (alias_key='branding.logo_url' and destination='organizations.settings.branding.logo_path')
  )
);

alter table private.tenant_setting_alias_archive owner to postgres;
alter table private.tenant_setting_alias_archive enable row level security;

create index if not exists tenant_setting_alias_archive_latest_idx
  on private.tenant_setting_alias_archive
  (organization_id,alias_key,resolved_at desc,id desc);

revoke all on table private.tenant_setting_alias_archive
  from public,anon,authenticated,service_role;

create or replace function private.fn_archive_tenant_setting_alias(
  p_org uuid,
  p_actor uuid,
  p_alias text,
  p_destination text
) returns boolean
language plpgsql
volatile
security definer
set search_path=''
as $f$
declare
  v_row public.tenant_settings%rowtype;
begin
  if p_org is null or p_actor is null then
    raise exception 'commercial_alias_argument_null' using errcode='22023';
  end if;
  if not (
    (p_alias='business.timezone' and p_destination='organizations.timezone') or
    (p_alias='branding.name' and p_destination='organizations.settings.branding.app_name') or
    (p_alias='branding.primary_color' and p_destination='organizations.settings.branding.accent_hex') or
    (p_alias='branding.logo_url' and p_destination='organizations.settings.branding.logo_path')
  ) then
    raise exception 'commercial_alias_pair_invalid' using errcode='22023';
  end if;

  select * into v_row
    from public.tenant_settings
   where organization_id=p_org and key=p_alias
   for update;
  if not found then return false; end if;

  insert into private.tenant_setting_alias_archive
    (organization_id,alias_key,value,schema_version,source,legacy_updated_by,
     legacy_updated_at,destination,resolved_by)
  values
    (v_row.organization_id,v_row.key,v_row.value,v_row.schema_version,v_row.source,
     v_row.updated_by,v_row.updated_at,p_destination,p_actor);

  delete from public.tenant_settings
   where organization_id=p_org and key=p_alias;
  return true;
end
$f$;

alter function private.fn_archive_tenant_setting_alias(uuid,uuid,text,text) owner to postgres;
revoke all on function private.fn_archive_tenant_setting_alias(uuid,uuid,text,text)
  from public,anon,authenticated,service_role;

-- Leitor service-only sem `value`: o DTO conhece que houve resolução, mas não
-- recebe conteúdo legado (em especial branding.logo_url).
create or replace function public.fn_commercial_alias_resolutions(p_org uuid)
returns table(
  alias_key text,
  source text,
  legacy_updated_at timestamptz,
  destination text,
  resolved_at timestamptz
)
language sql
stable
security definer
set search_path=''
as $f$
  select distinct on (h.alias_key)
         h.alias_key,h.source,h.legacy_updated_at,h.destination,h.resolved_at
    from private.tenant_setting_alias_archive h
   where h.organization_id=p_org
     and public.current_organization_id()=p_org
   order by h.alias_key,h.resolved_at desc,h.id desc
$f$;

alter function public.fn_commercial_alias_resolutions(uuid) owner to postgres;
revoke all on function public.fn_commercial_alias_resolutions(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.fn_commercial_alias_resolutions(uuid) to service_role;

-- Forward-fix da função de logo aplicada: mesmo comportamento, com arquivo do
-- alias somente após o UPDATE canônico ter casado uma organização.
create or replace function public.fn_definir_logo_da_organizacao(
  p_org uuid,
  p_actor uuid,
  p_path text
) returns integer
language plpgsql
volatile
security definer
set search_path='public','pg_temp'
as $f$
declare
  v_linhas integer;
  v_path text;
begin
  if p_org is null or p_actor is null then
    raise exception 'logo_da_organizacao_argumento_nulo' using errcode='22023';
  end if;
  v_path:=nullif(btrim(coalesce(p_path,'')),'');
  if v_path is not null
     and v_path !~ ('^'||p_org::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$')
  then
    raise exception 'logo_da_organizacao_caminho_fora_do_escopo' using errcode='22023';
  end if;
  if not exists(
       select 1 from public.user_organizations uo
        where uo.user_id=p_actor and uo.organization_id=p_org and uo.role='admin'
          and uo.revoked_at is null)
     and not exists(
       select 1 from public.platform_admins pa
        where pa.user_id=p_actor and pa.revoked_at is null)
  then
    raise exception 'logo_da_organizacao_sem_permissao' using errcode='42501';
  end if;

  update public.organizations o
     set settings=case when v_path is null then
       jsonb_set(coalesce(o.settings,'{}'::jsonb),'{branding}',
         coalesce(o.settings->'branding','{}'::jsonb)-'logo_path',true)
     else
       jsonb_set(coalesce(o.settings,'{}'::jsonb),'{branding}',
         coalesce(o.settings->'branding','{}'::jsonb)||jsonb_build_object('logo_path',v_path),true)
     end
   where o.id=p_org;
  get diagnostics v_linhas=row_count;
  if v_linhas=1 then
    perform private.fn_archive_tenant_setting_alias(
      p_org,p_actor,'branding.logo_url','organizations.settings.branding.logo_path');
  end if;
  return v_linhas;
end
$f$;

-- Forward-fix da função de nome/cor aplicada. Logo canônico continua preservado.
create or replace function public.fn_definir_marca_da_organizacao(
  p_org uuid,
  p_actor uuid,
  p_marca jsonb
) returns integer
language plpgsql
volatile
security definer
set search_path='public','pg_temp'
as $f$
declare
  v_linhas integer;
  v_hex text;
  v_limpar boolean;
begin
  if p_org is null or p_actor is null then
    raise exception 'marca_da_organizacao_argumento_nulo' using errcode='22023';
  end if;
  v_limpar:=p_marca is null or jsonb_typeof(p_marca)='null';
  if not v_limpar and jsonb_typeof(p_marca)<>'object' then
    raise exception 'marca_da_organizacao_forma_invalida: %',jsonb_typeof(p_marca)
      using errcode='22023';
  end if;
  v_hex:=nullif(p_marca->>'accent_hex','');
  if v_hex is not null and v_hex !~ '^#[0-9a-f]{6}$' then
    raise exception 'marca_da_organizacao_accent_hex_invalido' using errcode='22023';
  end if;
  if not exists(
       select 1 from public.user_organizations uo
        where uo.user_id=p_actor and uo.organization_id=p_org and uo.role='admin'
          and uo.revoked_at is null)
     and not exists(
       select 1 from public.platform_admins pa
        where pa.user_id=p_actor and pa.revoked_at is null)
  then
    raise exception 'marca_da_organizacao_sem_permissao' using errcode='42501';
  end if;

  update public.organizations o
     set settings=case
       when v_limpar and coalesce(o.settings#>>'{branding,logo_path}','')=''
         then coalesce(o.settings,'{}'::jsonb)-'branding'
       when v_limpar then jsonb_set(coalesce(o.settings,'{}'::jsonb),'{branding}',
         jsonb_build_object('logo_path',o.settings#>'{branding,logo_path}'),true)
       else jsonb_set(coalesce(o.settings,'{}'::jsonb),'{branding}',
         p_marca||jsonb_strip_nulls(jsonb_build_object(
           'logo_path',o.settings#>'{branding,logo_path}')),true)
       end
   where o.id=p_org;
  get diagnostics v_linhas=row_count;
  if v_linhas=1 then
    perform private.fn_archive_tenant_setting_alias(
      p_org,p_actor,'branding.name','organizations.settings.branding.app_name');
    perform private.fn_archive_tenant_setting_alias(
      p_org,p_actor,'branding.primary_color','organizations.settings.branding.accent_hex');
  end if;
  return v_linhas;
end
$f$;

-- Substitui o update REST + read/merge/write de settings da action de
-- organização. A action mantém o mesmo formulário e gate admin; esta RPC torna
-- timezone + arquivo do alias um único commit e faz merge só da chave que esse
-- writer possui em organizations.settings.
create or replace function public.fn_update_organization_profile(
  p_org uuid,
  p_actor uuid,
  p_profile jsonb
) returns integer
language plpgsql
volatile
security definer
set search_path='public','pg_temp'
as $f$
declare
  v_linhas integer;
begin
  if p_org is null or p_actor is null or p_profile is null
     or jsonb_typeof(p_profile)<>'object' then
    raise exception 'organization_profile_invalid' using errcode='22023';
  end if;
  if not p_profile ?& array[
    'display_name','legal_name','cnpj','timezone','locale','currency',
    'media_retention_days','dpo_email','privacy_policy_url','lost_reasons_extra'
  ] or exists(
    select 1 from jsonb_object_keys(p_profile) k
     where k<>all(array[
       'display_name','legal_name','cnpj','timezone','locale','currency',
       'media_retention_days','dpo_email','privacy_policy_url','lost_reasons_extra'
     ]))
  then
    raise exception 'organization_profile_shape_invalid' using errcode='22023';
  end if;

  -- O lock torna a checagem de estado e a escrita uma decisão do mesmo
  -- snapshot; suspensão concorrente não pode confirmar entre gate e UPDATE.
  perform 1 from public.organizations o
   where o.id=p_org and o.status='active'
   for update;
  if not found then
    raise exception 'organization_profile_unavailable' using errcode='42501';
  end if;
  if length(btrim(p_profile->>'display_name')) not between 1 and 120
     or length(btrim(p_profile->>'legal_name')) not between 1 and 200
     or length(p_profile->>'timezone') not between 1 and 64
     or not exists(select 1 from pg_catalog.pg_timezone_names
                    where name=p_profile->>'timezone')
     or p_profile->>'locale' not in ('pt-BR','es')
     or p_profile->>'currency' not in ('BRL','MXN','USD')
     or (p_profile->>'media_retention_days')::integer not between 30 and 3650
     or length(coalesce(p_profile->>'cnpj',''))>20
     or length(coalesce(p_profile->>'dpo_email',''))>200
     or length(coalesce(p_profile->>'privacy_policy_url',''))>2048
     or jsonb_typeof(p_profile->'lost_reasons_extra')<>'array'
     or jsonb_array_length(p_profile->'lost_reasons_extra')>50
     or exists(
       select 1 from jsonb_array_elements(p_profile->'lost_reasons_extra') item
        where jsonb_typeof(item)<>'string'
           or length(btrim(item#>>'{}')) not between 1 and 80)
  then
    raise exception 'organization_profile_value_invalid' using errcode='22023';
  end if;
  if not exists(
       select 1 from public.user_organizations uo
        where uo.user_id=p_actor and uo.organization_id=p_org and uo.role='admin'
          and uo.accepted_at is not null and uo.revoked_at is null)
     and not exists(
       select 1 from public.platform_admins pa
        where pa.user_id=p_actor and pa.revoked_at is null)
  then
    raise exception 'organization_profile_forbidden' using errcode='42501';
  end if;

  update public.organizations o set
    display_name=btrim(p_profile->>'display_name'),
    legal_name=btrim(p_profile->>'legal_name'),
    cnpj=nullif(p_profile->>'cnpj',''),
    timezone=p_profile->>'timezone',
    locale=p_profile->>'locale',
    currency=p_profile->>'currency',
    media_retention_days=(p_profile->>'media_retention_days')::integer,
    dpo_email=nullif(p_profile->>'dpo_email',''),
    privacy_policy_url=nullif(p_profile->>'privacy_policy_url',''),
    settings=jsonb_set(coalesce(o.settings,'{}'::jsonb),'{lost_reasons_extra}',
                       p_profile->'lost_reasons_extra',true)
  where o.id=p_org;
  get diagnostics v_linhas=row_count;
  if v_linhas=1 then
    perform private.fn_archive_tenant_setting_alias(
      p_org,p_actor,'business.timezone','organizations.timezone');
  end if;
  return v_linhas;
end
$f$;

comment on function public.fn_definir_logo_da_organizacao(uuid,uuid,text) is
  'Grava logo_path canônico e arquiva branding.logo_url na mesma transação quando a organização existe.';
comment on function public.fn_definir_marca_da_organizacao(uuid,uuid,jsonb) is
  'Grava nome/cor canônicos preservando logo_path e arquiva os aliases correspondentes na mesma transação.';
comment on function public.fn_update_organization_profile(uuid,uuid,jsonb) is
  'Atualiza o perfil canônico da organização e arquiva business.timezone na mesma transação.';

revoke execute on function public.fn_definir_logo_da_organizacao(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.fn_definir_logo_da_organizacao(uuid,uuid,text) to service_role;
revoke execute on function public.fn_definir_marca_da_organizacao(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.fn_definir_marca_da_organizacao(uuid,uuid,jsonb) to service_role;
revoke execute on function public.fn_update_organization_profile(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.fn_update_organization_profile(uuid,uuid,jsonb) to service_role;

notify pgrst,'reload schema';
