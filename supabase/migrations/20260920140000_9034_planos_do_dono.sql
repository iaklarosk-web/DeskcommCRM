-- 9034 — F19-T06 (ADR-044 §2; D14 fechado por D58 b em 20/09/2026): o nome e o
-- preço REAIS dos planos.
--
-- POR QUÊ. A 9023 criou PLAN_A/B/C como placeholder (name = code,
-- price_cents = 0, source = 'placeholder') porque preço e nome eram decisão
-- do proprietário (D14). Ele decidiu: Essencial R$ 197, Profissional R$ 597,
-- Empresarial R$ 1.497 por mês, em BRL. Com o Stripe LIVE na produção, o
-- Price que o Checkout cobra nasce desta linha (`stripe:provision` lê os
-- planos `owner` do banco — ADR-044 §3): as duas verdades de preço da ADR-042
-- viram uma.
--
-- O QUE MUDA. Três UPDATEs, cada um só onde a linha AINDA é placeholder: a
-- reaplicação (apêndice do baseline pelo update.sh) nunca sobrescreve um
-- valor que o dono mude depois pela via própria — decisão futura vem por
-- migration nova. Limites (`limits`), moeda, período e `active` não mudam.
-- Nenhuma tabela nova; RLS service_only da 9023 mantida e reconferida por
-- tests/invariants/f19-t06-planos-do-dono.test.ts. Aditiva e idempotente.
begin;

update public.plans set name = 'Essencial',    price_cents = 19700,  source = 'owner' where code = 'PLAN_A' and source = 'placeholder';
update public.plans set name = 'Profissional', price_cents = 59700,  source = 'owner' where code = 'PLAN_B' and source = 'placeholder';
update public.plans set name = 'Empresarial',  price_cents = 149700, source = 'owner' where code = 'PLAN_C' and source = 'placeholder';

-- A migration termina lendo o que afirmou: três planos do dono com preço > 0,
-- nenhum placeholder entre os três códigos.
do $f19_t06_fim$
declare
  v_owner integer;
  v_placeholder integer;
begin
  select count(*) into v_owner from public.plans
    where code in ('PLAN_A', 'PLAN_B', 'PLAN_C') and source = 'owner' and price_cents > 0 and currency = 'BRL';
  select count(*) into v_placeholder from public.plans
    where code in ('PLAN_A', 'PLAN_B', 'PLAN_C') and source = 'placeholder';
  if v_owner <> 3 or v_placeholder <> 0 then
    raise exception '9034: esperava 3 planos owner com preço e 0 placeholder, achou owner=% placeholder=%', v_owner, v_placeholder;
  end if;
end
$f19_t06_fim$;

commit;
