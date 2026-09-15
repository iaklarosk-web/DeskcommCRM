#!/usr/bin/env bash
# scripts/staging/seed-users.sh — usuários FICTÍCIOS com senha para o staging (F06-T06/T07).
#
# Os seeds criam `auth.users` sem senha (create-tenant.ts insere só id, email e
# nome). Para o smoke logar por tenant, cada usuário abaixo recebe a senha de
# `STAGING_SMOKE_PASSWORD` (bcrypt via pgcrypto, o mesmo hash que o GoTrue
# usa), `aud`/`role`/`instance_id` do GoTrue e e-mail confirmado. O tenant deka
# não tem usuário real (TODO-DEKA, D48/D11): ganha um admin fictício de
# staging, `admin@deka.staging.test`, que NÃO existe no seed versionado.
#
# Uso: seed-users.sh [slug ...]  (padrão: deka demo2). A F07 (ADR-029 §3/§4)
# passa o slug do tenant efêmero. Para cada slug: senha a todo membro do
# tenant, `onboarded_at` preenchido onde estiver nulo (o loader antigo não o
# gravava; sem ele o tenant cai em /onboarding), sessão de canal mock.
#
# Idempotente: rodar de novo só reatualiza a senha. Nenhum valor é impresso.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL obrigatório}"
: "${STAGING_SMOKE_PASSWORD:?STAGING_SMOKE_PASSWORD obrigatório}"
SLUGS="${*:-deka demo2}"
for slug in $SLUGS; do
  [[ "$slug" =~ ^[a-z0-9-]+$ ]] || { echo "slug inválido: $slug" >&2; exit 2; }
done
SLUGS_SQL=$(printf "'%s'," $SLUGS); SLUGS_SQL="${SLUGS_SQL%,}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -v senha="$STAGING_SMOKE_PASSWORD" -v slugs="$SLUGS_SQL" <<'SQL'
-- admin fictício do deka (só staging)
with org as (select id from public.organizations where slug = 'deka'),
     u as (
       insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
       select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              'admin@deka.staging.test', '{"full_name":"Admin Deka (staging)"}'::jsonb, '{"provider":"email","providers":["email"]}'::jsonb
       where not exists (select 1 from auth.users where email = 'admin@deka.staging.test')
       returning id
     )
insert into public.user_organizations (user_id, organization_id, role, accepted_at)
select coalesce((select id from u), (select id from auth.users where email = 'admin@deka.staging.test')), org.id, 'admin', now()
  from org
on conflict do nothing;

-- F11-T01 (ADR-030 §1): o DONO da plataforma no staging — `platform_admin`
-- FICTÍCIO `owner@platform.staging.test`, sem MFA, com a senha do smoke. Não é
-- o item 7 de D12 (o `platform_admin` de produção é do proprietário); existe
-- para o painel /admin, o acompanhamento e a cobrança serem percorridos no
-- staging. Idempotente: segunda execução não cria nada.
with u as (
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'owner@platform.staging.test', '{"full_name":"Dono da plataforma (staging)"}'::jsonb, '{"provider":"email","providers":["email"]}'::jsonb
  where not exists (select 1 from auth.users where email = 'owner@platform.staging.test')
  returning id
)
insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason)
select coalesce((select id from u), (select id from auth.users where email = 'owner@platform.staging.test')),
       coalesce((select id from u), (select id from auth.users where email = 'owner@platform.staging.test')),
       'full', false, 'F11-T01: dono fictício do staging (não é o platform_admin de produção, D12 item 7)'
where not exists (select 1 from public.platform_admins p join auth.users a on a.id = p.user_id where a.email = 'owner@platform.staging.test');

-- O seed é o onboarding de um tenant provisionado (ADR-029 §3): tenants
-- criados pelo loader antigo ficaram com `onboarded_at` nulo e caíam em
-- /onboarding no navegador (o smoke, só por API, não via).
update public.organizations
   set onboarded_at = now()
 where slug in (:slugs) and onboarded_at is null;

