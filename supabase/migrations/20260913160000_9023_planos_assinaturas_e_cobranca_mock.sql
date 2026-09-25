-- F12-T01 — planos, assinaturas, eventos de cobrança e faturas (§5.3/D14,
-- D38, D44, ADR-030 §3; D35). Gateway MOCK; planos PLACEHOLDER.
-- Timestamp criado à mão na sequência da 9022; arquivo aplicado é imutável.
--
-- ─── O que nasce aqui ──────────────────────────────────────────────────────
--
-- 1. `plans` — catálogo GLOBAL (sem `organization_id`): `PLAN_A/B/C` com
--    `name = code`, `price_cents = 0` e `source = 'placeholder'`. Preço, nome e
--    limites reais são do proprietário (D14, D51); os limites placeholder
--    existem para que o caminho "limite atingido" seja exercitado, e a tela
--    do dono os mostra como placeholder. `service_only`: o servidor lê.
--
-- 2. `subscriptions` — UMA por organização (índice único). Estados fechados
--    (`pending_payment`, `active`, `past_due`, `blocked`, `cancelled`) com
--    CHECKs de coerência: `past_due` exige `failed_at` e `grace_until`;
--    `blocked` exige `blocked_at`; `cancelled` exige `cancelled_at`; `active`
--    exige o período. `origin` diz de onde a assinatura veio (cadastro,
--    operador, seed, fixture, backfill) — nunca é inferido depois.
--
-- 3. `billing_events` — o que o gateway mandou, com `(gateway, event_ref)`
--    ÚNICO: a segunda entrega do mesmo evento é recusada pelo Postgres, não por
--    um `select` antes (G-57). `applied` + `ignored_reason` gravam o desfecho:
--    evento fora de ordem fica registrado e não aplicado.
--
-- 4. `invoices` — uma fatura por ciclo, `paid` só com `paid_at`; `gateway_ref`
--    único quando presente (a mesma confirmação não paga duas faturas).
--
-- 5. Três eventos de notificação novos nos CHECKs de 9021 (por ADIÇÃO, com a
--    mesma guarda da 9016/9022: se alguma linha existente estivesse fora da
--    lista nova, a migration reprova em vez de recusar linhas antigas):
--    `subscription.payment_failed`, `subscription.blocked`,
--    `subscription.activated` (§5.16, D44).
--
-- 6. Backfill DECLARADO: toda organização existente sem assinatura ganha uma
--    `active` de origem `backfill` em `PLAN_A` (30 dias a partir de agora). É o
--    que faz as organizações herdadas (deka/demo2 do staging) não caírem na
--    tela de cobrança ao subir o código; a contagem sai em `raise notice`.
--    Produção não existe (D13); se existir um dia, a origem `backfill` é o
--    marcador para o proprietário decidir (ADR-030 §3).
--
-- Par obrigatório (D08): este arquivo + apêndice byte-fiel no baseline, ANTES
-- do bloco da varredura de anon, que é o último.

-- ---------------------------------------------------------------------------
-- 1 · plans — catálogo global, placeholder até o proprietário decidir
-- ---------------------------------------------------------------------------

create table if not exists public.plans (
  code text primary key,
  name text not null,
  price_cents integer not null default 0,
  currency text not null default 'BRL',
  period_days integer not null default 30,
  limits jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  source text not null default 'placeholder',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_code_check check (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  constraint plans_price_cents_check check (price_cents >= 0),
  constraint plans_currency_iso check (currency ~ '^[A-Z]{3}$'),
  constraint plans_period_days_check check (period_days between 1 and 366),
  constraint plans_limits_objeto check (jsonb_typeof(limits) = 'object'),
  constraint plans_source_check check (source in ('placeholder', 'owner'))
);

comment on table public.plans is
  'Catálogo global de planos (D14). Até o proprietário nomear e precificar, as linhas são placeholder: name = code, price_cents = 0, source = placeholder. Limites por capability em `limits` (chave = Capability de §5.3, valor = inteiro por período; ausente = sem limite).';

drop trigger if exists plans_updated_at on public.plans;
create trigger plans_updated_at before update on public.plans
  for each row execute function public.fn_set_updated_at();

insert into public.plans (code, name, price_cents, limits, source) values
  ('PLAN_A', 'PLAN_A', 0, '{"users.invite": 3, "ai.reply": 500}'::jsonb, 'placeholder'),
  ('PLAN_B', 'PLAN_B', 0, '{"users.invite": 10, "ai.reply": 5000}'::jsonb, 'placeholder'),
  ('PLAN_C', 'PLAN_C', 0, '{}'::jsonb, 'placeholder')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2 · subscriptions — uma por organização, estados fechados
-- ---------------------------------------------------------------------------

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_code text not null references public.plans(code),
  status text not null default 'pending_payment',
  origin text not null,
  gateway text,
  gateway_ref text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  failed_at timestamptz,
  grace_until timestamptz,
  blocked_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_status_check check (status in (
    'pending_payment', 'active', 'past_due', 'blocked', 'cancelled'
  )),
  constraint subscriptions_origin_check check (origin in (
    'self_service', 'operator', 'seed', 'fixture', 'backfill'
  )),
  constraint subscriptions_gateway_check check (gateway is null or gateway in ('mock')),
  constraint subscriptions_periodo_coerente check (
    current_period_start is null or current_period_end is null or current_period_end > current_period_start
  ),
  constraint subscriptions_active_coerente check (
    status <> 'active' or (current_period_start is not null and current_period_end is not null)
  ),
  constraint subscriptions_past_due_coerente check (
    status <> 'past_due' or (failed_at is not null and grace_until is not null)
  ),
  constraint subscriptions_blocked_coerente check (status <> 'blocked' or blocked_at is not null),
  constraint subscriptions_cancelled_coerente check (status <> 'cancelled' or cancelled_at is not null),
  constraint subscriptions_cancel_reason_check check (cancel_reason is null or length(cancel_reason) between 1 and 500)
);

