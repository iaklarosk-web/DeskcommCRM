-- F14-T00 — o canal `webchat` (chat do site) no schema e a sessão do visitante
-- (ADR-038 §3, D55 c). Timestamp criado à mão na sequência da 9029; arquivo
-- aplicado é imutável.
--
-- ─── O que este arquivo acrescenta ──────────────────────────────────────────
--
-- 1. `webchat` nos QUATRO CHECKs que hoje só conhecem WhatsApp:
--    `conversations.channel` (era `= 'whatsapp'`), `channel_sessions.provider`
--    e `provider_ref` (a chave da sessão do site é `waha_session_name =
--    'webchat:<org>'` — coluna herdada NOT NULL reaproveitada como chave, em
--    vez de renomear uma coluna que 30 lugares leem; comentário na coluna),
--    `channel_accounts.provider` e `messages.provider`. O chat do site é um
--    canal do MESMO modelo (conversa, contato, mensagem, handoff, política,
--    limite); o que muda é a entrada (visitante por token) e a saída (adapter
--    que entrega gravando).
-- 2. `webchat_sessions`: a sessão do VISITANTE — anônimo até se identificar
--    (nome + e-mail/telefone → `contacts`), depois presa a UMA conversa.
--    Guarda o SHA-256 do token (o token nunca é gravado), `ip_hash` (para o
--    freio por IP, ADR-038 §6 objeção 2) e `page_url`. service_only (D35):
--    o visitante NÃO tem JWT — uma policy para `anon` abriria a tabela a
--    quem tivesse a URL; só as rotas públicas (service pool + `withTenant`)
--    a tocam. Grants explícitos ao fim (G-54).
--
-- Par obrigatório (D08): este arquivo + apêndice idempotente no baseline,
-- ANTES do bloco da varredura de anon. Prova:
-- tests/invariants/f14-t00-webchat-sessions-service-only.test.ts (RLS, zero
-- policies, anon/authenticated negados 4/4, service_role escreve e lê; os
-- quatro CHECKs aceitam `webchat`) e tests/integration/f14-canais-e-agenda.test.ts.

-- ---------------------------------------------------------------------------
-- 1 · `webchat` nos CHECKs
-- ---------------------------------------------------------------------------

alter table public.conversations
  drop constraint if exists conversations_channel_check;
alter table public.conversations
  add constraint conversations_channel_check
  check (channel in ('whatsapp', 'webchat'));

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_check;
alter table public.channel_sessions
  add constraint channel_sessions_provider_check
  check (provider = any (array['waha'::text, 'meta_cloud'::text, 'zernio'::text, 'webchat'::text]));

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_ref_check;
alter table public.channel_sessions
  add constraint channel_sessions_provider_ref_check check (
    (provider = 'waha'       and waha_session_name    is not null) or
    (provider = 'meta_cloud' and meta_phone_number_id is not null) or
    (provider = 'zernio'     and zernio_account_id    is not null) or
    (provider = 'webchat'    and waha_session_name    is not null)
  );

comment on column public.channel_sessions.waha_session_name is
  'Nome da sessão no WAHA (provider waha). Para provider webchat (F14) é a CHAVE da sessão do site: ''webchat:<organization_id>'' — coluna herdada NOT NULL reaproveitada, uma sessão por organização.';

alter table public.channel_accounts
  drop constraint if exists channel_accounts_provider_conhecido;
alter table public.channel_accounts
  add constraint channel_accounts_provider_conhecido
  check (provider in ('waha', 'meta_cloud', 'mock', 'webchat'));

alter table public.messages
  drop constraint if exists messages_provider_conhecido;
alter table public.messages
  add constraint messages_provider_conhecido
  check (provider is null or provider in ('waha','meta_cloud','zernio','mock','webchat'));

-- ---------------------------------------------------------------------------
-- 2 · webchat_sessions — a sessão do visitante (service_only)
-- ---------------------------------------------------------------------------

create table if not exists public.webchat_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- SHA-256 hex do token que vive no navegador do visitante; único no mundo
  -- (o token tem 32 bytes aleatórios), e é por ele que a rota pública acha a
  -- sessão SEM saber a organização de antemão.
  token_hash text not null unique,
  contact_id uuid references public.contacts(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  visitor_name text,
  visitor_contact text,
  ip_hash text not null,
  user_agent text,
  page_url text,
  identified_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- Identificada ⇔ nome e contato preenchidos e carimbo presente: a metade
  -- ("nome sem contato") é exatamente o contato vazio que a decisão do
  -- proprietário (identificar ANTES da 1ª resposta) existe para evitar.
  constraint webchat_sessions_identificacao_coerente check (
    (identified_at is null and contact_id is null)
    or (identified_at is not null and contact_id is not null
        and char_length(btrim(coalesce(visitor_name, ''))) > 0
        and char_length(btrim(coalesce(visitor_contact, ''))) > 0)
  ),
  constraint webchat_sessions_token_hash_forma check (token_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists webchat_sessions_org_criada_idx
  on public.webchat_sessions (organization_id, created_at desc);
-- Freio por IP (ADR-038 §2 T01): "quantas sessões este IP abriu na última hora".
create index if not exists webchat_sessions_ip_criada_idx
  on public.webchat_sessions (ip_hash, created_at desc);
create index if not exists webchat_sessions_conversa_idx
  on public.webchat_sessions (organization_id, conversation_id)
  where conversation_id is not null;

alter table public.webchat_sessions enable row level security;

comment on table public.webchat_sessions is
  'F14: a sessão do VISITANTE do chat do site — anônima (token no navegador, aqui só o SHA-256) até se identificar (nome + e-mail/telefone → contacts), depois presa a UMA conversa channel=webchat. service_only (D35): o visitante não tem JWT; só as rotas públicas /api/public/webchat/* (service pool + withTenant) leem e escrevem.';
comment on column public.webchat_sessions.ip_hash is
  'SHA-256 do IP de origem com sal do servidor — o freio por IP conta por ele; o IP em claro nunca é gravado.';
comment on column public.webchat_sessions.visitor_contact is
  'E-mail ou telefone E.164 que o visitante deu ao se identificar; é o que achou/criou o contato.';

-- Grants explícitos (G-54): ninguém além do service_role.
revoke all on public.webchat_sessions from public, anon, authenticated, service_role;
grant all on public.webchat_sessions to service_role;

do $f14_t00_fim$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.conversations'::regclass and conname = 'conversations_channel_check';
  if v_def is null or v_def not like '%webchat%' then
    raise exception 'conversations_channel_check não aceita webchat';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'webchat_sessions') then
    raise exception 'webchat_sessions não existe';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'webchat_sessions') then
    raise exception 'webchat_sessions é service_only: não pode ter policy';
  end if;
end
$f14_t00_fim$;

notify pgrst, 'reload schema';
