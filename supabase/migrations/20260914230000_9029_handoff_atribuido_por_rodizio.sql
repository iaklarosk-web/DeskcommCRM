-- F15-T03 — o handoff pode nascer ATRIBUÍDO (rodízio, ADR-036 §2 T03, D54 d).
-- Timestamp criado à mão na sequência da 9028; arquivo aplicado é imutável.
--
-- ─── O que este arquivo acrescenta ──────────────────────────────────────────
--
-- `handoffs.assigned_to` / `assigned_at`: em `handoff.assignment=round_robin`
-- o dossiê nasce entregue a UM membro da fila (`handoff.queue_roles`), escolhido
-- pelo rodízio puro de `lib/routing/decide.ts` (quem recebeu há mais tempo, ou
-- nunca, primeiro). `assigned_at` é o que o rodízio lê como "último atribuído"
-- por pessoa — sem tabela de estado. Em `queue` (default) as duas colunas
-- ficam nulas e a fila continua a corrida de sempre; o claim (`claimed_by`/
-- `claimed_at`) segue sendo o momento em que a pessoa ASSUME — atribuição não
-- é claim.
--
-- CHECK de coerência (as duas nulas ou as duas preenchidas), índice para o
-- "último atribuído" por pessoa. Nenhuma tabela nova, nenhuma policy nova (a
-- RLS da 9020 cobre as colunas). Grants explícitos ao fim (G-54).
--
-- Par obrigatório (D08): este arquivo + apêndice byte-fiel no baseline, ANTES
-- do bloco da varredura de anon. Prova: tests/invariants/f15-t03-handoff-atribuido.test.ts
-- (coluna, coerência, sem FK) e tests/integration/f15-automacao-e-autonomia.test.ts
-- (H handoffs por rodízio, balanced=1).

-- `assigned_to` SEM FK para auth.users, como `claimed_by` (9020): a pessoa que
-- sai da organização não apaga o histórico de quem recebeu o quê, e um
-- `on delete set null` violaria a coerência abaixo pela metade.
alter table public.handoffs
  add column if not exists assigned_to uuid,
  add column if not exists assigned_at timestamptz;

do $f15_t03_check$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.handoffs'::regclass
       and conname = 'handoffs_atribuicao_coerente'
  ) then
    alter table public.handoffs
      add constraint handoffs_atribuicao_coerente
      check ((assigned_to is null) = (assigned_at is null));
  end if;
end
$f15_t03_check$;

create index if not exists handoffs_org_atribuido_idx
  on public.handoffs (organization_id, assigned_to, assigned_at desc)
  where assigned_to is not null;

comment on column public.handoffs.assigned_to is
  'F15-T03: a quem o rodízio entregou o handoff (handoff.assignment=round_robin); nulo em queue. Atribuição não é claim.';
comment on column public.handoffs.assigned_at is
  'F15-T03: quando o rodízio entregou; é o "último atribuído" por pessoa que o rodízio lê.';

-- Grants explícitos (G-54): nada muda no que a RLS da 9020 decide.
revoke all on table public.handoffs from anon;

do $f15_t03_fim$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'handoffs' and column_name = 'assigned_to'
  ) then
    raise exception 'handoffs.assigned_to não existe';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.handoffs'::regclass and conname = 'handoffs_atribuicao_coerente'
  ) then
    raise exception 'handoffs_atribuicao_coerente não existe';
  end if;
end
$f15_t03_fim$;

notify pgrst, 'reload schema';
