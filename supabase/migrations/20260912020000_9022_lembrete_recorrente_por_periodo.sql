-- F05-T06/T07/T08 — o lembrete recorrente PJ ganha REGISTRO por período
-- (§5.12, D23; §5.6 `tags`; §5.13 job_runs; D35).
-- Timestamp criado à mão na sequência da 9021; arquivo aplicado é imutável.
--
-- ─── O que nasce aqui ──────────────────────────────────────────────────────
--
-- 1. `reminder_runs(organization_id, customer_id, period_key, …)` com ÚNICO em
--    `(organization_id, customer_id, period_key)` — é o índice, e não um
--    `select` antes do `insert`, que faz "o job rodou duas vezes no mesmo
--    período" virar UMA mensagem (§5.12 invariante 1; G-57). Uma linha por
--    cliente por período: quando foi enviado, até quando se espera resposta
--    (`cutoff_at`, gravado no envio e não recalculado — mudar a Setting depois
--    não move o prazo do que já saiu), quando o cliente respondeu e se foi
--    depois do corte, quando o sem-resposta foi avisado, e o que aconteceu com a
--    tarefa do corte.
--
-- 2. `conversations.saas_tags text[]` — o `tags` de §5.6, com vocabulário
--    fechado: na Fase 1 só `awaiting_quantity`. É a marca que o turno da IA lê
--    para saber que a mensagem do cliente responde a um lembrete (§5.12).
--    Coluna NOVA e não o `tags` herdado de `contacts`: aquele é do contato e
--    livre; este é da CONVERSA e enum.
--
-- 3. `job_queue.kind` aceita `recurring_reminder` e `recurring_reminder_cutoff`
--    por ADIÇÃO, com a mesma dança da 9016: a constraint é reconstruída SEM
--    estreitar — se algum valor herdado estivesse fora da lista nova, a
--    migration reprova em vez de recusar linhas antigas. É o que faz cada
--    disparo por tenant virar uma linha em `job_queue` + `job_runs` (§5.13,
--    "um job run por tenant"), sem fila nova.
--
-- ─── Por que `task_id` PODE ficar nulo e existe `task_denied_code` ─────────
--
-- §5.12 manda o corte chamar `create_task` (executor `automation`). O domínio
-- da F02 recusa executor não-humano (`authorizeCrmCommand`), e abrir a escrita
-- do CRM a automação é decisão do proprietário (VARREDURA-MELHORIAS §B5/§C6),
-- não desta migration. Então o corte TENTA pelo catálogo, e o que o catálogo
-- responder fica gravado: `task_id` quando criou; `task_denied_code` com a
-- etiqueta da recusa quando não. Nada é maquiado de verde.
--
-- Par obrigatório (D08): este arquivo + apêndice byte-fiel no baseline, ANTES
-- do bloco da varredura de anon, que é o último.

-- ---------------------------------------------------------------------------
-- 1 · reminder_runs — uma linha por (tenant, cliente, período)
-- ---------------------------------------------------------------------------

