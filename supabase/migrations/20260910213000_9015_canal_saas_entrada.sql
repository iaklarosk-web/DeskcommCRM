-- F03-T03/T04 — a conta de canal aponta a sessão herdada, e a entrada ganha a
-- dimensão de provedor na idempotência (ADR-017, decisões 2 e 4).
-- Timestamp criado pelo Supabase CLI; arquivo aplicado é imutável.
--
-- ─── Por que `channel_accounts` precisa de `channel_session_id` ─────────────
--
-- `conversations.channel_session_id` e `messages.channel_session_id` são
-- NOT NULL no schema herdado (baseline.sql:1365-1401 e :1636-1667). O caminho
-- de entrada do SaaS resolve o tenant por `channel_accounts` (§5.1) e, logo
-- depois, precisa gravar essas duas linhas — então a conta de canal tem de
-- saber POR QUAL sessão herdada ela fala. Sem o vínculo, o pipeline teria de
-- adivinhar a sessão (por organização, por telefone) e escreveria a mensagem
-- do cliente na sessão errada no primeiro tenant com dois números.
--
-- `on delete restrict` e não `cascade`: apagar a sessão herdada com uma conta
-- SaaS apontando para ela deixaria o webhook resolvendo tenant e falhando no
-- INSERT — falha tardia, dentro da transação da mensagem do cliente. Restringir
-- move a recusa para quem apaga, que é quem sabe o que está fazendo.
--
-- `phone_e164` é o número da conta como o provedor o publica. Fica aqui, e não
-- em `channel_sessions.phone_number`, porque nem todo provedor do contrato de
-- §5.7 tem sessão (o `mock` não tem), e porque a coluna herdada é escrita pelo
-- health-check do WAHA — duas escritoras na mesma coluna divergiriam.
--
-- ─── Por que um índice NOVO em `messages` e não a constraint herdada ───────
--
-- `messages_org_external_id_unique (organization_id, external_id)` (baseline.sql
-- :2298-2301) tem leitores e é DEFERRABLE INITIALLY DEFERRED. §5.7 pede a
-- tripla `(organization_id, provider, external_id)`. Migration aplicada não se
-- edita e constraint com leitores não se troca: a dimensão nova cabe num índice
-- PARCIAL novo, que só olha linhas com `provider` preenchido — isto é, as que o
-- caminho SaaS gravou. Linha legada (provider null) não é tocada nem bloqueada.
--
-- O índice novo é IMEDIATO (não deferrable) de propósito: é ele o árbitro do
-- `on conflict do nothing` do pipeline de entrada, e árbitro deferido não
-- existe em tempo de INSERT — a reentrega gravaria a segunda linha e só
-- estouraria no commit, abortando a transação inteira em vez de ser reconhecida
-- como reentrega.

-- ---------------------------------------------------------------------------
-- 1 · channel_accounts: telefone publicado e vínculo com a sessão herdada
-- ---------------------------------------------------------------------------

alter table public.channel_accounts add column if not exists phone_e164 text;
alter table public.channel_accounts add column if not exists channel_session_id uuid;

do $f03_t03$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.channel_accounts'::regclass
       and conname = 'channel_accounts_channel_session_fk'
  ) then
    alter table public.channel_accounts
      add constraint channel_accounts_channel_session_fk
      foreign key (channel_session_id)
      references public.channel_sessions(id) on delete restrict;
  end if;
end
$f03_t03$;

create index if not exists channel_accounts_session_idx
  on public.channel_accounts (channel_session_id);

comment on column public.channel_accounts.phone_e164 is
  'Telefone E.164 que o provedor publica para esta conta. Não substitui channel_sessions.phone_number (escrita pelo health-check do WAHA): provedor sem sessão — o mock — também tem conta.';
comment on column public.channel_accounts.channel_session_id is
  'Sessão herdada por onde esta conta fala. Existe porque conversations.channel_session_id e messages.channel_session_id são NOT NULL: o pipeline de entrada do SaaS (src/channels/inbound.ts) resolve o tenant aqui e precisa da sessão na mesma leitura. on delete restrict: apagar a sessão com conta apontada falharia dentro da transação da mensagem do cliente.';

-- ---------------------------------------------------------------------------
-- 2 · messages: a dimensão de provedor na idempotência de entrada
-- ---------------------------------------------------------------------------

alter table public.messages add column if not exists provider text;

