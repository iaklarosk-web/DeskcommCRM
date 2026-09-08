-- 0219 — channel_accounts + webhook_quarantine (F01-T02, DIRETRIZ §5.1/§5.7).
--
-- channel_accounts: o mapa (provider, account_key) → organization_id que o
-- fromWebhook consulta ANTES de existir tenant. Nasce mínima de propósito: a
-- adaptação de whatsapp_connections para cá é da F03-T03; esta migration só dá
-- ao TenantContext a tabela que o contrato de §5.1 nomeia.
--
-- webhook_quarantine: evento de webhook cujo account_key não casa com nenhuma
-- conta NÃO é descartado nem processado — fica aqui, com o motivo, para que
-- "webhook desconhecido" seja um dado investigável e não um 404 no log.
--
-- Par obrigatório (D08): este arquivo + apêndice idempotente no baseline.sql.

create table if not exists public.channel_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  account_key text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_accounts_provider_conhecido
    check (provider in ('waha', 'meta_cloud', 'mock')),
  constraint channel_accounts_status_conhecido
    check (status in ('active', 'disabled'))
);

comment on table public.channel_accounts is
  'Mapa (provider, account_key) -> organization_id do TenantContext (§5.1). fromWebhook resolve o tenant AQUI, nunca do payload. F03-T03 adapta whatsapp_connections para esta tabela.';

-- Dedup ANTES do índice único (doutrina de migrations §8): tabela nova, mas o
-- update.sh pode reaplicar sobre estado intermediário.
delete from public.channel_accounts a
  using public.channel_accounts b
 where a.provider = b.provider
   and a.account_key = b.account_key
   and a.created_at < b.created_at;

create unique index if not exists channel_accounts_provider_account_uk
  on public.channel_accounts (provider, account_key);
create index if not exists channel_accounts_org_idx
  on public.channel_accounts (organization_id);

alter table public.channel_accounts enable row level security;

-- Leitura para membros da organização (idioma fn_user_org_ids das policies
-- herdadas); escrita só por service role até a F03 decidir a UI.
drop policy if exists channel_accounts_select on public.channel_accounts;
create policy channel_accounts_select on public.channel_accounts
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));

-- Revoke/grant explícito no fim (G-54): anon nunca enxerga contas de canal.
revoke all on public.channel_accounts from anon;
revoke all on public.channel_accounts from authenticated;
grant select on public.channel_accounts to authenticated;
grant all on public.channel_accounts to service_role;

create table if not exists public.webhook_quarantine (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  account_key text not null,
  payload jsonb,
  reason text not null,
  received_at timestamptz not null default now()
);

comment on table public.webhook_quarantine is
  'Webhook sem match em channel_accounts (§5.1 invariante 3): 1 linha aqui, 0 em messages, resposta 202. Sem organization_id de propósito — o tenant é exatamente o que não se conseguiu resolver. Server-side only: RLS ligada sem policies e grants revogados de anon/authenticated (service_only, D35).';

create index if not exists webhook_quarantine_received_idx
  on public.webhook_quarantine (received_at);

alter table public.webhook_quarantine enable row level security;

revoke all on public.webhook_quarantine from anon;
revoke all on public.webhook_quarantine from authenticated;
grant all on public.webhook_quarantine to service_role;

-- Verificação (doutrina: migration termina lendo o que afirmou).
do $$
declare
  faltam text;
begin
  select string_agg(t, ', ') into faltam
  from unnest(array['channel_accounts', 'webhook_quarantine']) as t
  where not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = t and rowsecurity
  );
  if faltam is not null then
    raise exception 'RLS desligada ou tabela ausente: %', faltam;
  end if;
end
$$;