create table if not exists public.reminder_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  period_key text not null,
  conversation_id uuid references public.conversations(id) on delete set null,
  sent_message_id uuid references public.messages(id) on delete set null,
  sent_at timestamptz,
  cutoff_at timestamptz,
  skipped_reason text,
  replied_at timestamptz,
  replied_message_id uuid references public.messages(id) on delete set null,
  replied_late boolean not null default false,
  no_reply_notified_at timestamptz,
  task_id uuid,
  task_denied_code text,
  concluded_at timestamptz,
  concluded_as text,
  created_at timestamptz not null default now(),
  -- `period_key` é semana ISO (`2026-W37`), e só isso: a chave de idempotência
  -- de D23 é `(tenant, customer, período)`, e um período em formato livre
  -- deixaria a mesma semana entrar duas vezes com duas grafias.
  constraint reminder_runs_period_key_check check (period_key ~ '^[0-9]{4}-W[0-5][0-9]$'),
  -- Enviado ⇔ tem mensagem, hora e corte. Sem isto caberia linha "enviada" sem
  -- prazo, e o corte nunca a alcançaria.
  constraint reminder_runs_envio_coerente check (
    (sent_message_id is null) = (sent_at is null)
    and (sent_at is null) = (cutoff_at is null)
  ),
  -- Ou saiu, ou foi pulada com motivo — nunca as duas coisas, nunca nenhuma
  -- depois de concluída.
  constraint reminder_runs_pulo_coerente check (
    skipped_reason is null or sent_message_id is null
  ),
  constraint reminder_runs_skipped_reason_check check (skipped_reason is null or skipped_reason in (
    'conversation_busy','channel_account_missing','contact_without_phone','send_denied'
  )),
  -- Respondido ⇔ tem quando e qual mensagem. `replied_late` só faz sentido
  -- com resposta.
  constraint reminder_runs_resposta_coerente check (
    (replied_at is null) = (replied_message_id is null)
    and (replied_late = false or replied_at is not null)
  ),
  -- Tarefa criada OU recusa registrada — nunca as duas.
  constraint reminder_runs_tarefa_coerente check (task_id is null or task_denied_code is null),
  constraint reminder_runs_conclusao_coerente check (
    (concluded_at is null) = (concluded_as is null)
    and (concluded_as is null or concluded_as in (
      'order_updated','order_created','handoff_late_reply','handoff','no_action'
    ))
  )
);

-- Dedup ANTES do índice único (doutrina de migrations §8): hoje casa zero
-- linhas; escrever mesmo assim é o que impede uma re-aplicação sobre estado
-- intermediário de derrubar a migration. Mantém a linha mais ANTIGA.
delete from public.reminder_runs a
 using public.reminder_runs b
 where a.organization_id = b.organization_id
   and a.customer_id = b.customer_id
   and a.period_key = b.period_key
   and (a.created_at, a.id) > (b.created_at, b.id);

-- A CHAVE de D23: um lembrete por cliente por período. É ela que responde
-- `duplicates=0` no VERIFY SUMMARY.
create unique index if not exists reminder_runs_um_por_periodo
  on public.reminder_runs (organization_id, customer_id, period_key);

-- "O que ainda espera resposta e já passou do corte" — a consulta do job de corte.
create index if not exists reminder_runs_corte_pendente_idx
  on public.reminder_runs (organization_id, cutoff_at)
  where sent_message_id is not null and replied_at is null and no_reply_notified_at is null;

-- "O lembrete desta conversa" — a leitura do turno da IA e da entrada.
create index if not exists reminder_runs_org_conversa_idx
  on public.reminder_runs (organization_id, conversation_id, created_at desc)
  where conversation_id is not null;

do $f05_t06_fk$ begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.reminder_runs'::regclass
                    and conname = 'reminder_runs_customer_tenant_fkey') then
    alter table public.reminder_runs
      add constraint reminder_runs_customer_tenant_fkey
      foreign key (organization_id, customer_id)
      references public.contacts(organization_id, id) on delete cascade;
  end if;
end $f05_t06_fk$;

alter table public.reminder_runs enable row level security;

comment on table public.reminder_runs is
  'Um lembrete recorrente PJ por (tenant, cliente, período ISO) — §5.12/D23. O índice único é a idempotência: o job rodado duas vezes no mesmo período grava UMA linha e manda UMA mensagem. Guarda quando saiu, até quando se espera resposta (cutoff_at, fixado no envio), quando o cliente respondeu e se foi tarde, quando o sem-resposta foi avisado e o que aconteceu com a tarefa do corte. service_only (D35).';
comment on column public.reminder_runs.cutoff_at is
  'sent_at + orders.recurring_reminder.cutoff_hours NO INSTANTE do envio. Coluna e não cálculo: mudar a Setting depois não move o prazo do que já saiu. Resposta depois disto é replied_late=true e vai para avaliação humana (§7.6 T08), nunca para o pedido automaticamente.';
