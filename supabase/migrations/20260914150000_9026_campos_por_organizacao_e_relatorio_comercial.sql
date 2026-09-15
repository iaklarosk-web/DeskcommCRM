-- F13-T01/T05 — campos configuráveis por organização nas EMPRESAS e o relatório
-- comercial da organização (ADR-034 §2 T01 e T05).
-- Timestamp criado à mão na sequência da 9025; arquivo aplicado é imutável.
--
-- ─── O que este arquivo acrescenta ──────────────────────────────────────────
--
-- 1. `crm_companies.custom_fields jsonb` (objeto, default `{}`): o VALOR dos
--    campos configuráveis da empresa-cliente. A DEFINIÇÃO mora em
--    `tenant_settings` (`crm.fields.companies`, D21) e o validador único é
--    `src/crm/campos/validar.ts`. `contacts.custom_fields` e
--    `crm_leads.custom_fields` já existem com o mesmo contrato (objeto). A RLS
--    de `crm_companies` (9005) cobre a coluna nova — não há tabela nova.
--
-- 2. `fn_crm_report(p_org, p_from, p_to)`: o relatório comercial em UMA
--    função `stable`, `security invoker` (a RLS das tabelas de origem vale
--    para quem chama), sem juízo de valor — só contagens, somas em `_cents` e
--    denominadores. Cada indicador é recalculado por SQL independente pela
--    suíte de integração (`report_indicators=K/K`, ADR-035 §2): é o que faz
--    "indicador confere com a origem" ser prova, não promessa.
--    - `funnel[]`: por etapa não arquivada, oportunidades ABERTAS e soma de
--      `value_cents` (estado atual, não período).
--    - `closed`: ganhas/perdidas e valor no período por `closed_at`.
--    - `by_owner[]`: por dono humano, abertas (estado atual) e ganhas/perdidas
--      no período.
--    - `queue_size`: oportunidades abertas sem dono (a fila de F13-T03).
--    - `tasks`: abertas (estado atual), vencidas (abertas com `due_date` no
--      passado), concluídas no período por `updated_at`.
--    - `orders[]`: pedidos por estado criados no período (`crm_orders`,
--      ADR-012 — só leitura; o contrato do pedido não muda).
--
-- Par obrigatório (D08): este arquivo + apêndice byte-fiel no baseline, ANTES
-- do bloco da varredura de anon. Prova: tests/integration/f13-crm-comercial.test.ts
-- (relatório × origem) e tests/invariants/f13-t01-campos-da-empresa.test.ts (coluna e CHECK).

alter table public.crm_companies
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

do $f13_t01_check$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.crm_companies'::regclass
       and conname = 'crm_companies_custom_fields_object'
  ) then
    alter table public.crm_companies
      add constraint crm_companies_custom_fields_object
      check (jsonb_typeof(custom_fields) = 'object');
  end if;
end
$f13_t01_check$;

comment on column public.crm_companies.custom_fields is
  'F13-T01: valores dos campos configuráveis da empresa; definição em tenant_settings (crm.fields.companies); validador único em src/crm/campos/validar.ts.';

create or replace function public.fn_crm_report(p_org uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'funnel', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'pipeline_id', s.pipeline_id,
          'stage_id', s.id,
          'stage_name', s.name,
          'position', s.position,
          'open', coalesce(l.cnt, 0),
          'value_cents', coalesce(l.valor, 0)
        ) order by s.pipeline_id, s.position, s.name
      )
      from public.crm_stages s
      left join (
        select stage_id, count(*) as cnt, coalesce(sum(value_cents), 0) as valor
          from public.crm_leads
         where organization_id = p_org and status = 'open'
         group by stage_id
      ) l on l.stage_id = s.id
      where s.organization_id = p_org and s.is_archived = false
    ), '[]'::jsonb),
    'closed', (
      select jsonb_build_object(
        'won', count(*) filter (where status = 'won'),
        'won_value_cents', coalesce(sum(value_cents) filter (where status = 'won'), 0),
        'lost', count(*) filter (where status = 'lost'),
        'lost_value_cents', coalesce(sum(value_cents) filter (where status = 'lost'), 0)
      )
      from public.crm_leads
      where organization_id = p_org
        and status in ('won', 'lost')
        and closed_at >= p_from and closed_at < p_to
    ),
    'by_owner', coalesce((
      select jsonb_agg(
        jsonb_build_object('user_id', d.user_id, 'open', d.abertas, 'won', d.ganhas, 'lost', d.perdidas)
        order by d.user_id
      )
      from (
        select owner_user_id as user_id,
               count(*) filter (where status = 'open') as abertas,
               count(*) filter (where status = 'won' and closed_at >= p_from and closed_at < p_to) as ganhas,
               count(*) filter (where status = 'lost' and closed_at >= p_from and closed_at < p_to) as perdidas
          from public.crm_leads
         where organization_id = p_org and owner_user_id is not null
         group by owner_user_id
      ) d
    ), '[]'::jsonb),
    'queue_size', (
      select count(*)
        from public.crm_leads
       where organization_id = p_org and status = 'open'
         and owner_user_id is null and owner_agent_id is null
    ),
    'tasks', (
      select jsonb_build_object(
        'open', count(*) filter (where status in ('pending', 'in_progress')),
        'overdue', count(*) filter (where status in ('pending', 'in_progress') and due_date < now()),
        'done', count(*) filter (where status = 'done' and updated_at >= p_from and updated_at < p_to)
      )
      from public.crm_tasks
      where organization_id = p_org
    ),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object('status', o.status, 'count', o.n, 'total_cents', o.total) order by o.status)
      from (
        select status, count(*) as n, coalesce(sum(total_cents), 0) as total
          from public.crm_orders
         where organization_id = p_org
           and created_at >= p_from and created_at < p_to
         group by status
      ) o
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.fn_crm_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.fn_crm_report(uuid, timestamptz, timestamptz) to authenticated, service_role;

do $f13_t01_fim$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'crm_companies' and column_name = 'custom_fields'
  ) then
    raise exception 'crm_companies.custom_fields não existe';
  end if;
  if not exists (select 1 from pg_proc where proname = 'fn_crm_report' and pronamespace = 'public'::regnamespace) then
    raise exception 'fn_crm_report não existe';
  end if;
end
$f13_t01_fim$;

notify pgrst, 'reload schema';