do $f03_t04$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.messages'::regclass
       and conname = 'messages_provider_conhecido'
  ) then
    alter table public.messages
      add constraint messages_provider_conhecido
      check (provider is null or provider in ('waha','meta_cloud','zernio','mock'));
  end if;
end
$f03_t04$;

comment on column public.messages.provider is
  'Provedor de canal que entregou/levou esta mensagem pelo caminho SaaS (§5.7). NULL nas linhas do caminho herdado — e é por isso que o índice de idempotência novo é PARCIAL: ele não muda o contrato das linhas antigas.';

-- Dedup ANTES do índice único (doutrina de migrations §8). Hoje a coluna nasce
-- inteira NULL, então isto casa zero linhas; escrever mesmo assim é o que
-- impede que uma re-aplicação sobre estado intermediário (coluna criada, índice
-- não) derrube a migration no meio e deixe o schema pela metade.
delete from public.messages a
 using public.messages b
 where a.organization_id = b.organization_id
   and a.provider = b.provider
   and a.external_id = b.external_id
   and a.provider is not null
   and a.external_id is not null
   and (a.created_at, a.id) > (b.created_at, b.id);

create unique index if not exists messages_org_provider_external_uk
  on public.messages (organization_id, provider, external_id)
  where provider is not null and external_id is not null;

-- ---------------------------------------------------------------------------
-- 3 · Rodapé de privilégios (G-54)
-- ---------------------------------------------------------------------------
--
-- `channel_accounts` é reafirmada aqui inteira: as colunas novas herdam o ACL
-- da tabela, mas repetir o revoke/grant é o que faz este arquivo ser legível
-- sozinho — e é barato, porque é idempotente.
--
-- ⚠️ `public.messages` NÃO aparece abaixo, e a ausência é deliberada: ela é
-- tabela herdada com RLS e policies em uso pelo produto inteiro, e um
-- `revoke all` aqui derrubaria a leitura do inbox de todo cliente. Coluna nova
-- em tabela existente não muda quem pode lê-la; quem quiser conferir o ACL de
-- `messages` mede o bloco de RLS herdado, não este.

revoke all on public.channel_accounts from anon;
revoke all on public.channel_accounts from authenticated;
grant select on public.channel_accounts to authenticated;
grant all on public.channel_accounts to service_role;

-- ---------------------------------------------------------------------------
-- 4 · A migration termina lendo o que afirmou
-- ---------------------------------------------------------------------------

do $f03_t03_t04$
declare
  v_faltam text;
  v_anon integer;
begin
  select string_agg(c, ', ') into v_faltam
    from unnest(array['phone_e164','channel_session_id']) as c
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'channel_accounts'
        and column_name = c
   );
  if v_faltam is not null then
    raise exception 'F03-T03 não criou coluna(s) em channel_accounts: %', v_faltam;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.channel_accounts'::regclass
       and conname = 'channel_accounts_channel_session_fk' and contype = 'f'
  ) then
    raise exception 'F03-T03 não instalou channel_accounts_channel_session_fk';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'channel_accounts'
       and indexname = 'channel_accounts_session_idx'
  ) then
    raise exception 'F03-T03 não instalou channel_accounts_session_idx';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'messages' and column_name = 'provider'
  ) then
    raise exception 'F03-T04 não criou messages.provider';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.messages'::regclass and conname = 'messages_provider_conhecido'
  ) then
    raise exception 'F03-T04 não instalou messages_provider_conhecido';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'messages'
       and indexname = 'messages_org_provider_external_uk'
  ) then
    raise exception 'F03-T04 não instalou messages_org_provider_external_uk';
  end if;

  -- A constraint HERDADA continua de pé: o índice novo é aditivo, e uma
  -- migration que a removesse sem ninguém notar é exatamente o desfecho que a
  -- ADR-017 (alternativa rejeitada) recusa.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.messages'::regclass
       and conname = 'messages_org_external_id_unique'
  ) then
    raise exception 'F03-T04 removeu a constraint herdada messages_org_external_id_unique';
  end if;

  select count(*) into v_anon
    from pg_class c, aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
   where c.oid = 'public.channel_accounts'::regclass and a.grantee = 'anon'::regrole;
  if v_anon <> 0 then
    raise exception 'channel_accounts exposta a anon: % privilégio(s)', v_anon;
  end if;
end
$f03_t03_t04$;

notify pgrst,'reload schema';