create unique index if not exists subscriptions_uma_por_organizacao
  on public.subscriptions (organization_id);
create index if not exists subscriptions_status_grace_idx
  on public.subscriptions (status, grace_until)
  where status = 'past_due';

comment on table public.subscriptions is
  'Assinatura de uma organização (D38/D44, ADR-030 §3). Uma por organização. Estados e transições em src/billing/estados.ts; o acesso operacional deriva do status (src/billing/acesso.ts).';

drop trigger if exists subscriptions_updated_at on public.subscriptions;
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3 · billing_events — o que o gateway mandou; referência única por gateway
-- ---------------------------------------------------------------------------

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete cascade,
  gateway text not null,
  event_ref text not null,
  event_type text not null,
  amount_cents integer,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  applied boolean not null default false,
  ignored_reason text,
  payload jsonb not null default '{}'::jsonb,
  constraint billing_events_gateway_check check (gateway in ('mock')),
  constraint billing_events_event_type_check check (event_type in ('payment_confirmed', 'payment_failed')),
  constraint billing_events_amount_check check (amount_cents is null or amount_cents >= 0),
  constraint billing_events_ignored_reason_check check (ignored_reason is null or ignored_reason in (
    'out_of_order', 'unknown_subscription', 'no_transition'
  )),
  constraint billing_events_desfecho_coerente check (not applied or ignored_reason is null),
  constraint billing_events_payload_objeto check (jsonb_typeof(payload) = 'object'),
  constraint billing_events_ref_unica unique (gateway, event_ref)
);

create index if not exists billing_events_org_ocorrido_idx
  on public.billing_events (organization_id, occurred_at desc);

comment on table public.billing_events is
  'Eventos recebidos do gateway (F12-T03). (gateway, event_ref) único: a segunda entrega do mesmo evento é recusada pelo índice — duplicata nunca vira linha nem ativação. applied=false + ignored_reason registra o evento fora de ordem ou sem assinatura.';

-- ---------------------------------------------------------------------------
-- 4 · invoices — uma fatura por ciclo
-- ---------------------------------------------------------------------------

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  plan_code text not null references public.plans(code),
  period_start timestamptz not null,
  period_end timestamptz not null,
  amount_cents integer not null,
  currency text not null default 'BRL',
  status text not null default 'open',
  due_at timestamptz not null,
  paid_at timestamptz,
  gateway_ref text,
  created_at timestamptz not null default now(),
  constraint invoices_amount_check check (amount_cents >= 0),
  constraint invoices_currency_iso check (currency ~ '^[A-Z]{3}$'),
  constraint invoices_status_check check (status in ('open', 'paid', 'failed', 'void')),
  constraint invoices_periodo check (period_end > period_start),
  constraint invoices_paga_coerente check (status <> 'paid' or paid_at is not null)
);

create unique index if not exists invoices_gateway_ref_unica
  on public.invoices (gateway_ref) where gateway_ref is not null;
create index if not exists invoices_org_periodo_idx
  on public.invoices (organization_id, period_start desc);

comment on table public.invoices is
  'Fatura por ciclo da assinatura (F12-T03/T07). paid só com paid_at; gateway_ref único quando presente — a mesma confirmação não quita duas faturas. A conciliação (src/billing/conciliacao.ts) compara faturas pagas com billing_events payment_confirmed.';

-- ---------------------------------------------------------------------------
-- 5 · Eventos de notificação da cobrança (§5.16) — por ADIÇÃO
-- ---------------------------------------------------------------------------

