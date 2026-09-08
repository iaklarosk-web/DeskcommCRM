-- 0221 — tenant_settings (F01-T05, DIRETRIZ §5.2, D21).
--
-- A configuração POR TENANT com schema versionado: uma linha por (org, chave),
-- valor jsonb validado pelo schema de src/tenant-config/schema.ts — que é o
-- ÚNICO leitor/escritor da tabela (invariante 4 de §5.2). `source` grava quem
-- pôs o valor (seed | tenant_admin | template) porque a regra de merge da
-- Fase 2 já está fixada: template não sobrescreve o que o tenant_admin mexeu.
-- `organizations.settings` (jsonb herdado) continua lido só por
-- compatibilidade até os 6 escritores herdados passarem a chamar setSetting
-- (F02-T08/F04-T10).
--
-- Par obrigatório (D08): este arquivo + apêndice idempotente no baseline.sql.

create table if not exists public.tenant_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  value jsonb not null,
  schema_version int not null default 1,
  source text not null default 'seed',
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (organization_id, key),
  constraint tenant_settings_source_conhecida
    check (source in ('seed', 'tenant_admin', 'template'))
);

comment on table public.tenant_settings is
  'Settings por tenant (§5.2, D21). Só src/tenant-config lê e escreve (invariante 4); chave fora do schema.ts é UnknownSettingError, nunca linha aqui. source guarda a origem para a regra de merge (template não sobrescreve tenant_admin).';

alter table public.tenant_settings enable row level security;

-- Leitura para membros da organização (idioma herdado; o predicado novo
-- current_organization_id() cobre o caminho service/GUC quando as policies
-- migrarem — ver target-state §Decisões da F01-T03). Escrita só por service
-- role via setSetting.
drop policy if exists tenant_settings_select on public.tenant_settings;
create policy tenant_settings_select on public.tenant_settings
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));

revoke all on public.tenant_settings from anon;
revoke all on public.tenant_settings from authenticated;
grant select on public.tenant_settings to authenticated;
grant all on public.tenant_settings to service_role;

-- Verificação (G-24).
do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public'
                  and tablename = 'tenant_settings' and rowsecurity) then
    raise exception 'tenant_settings ausente ou sem RLS';
  end if;
end
$$;
