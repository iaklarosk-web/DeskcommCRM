-- F04-T03/T08 — o livro-razão vira PROJEÇÃO da chamada, e o acervo é da
-- organização (§5.3, §5.10, D14/D36; ADR-021 decisões 3 e 4; ADR-023).
-- Arquivo aplicado é imutável.
--
-- ─── 1 · Por que `ai_usage_events` ganha `llm_call_id` ─────────────────────
--
-- Até aqui havia DUAS contabilidades sem vínculo: `llm_calls`, escrita dentro de
-- `runModelCall` e lida pelo orçamento (`ai_budgets`), e `ai_usage_events`
-- (F01-T08), que não tinha chamador de produção nenhum. Ligar `withEntitlement`
-- POR FORA do seam faria a mesma chamada virar duas cobranças, com duas fórmulas
-- de preço, e deixaria o orçamento cego à segunda.
--
-- A F04 fecha o contrário: `runModelCall` continua o único lugar que fala com o
-- provedor e grava as DUAS linhas no mesmo statement. `ai_usage_events` passa a
-- ser a PROJEÇÃO multi-tenant de `llm_calls`, e `llm_call_id` é o que torna isso
-- verificável — sem a coluna, "uma linha por chamada" seria uma contagem que
-- bate por acaso, e ninguém conseguiria dizer QUAL uso corresponde a QUAL
-- chamada.
--
-- O índice único (parcial, porque `recordUsage` direto continua legítimo e não
-- tem chamada associada) é o que faz dupla contagem virar ERRO 23505 em vez de
-- número inflado. Uma prova comportamental pode ser burlada por quem escreve o
-- código; uma constraint, não.
--
-- ─── 2 · Por que `estimated_cost_cents` deixa de ser `int` ─────────────────
--
-- `llm_calls.cost_cents` é `numeric` de propósito: 1 token de gpt-4o-mini custa
-- 0,000015 cent, e a soma do mês é o que importa. Projetar isso em `int` fazia a
-- projeção divergir da fonte em até meio cent POR CHAMADA, sempre para baixo — e
-- a prova de "o custo das duas linhas confere" só passaria por arredondar
-- também a fonte, isto é, por deixar de medir. `numeric` guarda o mesmo número.
--
-- Alargamento puro: todo `int` cabe em `numeric`, a coluna continua `not null`
-- com default 0, e nenhuma linha existente muda de valor.
--
-- ─── 3 · O acervo da organização (F04-T03) ────────────────────────────────
--
-- §5.10 quer acervo da ORGANIZAÇÃO; o RAG herdado era por AGENTE. MEDIDO neste
-- baseline: a migration 0181 JÁ tornou `ai_knowledge_sources.agent_id` anulável
-- e JÁ removeu o índice `(agent_id, source_type) where is_active`
-- (`supabase/baseline.sql`, apêndice 0181). O `NOT NULL` que ainda se lê no
-- corpo do `pg_dump` é estado ANTIGO, corrigido pelo apêndice mais adiante no
-- mesmo arquivo.
--
-- Então aqui não há mudança de forma a fazer: há uma PRECONDIÇÃO a garantir e a
-- declarar. Os dois `alter`/`drop` abaixo são no-ops num banco em dia e curam um
-- clone que tenha parado no meio; o bloco final RECUSA a migration se a
-- precondição não valer, em vez de deixar o acervo por organização nascer sobre
-- um schema que não o suporta. Nenhuma tabela nova (ADR-023): `ai_chunks` e
-- `ai_knowledge_sources` continuam sendo as tabelas, e o filtro de
-- `organization_id` de `fn_buscar_trechos_das_fontes` não muda — ele já é a
-- garantia de isolamento e tem prova comportamental.
--
-- Par obrigatório (D08): este arquivo + apêndice byte-fiel no baseline, ANTES do
-- bloco da varredura de anon, que é o último.

-- ---------------------------------------------------------------------------
-- 1 · ai_usage_events — projeção verificável de llm_calls
-- ---------------------------------------------------------------------------

alter table public.ai_usage_events
  alter column estimated_cost_cents type numeric using estimated_cost_cents::numeric;

alter table public.ai_usage_events
  alter column estimated_cost_cents set default 0;

alter table public.ai_usage_events
  add column if not exists llm_call_id uuid;

alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_llm_call_id_fkey;
alter table public.ai_usage_events
  add constraint ai_usage_events_llm_call_id_fkey
  foreign key (llm_call_id) references public.llm_calls(id) on delete cascade;

-- Dedup ANTES do índice único (doutrina de migrations §8): hoje a coluna acabou
-- de nascer e isto casa zero linhas, mas escrever mesmo assim é o que impede que
-- uma re-aplicação sobre estado intermediário (coluna criada, índice não, alguma
-- escrita no meio) derrube a migration e deixe o schema pela metade. Mantém a
-- linha mais ANTIGA de cada chamada.
delete from public.ai_usage_events a
 using public.ai_usage_events b
 where a.llm_call_id is not null
   and a.llm_call_id = b.llm_call_id
   and (a.created_at, a.id) > (b.created_at, b.id);

create unique index if not exists ai_usage_events_uma_por_chamada
  on public.ai_usage_events (llm_call_id)
  where llm_call_id is not null;

-- "Quanto esta conversa custou" sem varrer o mês inteiro do tenant.
create index if not exists ai_usage_events_org_conversa_idx
  on public.ai_usage_events (organization_id, conversation_id)
  where conversation_id is not null;

comment on column public.ai_usage_events.llm_call_id is
  'A linha de llm_calls que ORIGINOU este uso (F04-T08). Preenchida por runModelCall, que grava as duas no mesmo statement; NULL só para uso registrado direto por recordUsage (embedding, resumo sem seam). O índice único parcial faz dupla contagem da mesma chamada ser 23505, não número inflado.';
