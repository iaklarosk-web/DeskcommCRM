-- F03-T07/T08 — a fila de SAÍDA sobre `job_queue` (ADR-017 decisão 5, §5.13).
-- Timestamp criado pelo Supabase CLI; arquivo aplicado é imutável.
--
-- ─── Por que `job_queue` e não uma fila nova ────────────────────────────────
--
-- §5.13 nomeia `job_queue` como O Job, e ela já tem claim `FOR UPDATE SKIP
-- LOCKED`, `attempts`, `max_attempts`, `run_after` e `last_error`. Uma fila só
-- para saída duplicaria claim, backoff e observabilidade (ADR-017, alternativa
-- rejeitada) e deixaria duas verdades sobre "o que está pendente".
--
-- ─── ADIÇÃO, nunca substituição ────────────────────────────────────────────
--
-- O `kind` ganha `outbound_message` e o `status` ganha `blocked`. Os valores
-- herdados PERMANECEM — inclusive `dead`, que é o terminal do motor herdado e
-- não é sinônimo de `blocked`: `dead` é "a fila desistiu"; `blocked` é "parou e
-- chamou gente" (G-15). Nenhum job existente muda de classe.
--
-- Os dois blocos `do` abaixo leem a definição ATUAL do catálogo e reprovam a
-- migration ANTES do `drop` se algum valor herdado fosse sumir. Escrever a
-- lista nova sem essa conferência é como se perde vocabulário em silêncio:
-- numa base que já tenha `approved_reply` gravado, a constraint estreitada
-- derruba a re-aplicação (`is violated by some row`) e a tabela fica sem
-- constraint entre o `drop` e o `add`.
--
-- ─── A CHECK de coerência `kind ⇔ contact_id` NÃO muda ─────────────────────
--
-- `job_queue_turn_needs_contact` diz que só os kinds de TURNO têm contato. Um
-- job `outbound_message` tem `contact_id` NULO — ele endereça uma CONVERSA e uma
-- MENSAGEM, que viajam no `payload` (`conversation_id`, `message_id`) — então o
-- lado esquerdo é falso, o direito é falso, e a igualdade vale sem uma linha
-- alterada. Pôr `outbound_message` naquela lista exigiria contato e amarraria a
-- saída ao lado de entrada do motor herdado (lane única por contato,
-- `uniq_job_queue_one_running_per_contact`), serializando envios que não têm
-- motivo para esperar uns pelos outros.
--
-- ─── Idempotência do envio é de ÍNDICE ─────────────────────────────────────
--
-- `job_queue_outbound_message_uk` recusa o segundo job para a mesma mensagem.
-- Provar "não enfileira duas vezes" em TypeScript provaria o dublê: entre o
-- `select` e o `insert` cabe a segunda chamada, e essa janela é justamente o
-- caso que a idempotência existe para cobrir.

-- ---------------------------------------------------------------------------
-- 1 · job_queue.kind aceita `outbound_message` (sem perder os herdados)
-- ---------------------------------------------------------------------------

do $f03_t07_kind$
declare
  v_nome text;
  v_perdidos text;
begin
  -- O nome é procurado no CATÁLOGO e não escrito à mão: em bases antigas a
  -- constraint de vocabulário nasceu anônima (`job_queue_check`) e só depois
  -- ganhou nome (`job_queue_kind_check`). A busca exclui a de coerência, que
  -- também cita os kinds mas fala de `contact_id`.
  select conname into v_nome
    from pg_constraint
   where conrelid = 'public.job_queue'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%watchdog%'
     and pg_get_constraintdef(oid) not ilike '%contact_id%';

  if v_nome is not null then
    select string_agg(distinct k, ', ') into v_perdidos
      from (
        select unnest(regexp_matches(
                 pg_get_constraintdef(oid), '''([a-z_]+)''', 'g')) as k
          from pg_constraint
         where conrelid = 'public.job_queue'::regclass and conname = v_nome
      ) atual
     where k not in ('inbound_turn','followup_turn','watchdog','flywheel',
                     'case_reply_turn','operator_turn','transactional_delivery',
                     'approved_reply','outbound_message');
    if v_perdidos is not null then
      raise exception
        'F03-T07 ia ESTREITAR job_queue.kind: valor(es) herdado(s) fora da lista nova: %',
        v_perdidos;
    end if;
    execute format('alter table public.job_queue drop constraint %I', v_nome);
  end if;
end
$f03_t07_kind$;