-- senha + campos do GoTrue para todo membro dos tenants pedidos
update auth.users u
   set encrypted_password = extensions.crypt(:'senha', extensions.gen_salt('bf')),
       email_confirmed_at = coalesce(email_confirmed_at, now()),
       instance_id = coalesce(instance_id, '00000000-0000-0000-0000-000000000000'),
       aud = coalesce(aud, 'authenticated'),
       role = coalesce(role, 'authenticated'),
       raw_app_meta_data = coalesce(raw_app_meta_data, '{"provider":"email","providers":["email"]}'::jsonb),
       -- O GoTrue lê estas colunas como string e não aceita NULL ("converting
       -- NULL to string is unsupported", medido no primeiro login do staging):
       -- usuário inserido por SQL precisa delas vazias, não nulas.
       confirmation_token = coalesce(confirmation_token, ''),
       recovery_token = coalesce(recovery_token, ''),
       email_change = coalesce(email_change, ''),
       email_change_token_new = coalesce(email_change_token_new, ''),
       email_change_token_current = coalesce(email_change_token_current, ''),
       phone_change = coalesce(phone_change, ''),
       phone_change_token = coalesce(phone_change_token, ''),
       reauthentication_token = coalesce(reauthentication_token, ''),
       created_at = coalesce(created_at, now()),
       updated_at = now()
 where u.id in (select uo.user_id from public.user_organizations uo
                  join public.organizations o on o.id = uo.organization_id
                 where o.slug in (:slugs))
    or u.email = 'owner@platform.staging.test';

select count(*) as usuarios_com_senha from auth.users u
 where u.id in (select uo.user_id from public.user_organizations uo
                  join public.organizations o on o.id = uo.organization_id
                 where o.slug in (:slugs))
   and u.encrypted_password is not null;

-- Sessão de canal FICTÍCIA por tenant, ligada à conta mock do seed: sem
-- `channel_session_id` o webhook responde `sem_sessao_de_canal` (503) e o
-- smoke não teria o que medir. O segredo cifrado é um byte nulo — o canal
-- mock assina com WHATSAPP_MOCK_HMAC_SECRET, não com esta coluna.
insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
select gen_random_uuid(), o.id, 'staging-' || o.slug, '\x00'::bytea
  from public.organizations o
 where o.slug in (:slugs)
   and not exists (select 1 from public.channel_sessions s where s.organization_id = o.id and s.waha_session_name = 'staging-' || o.slug);

update public.channel_accounts ca
   set channel_session_id = s.id
  from public.organizations o
  join public.channel_sessions s on s.organization_id = o.id and s.waha_session_name = 'staging-' || o.slug
 where ca.organization_id = o.id and ca.provider = 'mock' and ca.channel_session_id is null;

select count(*) as contas_mock_com_sessao from public.channel_accounts where provider = 'mock' and channel_session_id is not null;

-- O remetente do webhook do smoke é o CLIENTE DO SEED (ADR-029 §3: o loader
-- grava `customers[]`, telefone incluído). Antes da F07 o contorno era dar o
-- telefone do seed ao contato fictício "Alfa" da F02; o contorno é desfeito
-- aqui para o telefone voltar a ser do cliente do seed (índice único por
-- organização e telefone). A linha volta à forma da fixture (`updated_at` =
-- `created_at`, sem o `waha_chat_id` que a mensagem do smoke da F06 gravou):
-- o escritor de fixtures confere a linha byte a byte no rerun do up.sh.
update public.contacts c
   set phone_number = null, source_metadata = '{}'::jsonb, updated_at = c.created_at
  from public.organizations o
 where c.organization_id = o.id and o.slug = 'demo2'
   and c.display_name = 'Contato Fictício Alfa'
   and (c.phone_number = '+5500000000102' or c.source_metadata ? 'waha_chat_id' or c.updated_at <> c.created_at);

-- Usuário-sentinela que o loader ANTIGO gravava a partir de `email: TODO-…`
-- (ADR-029 §3: pendência não é usuário). Só existe em staging criado antes
-- da F07; apagar a membership e o auth.users não toca pessoa nenhuma.
delete from public.user_organizations uo
 using auth.users u
 where u.id = uo.user_id and u.email like 'TODO-%';
delete from auth.users where email like 'TODO-%';
SQL