comment on column public.ai_usage_events.estimated_cost_cents is
  'Cents de USD, FRACIONÁRIOS desde a 9018 — a mesma grandeza de llm_calls.cost_cents. Calculado localmente por lib/agent-engine/edge/llm/pricing.ts (fonte de preço ÚNICA desde a F04-T08), nunca lido do provedor. Modelo sem preço = 0 com a linha presente: zero silencioso seria mentira, zero auditável não é.';

-- ---------------------------------------------------------------------------
-- 2 · Acervo da organização — precondição garantida, não recriada
-- ---------------------------------------------------------------------------

drop index if exists public.ai_knowledge_sources_unique_per_agent;

alter table public.ai_knowledge_sources
  alter column agent_id drop not null;

comment on column public.ai_knowledge_sources.agent_id is
  'HISTÓRICO: o agente a partir do qual a fonte foi criada. NÃO é dono — desde a 0181 quem lê o quê é `ai_agent_versions.knowledge_source_ids`, e desde a F04-T03 NULO significa acervo da ORGANIZAÇÃO inteira (§5.10). Nullable e ON DELETE SET NULL de propósito.';

-- ---------------------------------------------------------------------------
-- 3 · Rodapé de privilégios (G-54)
-- ---------------------------------------------------------------------------
--
-- `ai_usage_events` é service_only (D35) desde a 9004 e continua sendo: a coluna
-- nova não muda quem lê. `ai_knowledge_sources` mantém as policies de tenant e o
-- revoke de anon do baseline — reafirmado aqui, não alterado.

revoke all on public.ai_usage_events from public,anon,authenticated;
grant all on public.ai_usage_events to service_role;

revoke all on table public.ai_knowledge_sources from anon;

-- ---------------------------------------------------------------------------
-- 4 · A migration termina lendo o que afirmou
-- ---------------------------------------------------------------------------

do $f04_t03_t08_fim$
declare
  v_tipo text;
  v_policies integer;
  v_anon integer;
  v_auth integer;
  v_service integer;
begin
  -- 1. A projeção é verificável e não pode duplicar.
  select data_type into v_tipo from information_schema.columns
   where table_schema = 'public' and table_name = 'ai_usage_events'
     and column_name = 'estimated_cost_cents';
  if v_tipo is distinct from 'numeric' then
    raise exception 'ai_usage_events.estimated_cost_cents ficou % — a projeção não bate com llm_calls.cost_cents (numeric)', coalesce(v_tipo, 'ausente');
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'ai_usage_events'
       and column_name = 'llm_call_id'
  ) then
    raise exception '9018 não criou ai_usage_events.llm_call_id';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.ai_usage_events'::regclass
       and conname = 'ai_usage_events_llm_call_id_fkey'
       and contype = 'f' and convalidated
  ) then
    raise exception 'ai_usage_events.llm_call_id sem FK validada para llm_calls — projeção sem origem conferível';
  end if;

  if not exists (
    select 1 from pg_indexes where schemaname = 'public'
      and tablename = 'ai_usage_events' and indexname = 'ai_usage_events_uma_por_chamada'
  ) then
    raise exception '9018 não instalou ai_usage_events_uma_por_chamada — dupla contagem voltaria a ser silenciosa';
  end if;

  -- 2. service_only (D35) intacto: a coluna nova não abriu a tabela.
  select count(*) into v_policies from pg_policies
   where schemaname = 'public' and tablename = 'ai_usage_events';
  if v_policies <> 0 then
    raise exception 'ai_usage_events ganhou % policy(ies) — o desenho é deny-all por grant', v_policies;
  end if;

  select count(*) into v_anon from pg_class c,
    aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
   where c.oid = 'public.ai_usage_events'::regclass and a.grantee = 'anon'::regrole;
  select count(*) into v_auth from pg_class c,
    aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
   where c.oid = 'public.ai_usage_events'::regclass and a.grantee = 'authenticated'::regrole;
  if v_anon <> 0 or v_auth <> 0 then
    raise exception 'ai_usage_events exposta: anon=% authenticated=% privilégio(s)', v_anon, v_auth;
  end if;

  select count(*) into v_service from pg_class c,
    aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
   where c.oid = 'public.ai_usage_events'::regclass and a.grantee = 'service_role'::regrole;
  if v_service = 0 then
    raise exception 'ai_usage_events sem privilégio para service_role — runModelCall não gravaria nela';
  end if;

  -- 3. A precondição do acervo da organização.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'ai_knowledge_sources'
       and column_name = 'agent_id' and is_nullable = 'NO'
  ) then
    raise exception 'ai_knowledge_sources.agent_id continua NOT NULL — acervo da organização (§5.10) não caberia no schema';
  end if;

  if exists (
    select 1 from pg_indexes where schemaname = 'public'
      and tablename = 'ai_knowledge_sources'
      and indexname = 'ai_knowledge_sources_unique_per_agent'
  ) then
    raise exception 'ai_knowledge_sources_unique_per_agent ainda existe — com agent_id nulo ele deixa de recortar o que prometia';
  end if;

  -- 4. ADAPTAR e não recriar: as tabelas herdadas continuam sendo as tabelas
  -- (ADR-023). Se alguém as substituir por um par novo, esta migration reprova
  -- em vez de a busca passar a ler um acervo vazio em silêncio.
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'ai_chunks'
  ) then
    raise exception 'ai_chunks sumiu — §5.10 ADAPTA o RAG herdado, não o recria';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'fn_buscar_trechos_das_fontes'
  ) then
    raise exception 'fn_buscar_trechos_das_fontes sumiu — é ela que filtra por organização';
  end if;
end
$f04_t03_t08_fim$;

notify pgrst,'reload schema';
