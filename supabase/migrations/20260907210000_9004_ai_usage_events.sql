-- 0222 — ai_usage_events (F01-T08, DIRETRIZ §5.3, D14).
--
-- O livro-razão de uso de IA por tenant: uma linha por chamada ao provedor,
-- escrita SÓ por recordUsage (src/entitlement) dentro de withTenant. As
-- tabelas herdadas llm_calls/ai_budgets continuam lidas; esta é a única
-- ESCRITA de uso nova (target-state §5.3). custo estimado calculado
-- localmente por src/entitlement/pricing.ts, nunca lido do provedor.
--
-- service_only (D35): RLS ligada com ZERO policies e privilégio NENHUM para
-- anon/authenticated — mesmo desenho de platform_google_oauth/ad_*: quem lê é
-- o servidor. O que o tenant vê de consumo chega por tela própria (Fase 2)
-- via agregação server-side, nunca pela tabela crua no PostgREST.
--
-- Par obrigatório (D08): este arquivo + apêndice idempotente no baseline
-- (ANTES do bloco da varredura de anon, que é o último — vigiado por
-- tests/unit/varredura-anon-e-o-ultimo-bloco.test.ts).

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid,
  model text not null,
  operation text not null,
  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  estimated_cost_cents int not null default 0,
  latency_ms int,
  provider_request_id text,
  created_at timestamptz not null default now(),
  constraint ai_usage_events_operation_conhecida
    check (operation in ('chat', 'embedding', 'summary'))
);

comment on table public.ai_usage_events is
  'Uso de IA por tenant (§5.3, D14): uma linha por chamada, escrita só por recordUsage (src/entitlement) via withTenant. Custo estimado local (pricing.ts), nunca do provedor. Server-side only: RLS ligada sem policies, grants revogados de anon/authenticated (service_only, D35).';

create index if not exists ai_usage_events_org_created_idx
  on public.ai_usage_events (organization_id, created_at);

alter table public.ai_usage_events enable row level security;

revoke all on public.ai_usage_events from anon;
revoke all on public.ai_usage_events from authenticated;
grant all on public.ai_usage_events to service_role;

-- Verificação (G-24).
do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public'
                  and tablename = 'ai_usage_events' and rowsecurity) then
    raise exception 'ai_usage_events ausente ou sem RLS';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public'
              and tablename = 'ai_usage_events') then
    raise exception 'ai_usage_events ganhou policy — o desenho é deny-all por grant';
  end if;
end
$$;
