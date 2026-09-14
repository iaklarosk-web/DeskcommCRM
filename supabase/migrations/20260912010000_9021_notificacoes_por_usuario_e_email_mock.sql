-- F05-T05 — notificações por USUÁRIO e e-mail transacional em modo mock
-- (§5.16, §7.6; D12/D35; §5.2 grupo `notifications`).
-- Timestamp criado à mão na sequência da 9020; arquivo aplicado é imutável.
--
-- ─── O que nasce aqui, e o que continua onde estava ────────────────────────
--
-- §5.16 fixa a lista ÚNICA de eventos da Fase 1 — seis — e a substância do
-- aviso: "In-app sempre (`notifications(organization_id, user_id, event,
-- payload, read_at)`); e-mail se `notifications.email.enabled` (adapter com
-- mock)". Até a F04 o produto tinha só o aviso de ORGANIZAÇÃO herdado
-- (`agent_inbox_items`: `kind=handoff`, `kind=job_dead`) e o barramento
-- (`event_log`, `conversation.customer_replied_while_human`). Nenhum dos dois
-- é POR USUÁRIO — um cartão de organização não sabe quem já leu e não tem como
-- virar e-mail para uma pessoa.
--
-- `notifications` nasce AO LADO dos dois, não no lugar: o aviso herdado
-- continua aparecendo na Central e o evento continua no barramento. A linha
-- daqui é o que a PESSOA vê e marca como lida (`read_at`), e o que o adapter de
-- e-mail transforma em mensagem.
--
-- ─── `email_outbox` é o MOCK do e-mail transacional (D12) ──────────────────
--
-- Nenhum provedor real de e-mail existe nesta fase (D12: credencial é item
-- humano). O adapter `mock` grava aqui o que TERIA saído — destinatário,
-- assunto, corpo, evento — com a mesma disciplina do `mock_outbox` do canal:
-- instrumento de verificação, `service_only`, uma linha por aviso enviado. A
-- coluna `sent_at` é preenchida pelo mock no ato: "enviado" no mock significa
-- "gravado", e a prova de §7.6 (`email_outbox=6/6`) conta linhas, não entregas.
--
-- ─── Por que o evento é CHECK e não texto livre ────────────────────────────
--
-- §5.16 diz "lista única"; D19/G-78 dizem que motivo é enum, nunca frase. Um
-- evento novo é 1 valor no enum do TypeScript (`src/notifications/eventos.ts`)
-- E 1 valor neste CHECK — os dois, no mesmo commit, e o bloco final confere os
-- seis um a um contra o `pg_get_constraintdef`.
--
-- Par obrigatório (D08): este arquivo + apêndice byte-fiel no baseline, ANTES
-- do bloco da varredura de anon, que é o último.

-- ---------------------------------------------------------------------------
-- 1 · notifications — o aviso POR USUÁRIO (§5.16)
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  event text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  -- Os SEIS eventos de §5.16, e só eles (G-78).
  constraint notifications_event_check check (event in (
    'handoff.created','task.assigned','confirmation.requested',
    'customer.replied_while_human','reminder.no_reply','job.blocked'
  )),
  -- `payload` é OBJETO: um array ou um escalar passaria por `jsonb not null` e
  -- quebraria o primeiro leitor que fizesse `payload->>'conversation_id'`.
  constraint notifications_payload_objeto check (jsonb_typeof(payload) = 'object')
);

-- "O que ESTE usuário ainda não leu", do mais novo para o mais antigo — é a
-- consulta da lista in-app. Parcial em `read_at is null`: o histórico lido não
-- entra no índice que a tela consulta a cada abertura.
create index if not exists notifications_nao_lidas_idx
  on public.notifications (organization_id, user_id, created_at desc)
  where read_at is null;

-- "Quantos avisos deste evento", para a prova de §7.6 e para operação.
create index if not exists notifications_org_evento_idx
  on public.notifications (organization_id, event, created_at desc);

alter table public.notifications enable row level security;

comment on table public.notifications is
  'Aviso por USUÁRIO (§5.16): um dos seis eventos da Fase 1, o payload com os ids do fato e read_at quando a pessoa leu. Nasce AO LADO de agent_inbox_items (aviso da organização) e do event_log (barramento), que continuam. service_only (D35): RLS ligada, zero policies, só service_role — a lista in-app é servida pelo servidor, via withTenant.';
comment on column public.notifications.event is
  'Enum de SEIS valores (§5.16), nunca texto livre (G-78). Espelho em TypeScript: src/notifications/eventos.ts. Evento novo = 1 valor lá + 1 valor neste CHECK.';
comment on column public.notifications.payload is
  'Os IDS do fato (conversation_id, handoff_id, task_id, pending_action_id, job_id, reminder_run_id…) e rótulos curtos. NUNCA o corpo de mensagem do cliente: quem lê o aviso abre a conversa; o aviso não é a conversa.';
comment on column public.notifications.read_at is
  'Quando a pessoa marcou como lido. NULL = não lido. É a única coluna que a pessoa altera, e altera pelo servidor.';

-- ---------------------------------------------------------------------------
-- 2 · email_outbox — o e-mail transacional em modo MOCK (D12)
-- ---------------------------------------------------------------------------

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  notification_id uuid references public.notifications(id) on delete set null,
  user_id uuid not null,
  event text not null,
  to_email text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint email_outbox_event_check check (event in (
    'handoff.created','task.assigned','confirmation.requested',
    'customer.replied_while_human','reminder.no_reply','job.blocked'
  )),
  -- Destinatário, assunto e corpo NÃO vazios: `not null` aceita string vazia,
  -- e um e-mail sem destinatário "enviado" com sucesso é o verde vazio que a
  -- prova de §7.6 existe para reprovar.
  constraint email_outbox_campos_preenchidos check (
    char_length(btrim(to_email)) > 0
    and char_length(btrim(subject)) > 0
    and char_length(btrim(body)) > 0
  )
);

create index if not exists email_outbox_org_evento_idx
  on public.email_outbox (organization_id, event, created_at desc);

create index if not exists email_outbox_org_notificacao_idx
  on public.email_outbox (organization_id, notification_id)
  where notification_id is not null;

alter table public.email_outbox enable row level security;

comment on table public.email_outbox is
  'Caixa de saída do e-mail transacional em modo MOCK (D12, §5.16): o que TERIA saído para a pessoa quando notifications.email.enabled=true. Uma linha por aviso; sent_at preenchido pelo mock no ato. Provedor real é NOT VALIDATED (real) até credencial e autorização. service_only (D35).';
comment on column public.email_outbox.to_email is
  'O e-mail do usuário destinatário (auth.users.email) ou, quando configurado, notifications.email.to — a caixa da organização. Nunca inventado: sem endereço, não há linha.';

-- ---------------------------------------------------------------------------
-- 3 · Rodapé de privilégios (G-54)
-- ---------------------------------------------------------------------------
--
-- service_only (D35), pelo mesmo argumento de `handoffs` (9020): o aviso carrega
-- ids e rótulos da conversa de um cliente, e um registro que o navegador lê é um
-- registro que o navegador pode escrever. A lista in-app e o "marcar como lido"
-- são servidos pelo SERVIDOR, via `withTenant`. `revoke ... from service_role`
-- antes do `grant all` é deliberado: torna a linha seguinte a ÚNICA origem do
-- acesso.

revoke all on public.notifications from public,anon,authenticated,service_role;
grant all on public.notifications to service_role;

revoke all on public.email_outbox from public,anon,authenticated,service_role;
grant all on public.email_outbox to service_role;

-- ---------------------------------------------------------------------------
-- 4 · A migration termina lendo o que afirmou
-- ---------------------------------------------------------------------------

do $f05_t05_fim$
declare
  v_tabela text;
  v_policies integer;
  v_anon integer;
  v_auth integer;
  v_public integer;
  v_service integer;
  v_evento text;
  v_eventos_aceitos integer;
begin
  foreach v_tabela in array array['notifications','email_outbox'] loop
    if not exists (
      select 1 from pg_tables where schemaname = 'public' and tablename = v_tabela
    ) then
      raise exception 'F05-T05 não criou public.%', v_tabela;
    end if;
    if exists (
      select 1 from pg_tables where schemaname = 'public' and tablename = v_tabela
        and not rowsecurity
    ) then
      raise exception 'F05-T05 criou % sem RLS', v_tabela;
    end if;

    select count(*) into v_policies from pg_policies
     where schemaname = 'public' and tablename = v_tabela;
    if v_policies <> 0 then
      raise exception '% é service_only (D35) e apareceu com % policy(ies)', v_tabela, v_policies;
    end if;

    select count(*) into v_anon from pg_class c,
      aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
     where c.oid = ('public.' || v_tabela)::regclass and a.grantee = 'anon'::regrole;
    select count(*) into v_auth from pg_class c,
      aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
     where c.oid = ('public.' || v_tabela)::regclass and a.grantee = 'authenticated'::regrole;
    select count(*) into v_public from pg_class c,
      aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
     where c.oid = ('public.' || v_tabela)::regclass and a.grantee = 0;
    if v_anon <> 0 or v_auth <> 0 or v_public <> 0 then
      raise exception '% exposta: anon=% authenticated=% PUBLIC=% privilégio(s)',
        v_tabela, v_anon, v_auth, v_public;
    end if;

    select count(*) into v_service from pg_class c,
      aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
     where c.oid = ('public.' || v_tabela)::regclass and a.grantee = 'service_role'::regrole;
    if v_service = 0 then
      raise exception '% sem privilégio para service_role — o produto não escreveria nela', v_tabela;
    end if;

    -- Os SEIS eventos, um a um, contra o CHECK de verdade em CADA tabela.
    -- "A constraint existe" aprovaria uma lista com cinco.
    v_eventos_aceitos := 0;
    foreach v_evento in array array[
      'handoff.created','task.assigned','confirmation.requested',
      'customer.replied_while_human','reminder.no_reply','job.blocked'
    ] loop
      if not exists (
        select 1 from pg_constraint
         where conrelid = ('public.' || v_tabela)::regclass
           and conname = v_tabela || '_event_check'
           and pg_get_constraintdef(oid) like '%''' || v_evento || '''%'
      ) then
        raise exception '%_event_check não aceita o evento % de §5.16', v_tabela, v_evento;
      end if;
      v_eventos_aceitos := v_eventos_aceitos + 1;
    end loop;
    if v_eventos_aceitos <> 6 then
      raise exception '%_event_check cobre % eventos, e §5.16 tem 6', v_tabela, v_eventos_aceitos;
    end if;
  end loop;

  -- A FK de organização validada nas duas, e a de notificação em email_outbox.
  if (select count(*) from pg_constraint
       where conrelid = 'public.notifications'::regclass and contype = 'f' and convalidated) < 1 then
    raise exception 'notifications sem FK validada para organizations';
  end if;
  if (select count(*) from pg_constraint
       where conrelid = 'public.email_outbox'::regclass and contype = 'f' and convalidated) < 2 then
    raise exception 'email_outbox sem as duas FKs validadas (organizations e notifications)';
  end if;

  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and tablename = 'notifications'
      and indexname = 'notifications_nao_lidas_idx'
  ) then
    raise exception 'F05-T05 não instalou notifications_nao_lidas_idx — a lista in-app varreria o histórico';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.notifications'::regclass and conname = 'notifications_payload_objeto'
  ) then
    raise exception 'notifications sem a exigência de payload objeto';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.email_outbox'::regclass and conname = 'email_outbox_campos_preenchidos'
  ) then
    raise exception 'email_outbox sem a exigência de destinatário/assunto/corpo não vazios';
  end if;

  -- Os avisos HERDADOS permanecem: `notifications` amplia, não substitui.
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'agent_inbox_items'
  ) then
    raise exception 'agent_inbox_items sumiu — o aviso da organização continua sendo dele (§5.16 amplia, não substitui)';
  end if;
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'event_log'
  ) then
    raise exception 'event_log sumiu — o barramento de §5.13 continua sendo dele';
  end if;
end
$f05_t05_fim$;

notify pgrst,'reload schema';