alter table public.job_queue add constraint job_queue_kind_check
  check (kind in ('inbound_turn','followup_turn','watchdog','flywheel',
                  'case_reply_turn','operator_turn','transactional_delivery',
                  'approved_reply','outbound_message'));

-- ---------------------------------------------------------------------------
-- 2 · job_queue.status aceita `blocked` (sem perder `dead`)
-- ---------------------------------------------------------------------------

do $f03_t07_status$
declare
  v_nome text;
  v_perdidos text;
begin
  select conname into v_nome
    from pg_constraint
   where conrelid = 'public.job_queue'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%''dead''%';

  if v_nome is not null then
    select string_agg(distinct k, ', ') into v_perdidos
      from (
        select unnest(regexp_matches(
                 pg_get_constraintdef(oid), '''([a-z_]+)''', 'g')) as k
          from pg_constraint
         where conrelid = 'public.job_queue'::regclass and conname = v_nome
      ) atual
     where k not in ('pending','running','done','failed','dead','blocked');
    if v_perdidos is not null then
      raise exception
        'F03-T07 ia ESTREITAR job_queue.status: valor(es) herdado(s) fora da lista nova: %',
        v_perdidos;
    end if;
    execute format('alter table public.job_queue drop constraint %I', v_nome);
  end if;
end
$f03_t07_status$;

alter table public.job_queue add constraint job_queue_status_check
  check (status in ('pending','running','done','failed','dead','blocked'));

comment on column public.job_queue.status is
  'pending|running|done|failed|dead|blocked. `blocked` (F03-T07) é a terceira falha do retry N=3: o job PARA e um humano é avisado (agent_inbox_items kind=job_dead). `dead` continua sendo o terminal do motor herdado e não é sinônimo — a fila desistiu sozinha.';

-- Dedup ANTES do índice único (doutrina de migrations §8). Hoje o kind é novo e
-- isto casa zero linhas; escrever mesmo assim é o que impede que uma
-- re-aplicação sobre estado intermediário (CHECK ampliado, índice não) derrube
-- a migration no meio e deixe o schema pela metade.
delete from public.job_queue a
 using public.job_queue b
 where a.kind = 'outbound_message' and b.kind = 'outbound_message'
   and a.organization_id = b.organization_id
   and a.payload->>'message_id' = b.payload->>'message_id'
   and a.payload->>'message_id' is not null
   and (a.created_at, a.id) > (b.created_at, b.id);

create unique index if not exists job_queue_outbound_message_uk
  on public.job_queue (organization_id, (payload->>'message_id'))
  where kind = 'outbound_message' and payload->>'message_id' is not null;

comment on index public.job_queue_outbound_message_uk is
  'Idempotência da fila de saída (§5.13): a mesma mensagem não gera segundo job. Parcial em kind=outbound_message para não tocar em nenhuma linha do motor herdado.';

-- ---------------------------------------------------------------------------
-- 3 · job_runs — uma linha por TENTATIVA
-- ---------------------------------------------------------------------------
--
-- `error` é NORMALIZADO e truncado no código (src/jobs/erros.ts), como o
-- comment de `job_queue.last_error` já manda: NUNCA conteúdo de mensagem. O
-- corpo do cliente não entra em registro de execução — quem lê `job_runs` é
-- operação, e operação não pediu o texto de ninguém.
--
-- `service_only` (D35): RLS ligada, ZERO policies, nada para anon/authenticated.
-- É registro de runtime, não dado de usuário — e um registro que o navegador lê
-- é um registro que o navegador pode escrever.

create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.job_queue(id) on delete cascade,
  attempt smallint not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text check (outcome in ('ok','erro')),
  error text
);

-- Dedup ANTES do índice único: numa base que já tivesse a tabela sem o índice,
-- `create unique index` falharia no meio da migration. Mantém a linha mais
-- ANTIGA de cada par — é a da tentativa que realmente rodou primeiro.
delete from public.job_runs a
 using public.job_runs b
 where a.organization_id = b.organization_id
   and a.job_id = b.job_id
   and a.attempt = b.attempt
   and (a.started_at, a.id) > (b.started_at, b.id);

create unique index if not exists job_runs_org_job_attempt_unique
  on public.job_runs (organization_id, job_id, attempt);

create index if not exists job_runs_org_started_idx
  on public.job_runs (organization_id, started_at desc);

alter table public.job_runs enable row level security;

comment on table public.job_runs is
  'Uma linha por TENTATIVA de job (§5.13, F03-T07). service_only: RLS ligada, zero policies, só service_role. Única por (organization_id, job_id, attempt).';