-- Guarda: se alguma linha existente estivesse fora da lista nova, a migration
-- reprova aqui em vez de recusar linhas antigas no `add constraint` (a lista
-- nova é superconjunto da de 9021 — tests/unit/migrations-nao-encolhem-vocabulario).
do $f12_t01_eventos$
declare
  v_tabela text;
  v_fora integer;
begin
  foreach v_tabela in array array['notifications', 'email_outbox'] loop
    execute format(
      'select count(*) from public.%I where event not in (%L,%L,%L,%L,%L,%L,%L,%L,%L)',
      v_tabela,
      'handoff.created', 'task.assigned', 'confirmation.requested',
      'customer.replied_while_human', 'reminder.no_reply', 'job.blocked',
      'subscription.payment_failed', 'subscription.blocked', 'subscription.activated'
    ) into v_fora;
    if v_fora > 0 then
      raise exception '% tem % linha(s) com evento fora da lista nova — a migration não estreita', v_tabela, v_fora;
    end if;
  end loop;
end
$f12_t01_eventos$;

alter table public.notifications drop constraint if exists notifications_event_check;
alter table public.notifications add constraint notifications_event_check
  check (event in (
    'handoff.created','task.assigned','confirmation.requested',
    'customer.replied_while_human','reminder.no_reply','job.blocked',
    'subscription.payment_failed','subscription.blocked','subscription.activated'
  ));

alter table public.email_outbox drop constraint if exists email_outbox_event_check;
alter table public.email_outbox add constraint email_outbox_event_check
  check (event in (
    'handoff.created','task.assigned','confirmation.requested',
    'customer.replied_while_human','reminder.no_reply','job.blocked',
    'subscription.payment_failed','subscription.blocked','subscription.activated'
  ));

-- ---------------------------------------------------------------------------
-- 6 · Backfill declarado — organizações que nasceram antes da cobrança
-- ---------------------------------------------------------------------------

do $f12_t01_backfill$
declare
  v_n integer;
begin
  insert into public.subscriptions
    (organization_id, plan_code, status, origin, current_period_start, current_period_end)
  select o.id, 'PLAN_A', 'active', 'backfill', now(), now() + interval '30 days'
    from public.organizations o
   where not exists (select 1 from public.subscriptions s where s.organization_id = o.id);
  get diagnostics v_n = row_count;
  raise notice 'F12-T01 backfill: subscriptions criadas para organizações sem assinatura = %', v_n;
end
$f12_t01_backfill$;

-- ---------------------------------------------------------------------------
-- 7 · Rodapé de privilégios (G-54) — as quatro são service_only (D35)
-- ---------------------------------------------------------------------------

alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_events enable row level security;
alter table public.invoices enable row level security;

revoke all on public.plans from public, anon, authenticated, service_role;
revoke all on public.subscriptions from public, anon, authenticated, service_role;
revoke all on public.billing_events from public, anon, authenticated, service_role;
revoke all on public.invoices from public, anon, authenticated, service_role;
grant all on public.plans to service_role;
grant all on public.subscriptions to service_role;
grant all on public.billing_events to service_role;
grant all on public.invoices to service_role;

-- ---------------------------------------------------------------------------
-- 8 · A migration termina lendo o que afirmou
-- ---------------------------------------------------------------------------

do $f12_t01_fim$
declare
  v_tabela text;
  v_planos integer;
  v_evento text;
begin
  foreach v_tabela in array array['plans', 'subscriptions', 'billing_events', 'invoices'] loop
    if not exists (select 1 from pg_class where oid = ('public.' || v_tabela)::regclass and relrowsecurity) then
      raise exception '% sem RLS ligada', v_tabela;
    end if;
    if exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
                where c.oid = ('public.' || v_tabela)::regclass
                  and a.grantee in ('anon'::regrole, 'authenticated'::regrole)) then
      raise exception '% com privilégio a anon/authenticated — D35 exige service_only', v_tabela;
    end if;
  end loop;
  select count(*) into v_planos from public.plans where code in ('PLAN_A', 'PLAN_B', 'PLAN_C');
  if v_planos <> 3 then
    raise exception 'plans: esperava PLAN_A/B/C (3), achou %', v_planos;
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'subscriptions_uma_por_organizacao') then
    raise exception 'subscriptions sem o índice único por organização';
  end if;
  foreach v_evento in array array['subscription.payment_failed', 'subscription.blocked', 'subscription.activated', 'job.blocked'] loop
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.notifications'::regclass and conname = 'notifications_event_check'
                      and pg_get_constraintdef(oid) like '%''' || v_evento || '''%') then
      raise exception 'notifications_event_check não aceita %', v_evento;
    end if;
  end loop;
end
$f12_t01_fim$;

notify pgrst, 'reload schema';
