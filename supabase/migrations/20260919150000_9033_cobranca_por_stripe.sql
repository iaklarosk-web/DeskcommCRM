-- 9033 — F19-T01 (ADR-042 §3; D52 b, D57): o gateway `stripe` ao lado do `mock`.
--
-- POR QUÊ. A F12 (9023) desenhou assinatura, eventos e faturas para um gateway
-- real e entregou só o mock; o vocabulário dos CHECKs ficou fechado em 'mock'.
-- Com o Stripe (D52 b) a mesma máquina de estados recebe eventos de outro
-- gateway, e três coisas que o mock nunca teve precisam de coluna: o cliente
-- do provedor (`customer_ref`, para achar a organização pelo webhook), o fim
-- do período de teste (`trial_ends_at`, D57 c) e o `livemode` do evento (o
-- receptor recusa evento live em instalação de teste, e o registro diz qual
-- era). O Portal do Stripe cancela e AVISA: `cancelled` passa a ser evento
-- que o gateway entrega, não só ação humana.
--
-- O QUE MUDA. Aditiva e idempotente: três CHECKs reconstruídos em BLOCO ÚNICO
-- drop+add (lição 26 da F14: `if not exists` não atualiza o banco que JÁ tem
-- a constraint antiga), três colunas por `add column if not exists`, um índice
-- para o webhook achar a assinatura por (gateway, gateway_ref). Nenhuma tabela
-- nova: a RLS (service_only, D35) é a da 9023 e a prova em
-- tests/invariants/f19-t01-stripe-schema.test.ts confere que continua.
begin;

-- 1 · vocabulário dos gateways: mock e stripe
alter table public.subscriptions drop constraint if exists subscriptions_gateway_check;
alter table public.subscriptions add constraint subscriptions_gateway_check
  check (gateway is null or gateway in ('mock', 'stripe'));

alter table public.billing_events drop constraint if exists billing_events_gateway_check;
alter table public.billing_events add constraint billing_events_gateway_check
  check (gateway in ('mock', 'stripe'));

-- 2 · o gateway também cancela (customer.subscription.deleted → cancelled)
alter table public.billing_events drop constraint if exists billing_events_event_type_check;
alter table public.billing_events add constraint billing_events_event_type_check
  check (event_type in ('payment_confirmed', 'payment_failed', 'cancelled'));

-- 3 · colunas do provedor real
alter table public.subscriptions add column if not exists customer_ref text;
alter table public.subscriptions add column if not exists trial_ends_at timestamptz;
alter table public.billing_events add column if not exists livemode boolean;

comment on column public.subscriptions.customer_ref is
  'Id do cliente no gateway (Stripe: cus_…). Nulo em mock/operator. É por ele e por gateway_ref que o webhook acha a organização (ADR-042 §2).';
comment on column public.subscriptions.trial_ends_at is
  'Fim do período de teste (D57 c: 7 dias no Checkout). `trialing` do Stripe mapeia para active com esta data; nulo = sem trial.';
comment on column public.billing_events.livemode is
  'O `livemode` do evento do Stripe. Nulo no mock. Evento cujo livemode não bate com STRIPE_MODE é recusado ANTES de virar linha (422).';

-- 4 · o webhook acha a assinatura pela referência do gateway
create index if not exists subscriptions_gateway_ref_idx
  on public.subscriptions (gateway, gateway_ref)
  where gateway_ref is not null;

comment on constraint billing_events_event_type_check on public.billing_events is
  'Enum de TRÊS tipos (F12 + F19): payment_confirmed, payment_failed e cancelled (o Portal do Stripe cancela e o gateway avisa). Espelho de TIPOS_DE_EVENTO_DO_GATEWAY em src/billing/estados.ts. Nunca texto livre (G-78).';

-- 5 · a migration termina lendo o que afirmou
do $f19_t01_fim$
declare
  v_nome text;
  v_def text;
begin
  foreach v_nome in array array['subscriptions_gateway_check', 'billing_events_gateway_check', 'billing_events_event_type_check'] loop
    select pg_get_constraintdef(oid) into v_def from pg_constraint where conname = v_nome;
    if v_def is null then
      raise exception '9033: constraint % não existe', v_nome;
    end if;
    if v_nome like '%gateway%' and v_def not like '%''stripe''%' then
      raise exception '9033: % não aceita stripe (%)', v_nome, v_def;
    end if;
    if v_nome = 'billing_events_event_type_check' and v_def not like '%''cancelled''%' then
      raise exception '9033: % não aceita cancelled (%)', v_nome, v_def;
    end if;
  end loop;
  if (select count(*) from information_schema.columns
        where table_schema = 'public'
          and ((table_name = 'subscriptions' and column_name in ('customer_ref', 'trial_ends_at'))
            or (table_name = 'billing_events' and column_name = 'livemode'))) <> 3 then
    raise exception '9033: faltou coluna (customer_ref, trial_ends_at, livemode)';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'subscriptions_gateway_ref_idx') then
    raise exception '9033: índice subscriptions_gateway_ref_idx ausente';
  end if;
end
$f19_t01_fim$;

commit;