comment on column public.reminder_runs.task_id is
  'A tarefa que o corte criou por create_task (executor automation), quando o domínio aceitou. NULL com task_denied_code preenchido = o catálogo recusou (hoje: non_human_executor_denied — VARREDURA §B5/§C6, decisão do proprietário). Nunca maquiado.';
comment on column public.reminder_runs.skipped_reason is
  'Por que o lembrete NÃO saiu para este cliente neste período, em etiqueta (G-78): conversa ocupada (estado fora de nenhuma/resolved/waiting_customer, §5.6), sem conta de canal, sem telefone, envio recusado pelo catálogo.';

-- ---------------------------------------------------------------------------
-- 2 · conversations.saas_tags — o `tags` de §5.6, com vocabulário fechado
-- ---------------------------------------------------------------------------

alter table public.conversations
  add column if not exists saas_tags text[] not null default '{}'::text[];

do $f05_t06_tags$ begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.conversations'::regclass
                    and conname = 'conversations_saas_tags_check') then
    alter table public.conversations
      add constraint conversations_saas_tags_check
      check (saas_tags <@ array['awaiting_quantity']::text[]);
  end if;
end $f05_t06_tags$;

comment on column public.conversations.saas_tags is
  'O `tags` de §5.6 (D16): só recebe valores do enum {awaiting_quantity} na Fase 1. awaiting_quantity = a conversa espera a resposta do cliente a um lembrete de pedido (§5.12); é a marca que o turno da IA lê para chamar update_order_quantity. Escrita só por src/conversation e src/reminder.';

-- ---------------------------------------------------------------------------
-- 3 · job_queue.kind aceita os dois kinds do lembrete (sem perder os herdados)
-- ---------------------------------------------------------------------------

do $f05_t06_kind$
declare
  v_nome text;
  v_perdidos text;
begin
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
                     'approved_reply','outbound_message',
                     'recurring_reminder','recurring_reminder_cutoff');
    if v_perdidos is not null then
      raise exception
        'F05-T06 ia ESTREITAR job_queue.kind: valor(es) herdado(s) fora da lista nova: %',
        v_perdidos;
    end if;
    execute format('alter table public.job_queue drop constraint %I', v_nome);
  end if;
end
$f05_t06_kind$;

alter table public.job_queue add constraint job_queue_kind_check
  check (kind in ('inbound_turn','followup_turn','watchdog','flywheel',
                  'case_reply_turn','operator_turn','transactional_delivery',
                  'approved_reply','outbound_message',
                  'recurring_reminder','recurring_reminder_cutoff'));

comment on constraint job_queue_kind_check on public.job_queue is
  'Vocabulário de kind. recurring_reminder / recurring_reminder_cutoff (F05-T06/T08) são o disparo por tenant do lembrete PJ (§5.12) e o seu corte — uma linha por tenant por disparo, com a tentativa em job_runs (§5.13). contact_id NULO nos dois: endereçam o TENANT, não uma pessoa.';

-- ---------------------------------------------------------------------------
-- 4 · Rodapé de privilégios (G-54)
-- ---------------------------------------------------------------------------

revoke all on public.reminder_runs from public,anon,authenticated,service_role;
grant all on public.reminder_runs to service_role;

-- ---------------------------------------------------------------------------
-- 5 · A migration termina lendo o que afirmou
-- ---------------------------------------------------------------------------