comment on column public.job_runs.error is
  'Erro NORMALIZADO e truncado pelo código (src/jobs/erros.ts) — nunca conteúdo de mensagem (PII), mesma regra do comment de job_queue.last_error.';
comment on column public.job_runs.outcome is
  'ok|erro, e NULL enquanto a tentativa corre. Dois valores porque o desfecho da FILA (blocked, dead) é de job_queue.status: repeti-lo aqui criaria duas verdades para o mesmo fato.';

-- ---------------------------------------------------------------------------
-- 4 · Rodapé de privilégios (G-54)
-- ---------------------------------------------------------------------------
--
-- ⚠️ `public.job_queue` NÃO aparece abaixo, e a ausência é deliberada: é tabela
-- herdada com RLS e policies em uso pelo motor inteiro, e um `revoke all` aqui
-- derrubaria o worker herdado. Ampliar CHECK e acrescentar índice não muda quem
-- pode lê-la.

revoke all on public.job_runs from public,anon,authenticated,service_role;
grant all on public.job_runs to service_role;

-- ---------------------------------------------------------------------------
-- 5 · A migration termina lendo o que afirmou
-- ---------------------------------------------------------------------------
--
-- Releitura do catálogo DEPOIS do revoke/grant: antes dele a checagem de
-- privilégio mediria o estado que a própria migration ainda ia corrigir (num
-- projeto Supabase o `alter default privileges … to anon` faz toda tabela nova
-- nascer exposta).

do $f03_t07_fim$
declare
  v_policies integer;
  v_anon integer;
  v_auth integer;
  v_service integer;
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.job_queue'::regclass and conname = 'job_queue_kind_check'
       and pg_get_constraintdef(oid) ilike '%outbound_message%'
  ) then
    raise exception 'F03-T07 não acrescentou outbound_message ao CHECK de job_queue.kind';
  end if;

  -- Os herdados continuam de pé. `dead` é citado por nome porque é o valor que
  -- uma leitura apressada da task ("status novo") trocaria por `blocked`.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.job_queue'::regclass and conname = 'job_queue_status_check'
       and pg_get_constraintdef(oid) ilike '%blocked%'
       and pg_get_constraintdef(oid) ilike '%dead%'
  ) then
    raise exception 'F03-T07 não deixou job_queue.status com blocked E dead';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.job_queue'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%contact_id is not null%'
  ) then
    raise exception 'F03-T07 removeu a CHECK de coerência kind/contact_id de job_queue';
  end if;

  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and tablename = 'job_queue'
      and indexname = 'job_queue_outbound_message_uk'
  ) then
    raise exception 'F03-T08 não instalou job_queue_outbound_message_uk';
  end if;

  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'job_runs'
  ) then
    raise exception 'F03-T07 não criou public.job_runs';
  end if;
  if exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'job_runs'
      and not rowsecurity
  ) then
    raise exception 'F03-T07 criou job_runs sem RLS';
  end if;
  select count(*) into v_policies from pg_policies
   where schemaname = 'public' and tablename = 'job_runs';
  if v_policies <> 0 then
    raise exception 'job_runs é service_only (D35) e apareceu com % policy(ies)', v_policies;
  end if;
  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and tablename = 'job_runs'
      and indexname = 'job_runs_org_job_attempt_unique'
  ) then
    raise exception 'F03-T07 não instalou job_runs_org_job_attempt_unique';
  end if;
  if (select count(*) from pg_constraint
       where conrelid = 'public.job_runs'::regclass and contype = 'f' and convalidated) < 2 then
    raise exception 'job_runs sem as duas FKs validadas (organizations e job_queue)';
  end if;

  select count(*) into v_anon from pg_class c,
    aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
   where c.oid = 'public.job_runs'::regclass and a.grantee = 'anon'::regrole;
  select count(*) into v_auth from pg_class c,
    aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
   where c.oid = 'public.job_runs'::regclass and a.grantee = 'authenticated'::regrole;
  if v_anon <> 0 or v_auth <> 0 then
    raise exception 'job_runs exposta: anon=% authenticated=% privilégio(s)', v_anon, v_auth;
  end if;
  select count(*) into v_service from pg_class c,
    aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
   where c.oid = 'public.job_runs'::regclass and a.grantee = 'service_role'::regrole;
  if v_service = 0 then
    raise exception 'job_runs sem privilégio para service_role — o worker não registraria tentativa';
  end if;
end
$f03_t07_fim$;

notify pgrst,'reload schema';
