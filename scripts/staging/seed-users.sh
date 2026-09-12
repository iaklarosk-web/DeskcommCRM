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
# Idempotente: rodar de novo só reatualiza a senha. Nenhum valor é impresso.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL obrigatório}"
: "${STAGING_SMOKE_PASSWORD:?STAGING_SMOKE_PASSWORD obrigatório}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -v senha="$STAGING_SMOKE_PASSWORD" <<'SQL'
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

-- senha + campos do GoTrue para todo usuário dos dois tenants
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
 where u.email in ('admin@deka.staging.test', 'admin@demo2.test', 'atende@demo2.test');

select count(*) as usuarios_com_senha from auth.users
 where email in ('admin@deka.staging.test', 'admin@demo2.test', 'atende@demo2.test') and encrypted_password is not null;

-- Sessão de canal FICTÍCIA por tenant, ligada à conta mock do seed: sem
-- `channel_session_id` o webhook responde `sem_sessao_de_canal` (503) e o
-- smoke não teria o que medir. O segredo cifrado é um byte nulo — o canal
-- mock assina com WHATSAPP_MOCK_HMAC_SECRET, não com esta coluna.
insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
select gen_random_uuid(), o.id, 'staging-' || o.slug, '\x00'::bytea
  from public.organizations o
 where o.slug in ('deka', 'demo2')
   and not exists (select 1 from public.channel_sessions s where s.organization_id = o.id and s.waha_session_name = 'staging-' || o.slug);

update public.channel_accounts ca
   set channel_session_id = s.id
  from public.organizations o
  join public.channel_sessions s on s.organization_id = o.id and s.waha_session_name = 'staging-' || o.slug
 where ca.organization_id = o.id and ca.provider = 'mock' and ca.channel_session_id is null;

select count(*) as contas_mock_com_sessao from public.channel_accounts where provider = 'mock' and channel_session_id is not null;

-- O contato fictício que o smoke usa como remetente do webhook: com telefone,
-- a mensagem de entrada se prende a ele em vez de criar contato novo a cada
-- rodada (e `customers[demo2]` continua igual à fixture). Número FICTÍCIO.
update public.contacts c
   set phone_number = '+5500000000102', updated_at = now()
  from public.organizations o
 where c.organization_id = o.id and o.slug = 'demo2'
   and c.display_name = 'Contato Fictício Alfa' and c.phone_number is null;
SQL