do $f05_t06_fim$
declare
  v_policies integer;
  v_anon integer;
  v_auth integer;
  v_public integer;
  v_service integer;
  v_kind text;
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'reminder_runs') then
    raise exception 'F05-T06 não criou public.reminder_runs';
  end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'reminder_runs' and not rowsecurity) then
    raise exception 'F05-T06 criou reminder_runs sem RLS';
  end if;
  select count(*) into v_policies from pg_policies where schemaname = 'public' and tablename = 'reminder_runs';
  if v_policies <> 0 then
    raise exception 'reminder_runs é service_only (D35) e apareceu com % policy(ies)', v_policies;
  end if;
  select count(*) into v_anon from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
   where c.oid = 'public.reminder_runs'::regclass and a.grantee = 'anon'::regrole;
  select count(*) into v_auth from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
   where c.oid = 'public.reminder_runs'::regclass and a.grantee = 'authenticated'::regrole;
  select count(*) into v_public from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
   where c.oid = 'public.reminder_runs'::regclass and a.grantee = 0;
  if v_anon <> 0 or v_auth <> 0 or v_public <> 0 then
    raise exception 'reminder_runs exposta: anon=% authenticated=% PUBLIC=% privilégio(s)', v_anon, v_auth, v_public;
  end if;
  select count(*) into v_service from pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
   where c.oid = 'public.reminder_runs'::regclass and a.grantee = 'service_role'::regrole;
  if v_service = 0 then
    raise exception 'reminder_runs sem privilégio para service_role — o job não escreveria nela';
  end if;

  -- As FKs validadas: organização, cliente (composta, por tenant), conversa e
  -- as duas mensagens. Uma linha órfã de cliente de OUTRO tenant é exatamente
  -- o que a FK composta impede.
  if (select count(*) from pg_constraint
       where conrelid = 'public.reminder_runs'::regclass and contype = 'f' and convalidated) < 5 then
    raise exception 'reminder_runs sem as cinco FKs validadas';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'reminder_runs'
                  and indexname = 'reminder_runs_um_por_periodo') then
    raise exception 'F05-T06 não instalou reminder_runs_um_por_periodo — a idempotência de D23 voltaria a ser boa vontade';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'reminder_runs'
                  and indexname = 'reminder_runs_corte_pendente_idx') then
    raise exception 'F05-T06 não instalou reminder_runs_corte_pendente_idx';
  end if;
  foreach v_kind in array array['reminder_runs_period_key_check','reminder_runs_envio_coerente',
                                'reminder_runs_resposta_coerente','reminder_runs_tarefa_coerente',
                                'reminder_runs_conclusao_coerente','reminder_runs_pulo_coerente'] loop
    if not exists (select 1 from pg_constraint where conrelid = 'public.reminder_runs'::regclass and conname = v_kind) then
      raise exception 'reminder_runs sem a constraint %', v_kind;
    end if;
  end loop;

  -- A coluna de tags, com o vocabulário fechado.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'conversations' and column_name = 'saas_tags') then
    raise exception 'F05-T06 não criou conversations.saas_tags';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.conversations'::regclass
                  and conname = 'conversations_saas_tags_check'
                  and pg_get_constraintdef(oid) like '%awaiting_quantity%') then
    raise exception 'conversations.saas_tags sem o CHECK de vocabulário {awaiting_quantity}';
  end if;

  -- Os dois kinds novos, um a um, contra o CHECK de verdade — e os herdados.
  foreach v_kind in array array['recurring_reminder','recurring_reminder_cutoff','outbound_message','inbound_turn','watchdog'] loop
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.job_queue'::regclass and conname = 'job_queue_kind_check'
                      and pg_get_constraintdef(oid) like '%''' || v_kind || '''%') then
      raise exception 'job_queue_kind_check não aceita o kind %', v_kind;
    end if;
  end loop;

  -- O que o lembrete REUSA continua de pé: a fila de saída (9016), o mock
  -- (9014), o catálogo de ações (D17) e a upsert herdada de conversa.
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'job_runs') then
    raise exception 'job_runs sumiu — é onde o disparo por tenant registra a tentativa (§5.13)';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'mock_outbox') then
    raise exception 'mock_outbox sumiu — é onde a prova conta N mensagens para N clientes (§5.12 inv. 4)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'fn_upsert_wa_conversation') then
    raise exception 'fn_upsert_wa_conversation sumiu — é ela que "cria a conversa se não existir" (§5.6)';
  end if;
end
$f05_t06_fim$;

notify pgrst,'reload schema';
