-- F15-T00 — idempotência das execuções de regra de automação NO BANCO
-- (ADR-036 §2 T00, objeção 2 do contraponto).
-- Timestamp criado à mão na sequência da 9026; arquivo aplicado é imutável.
--
-- ─── O que este arquivo acrescenta ──────────────────────────────────────────
--
-- `automation_rule_runs` guardava a execução de cada (regra, evento) só com
-- índices comuns (`idx_automation_rule_runs_org_created`,
-- `idx_automation_rule_runs_rule`): dois drains concorrentes do `event_log`
-- podiam executar a MESMA regra para o MESMO evento duas vezes — e uma regra
-- que envia `send_message` enviaria em dobro para o cliente. A idempotência
-- que o motor tinha era do laço em memória, não do banco.
--
-- Índice ÚNICO parcial `(rule_id, event_id) where event_id is not null and
-- status <> 'adiado'`: a segunda run FINAL de um par é recusada pelo Postgres
-- (G-57: a prova redespacha o mesmo evento e confere `duplicate_runs=0`).
-- Ficam fora do índice: `event_id` nulo (runs manuais/de teste, `on delete set
-- null`) e as linhas `adiado` (0175) — o adiamento pela janela grava uma linha
-- de espera ANTES da execução e o mesmo evento volta depois; as duas convivem.
--
-- Nenhuma tabela nova, nenhuma policy nova: a RLS de `automation_rules`/
-- `automation_rule_runs` herdada continua. Grants explícitos ao fim (G-54).
--
-- Par obrigatório (D08): este arquivo + apêndice byte-fiel no baseline, ANTES
-- do bloco da varredura de anon. Prova: tests/invariants/f15-t00-idempotencia-das-runs.test.ts
-- (segunda inserção do par recusada; par com event_id nulo aceito duas vezes).

do $f15_t00_dedup$
begin
  -- Linhas duplicadas anteriores ao índice (nenhuma pode existir numa
  -- instalação desta base; a guarda é para um kit herdado com histórico):
  -- mantém a mais antiga de cada par.
  delete from public.automation_rule_runs r
   using public.automation_rule_runs mais_antiga
   where r.rule_id = mais_antiga.rule_id
     and r.event_id is not null
     and r.event_id = mais_antiga.event_id
     and r.status <> 'adiado'
     and mais_antiga.status <> 'adiado'
     and r.created_at > mais_antiga.created_at;
end
$f15_t00_dedup$;

create unique index if not exists uniq_automation_rule_runs_rule_event
  on public.automation_rule_runs (rule_id, event_id)
  where event_id is not null and status <> 'adiado';

comment on index public.uniq_automation_rule_runs_rule_event is
  'F15-T00: uma execução por (regra, evento) — repetição segura do motor de regras no banco (ADR-036).';

-- Grants explícitos (G-54): a tabela é da organização (RLS herdada); nada muda,
-- só fica dito.
revoke all on table public.automation_rule_runs from anon;
grant select, insert, update, delete on table public.automation_rule_runs to authenticated, service_role;

do $f15_t00_fim$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'automation_rule_runs'
       and indexname = 'uniq_automation_rule_runs_rule_event'
  ) then
    raise exception 'uniq_automation_rule_runs_rule_event não existe';
  end if;
end
$f15_t00_fim$;

notify pgrst, 'reload schema';
