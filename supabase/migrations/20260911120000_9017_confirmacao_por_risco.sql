-- F04-T01/T02 — a pendência de confirmação e o registro único de auditoria
-- (§5.8, §5.17, D17/D18/D33). Timestamp criado pelo Supabase CLI; arquivo
-- aplicado é imutável.
--
-- ─── Por que DUAS tabelas e não uma coluna em conversations ─────────────────
--
-- `waiting_confirmation` é ESTADO da conversa; a ação que espera aprovação é um
-- OBJETO com nome, entrada, prazo e desfecho. Guardar o objeto como colunas de
-- `conversations` daria uma segunda verdade sobre "o que está pendente" e
-- tornaria impossível auditar a recusa (a linha some quando o estado muda).
--
-- ─── `audit_events` NÃO substitui `api_audit_log` ──────────────────────────
--
-- §5.17 pede um registro único escrito por Action Policy, Conversation,
-- Identity, Jobs e TenantConfiguration, com `risk` e `result` — vocabulário que
-- o log herdado não tem (`api_audit_log` é `action/resource_type/resource_id`
-- do CRUD REST, retenção 5 anos, L-10). O herdado PERMANECE e continua sendo
-- escrito pelos mesmos caminhos; a tabela nova nasce ao lado. Apagar o herdado
-- seria reescrever a auditoria de todo o produto numa task de catálogo.
--
-- ─── DIVERGÊNCIA DECLARADA em relação a §5.17 ──────────────────────────────
--
-- §5.17 nomeia a coluna de contexto como `metadata`; aqui ela se chama
-- `payload`, que é o nome pedido pela task de construção da F04-T01. As demais
-- colunas de §5.17 (`resource_type`, `resource_id`, `request_id`) EXISTEM e são
-- anuláveis: sem elas o `request_id` de ADR-015 não teria onde morar e a
-- correlação com `api_audit_log` se perderia. Um nome divergente declarado é
-- melhor que duas colunas com o mesmo significado.
--
-- ─── service_only (D35) para as duas ───────────────────────────────────────
--
-- RLS ligada, ZERO policies, `revoke all` de public/anon/authenticated e
-- `grant all` só a `service_role`. A pendência e a auditoria são lidas pelo
-- Inbox do atendente SERVIDOR adentro (`withTenant`), nunca pelo PostgREST: um
-- registro que o navegador lê é um registro que o navegador pode escrever, e
-- `audit_events` é justamente o lugar onde ninguém pode escrever de fora.
-- Prova comportamental (dois tenants, JWT, quatro operações) em
-- `tests/invariants/f04-t02-confirmacao-schema.test.ts`.

-- ---------------------------------------------------------------------------
-- 1 · pending_actions — a ação da IA que espera o `attendant`
-- ---------------------------------------------------------------------------
--
-- `conversation_id` é ANULÁVEL de propósito: a Fase 1 sempre a preenche (o
-- schema de `execute()` a exige, porque a pendência tem de virar
-- `ai.confirmation_requested` numa conversa de verdade), mas a automação de
-- §5.12 pode vir a pedir confirmação de algo que não nasceu numa conversa.
-- `on delete cascade` porque pendência de conversa apagada não tem quem aprove.
--
-- `expires_at` é COLUNA e não cálculo em tempo de leitura: o prazo nasce do
-- Setting `conversation.confirmation_timeout_minutes` no instante do pedido, e
-- gravá-lo faz uma mudança posterior do Setting não expirar (nem desexpirar)
-- retroativamente o que já estava pendente.

create table if not exists public.pending_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  action_name text not null,
  input jsonb not null default '{}'::jsonb,
  requested_by text not null,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'pending',
  resolved_by uuid,
  resolved_at timestamptz,
  constraint pending_actions_status_check
    check (status in ('pending','approved','rejected','timeout')),
  constraint pending_actions_requested_by_check
    check (requested_by in ('human','ai','automation')),
  -- Coerência: pendente ⇔ sem desfecho. Sem ela caberia linha `approved` sem
  -- hora de resolução, e a guarda `pending_action_executed` — que compara
  -- `resolved_at` com a entrada no estado — aprovaria o movimento sem que nada
  -- tivesse sido executado.
  constraint pending_actions_desfecho_coerente
    check ((status = 'pending') = (resolved_at is null))
);

-- Dedup ANTES do índice único (doutrina de migrations §8). Hoje a tabela é nova
-- e isto casa zero linhas; escrever mesmo assim é o que impede que uma
-- re-aplicação sobre estado intermediário (tabela criada, índice não) derrube a
-- migration no meio e deixe o schema pela metade. Mantém a linha mais ANTIGA.
delete from public.pending_actions a
 using public.pending_actions b
 where a.status = 'pending' and b.status = 'pending'
   and a.organization_id = b.organization_id
   and a.conversation_id = b.conversation_id
   and a.conversation_id is not null
   and (a.requested_at, a.id) > (b.requested_at, b.id);

-- UMA pendência por conversa, e é invariante de desenho, não conveniência:
-- `waiting_confirmation` é um estado só, e duas pendências simultâneas fariam
-- `confirmation.approved` significar duas coisas. Parcial em `status='pending'`
-- para que o histórico resolvido possa ter quantas linhas a conversa tiver
-- tido.
create unique index if not exists pending_actions_uma_por_conversa
  on public.pending_actions (organization_id, conversation_id)
  where status = 'pending' and conversation_id is not null;

-- A consulta das três guardas de `src/conversation/guards.ts`.
create index if not exists pending_actions_org_conversa_idx
  on public.pending_actions (organization_id, conversation_id, status);

-- A consulta do Job de timeout: "o que venceu, no tenant, ainda pendente".
create index if not exists pending_actions_org_expira_idx
  on public.pending_actions (organization_id, expires_at)
  where status = 'pending';

alter table public.pending_actions enable row level security;

comment on table public.pending_actions is
  'Ação do catálogo (§5.8) que espera confirmação humana (D33). service_only (D35): RLS ligada, zero policies, só service_role — o Inbox a lê pelo servidor, via withTenant.';
comment on column public.pending_actions.requested_by is
  'Executor que PEDIU (human|ai|automation). Quem aprovou vai em resolved_by; o ator com identidade completa fica em audit_events.';
comment on column public.pending_actions.expires_at is
  'Prazo gravado no pedido a partir do Setting conversation.confirmation_timeout_minutes. Coluna e não cálculo: mudar o Setting depois não expira retroativamente o que já estava pendente.';
comment on column public.pending_actions.input is
  'Entrada JÁ VALIDADA pelo input_schema da entrada do catálogo. É o que será executado na aprovação — reler o pedido do cliente na hora da aprovação abriria janela para o texto mudar entre pedir e aprovar.';

-- ---------------------------------------------------------------------------
-- 2 · audit_events — o registro único de §5.17
-- ---------------------------------------------------------------------------

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_type text not null,
  actor_id uuid,
  action_name text not null,
  risk text,
  result text not null,
  resource_type text,
  resource_id uuid,
  request_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_actor_type_check
    check (actor_type in ('user','ai','automation','system')),
  constraint audit_events_result_check
    check (result in ('executed','pending','denied','failed')),
  -- `risk` é anulável porque §5.17 manda Conversation, Identity, Jobs e
  -- TenantConfiguration escreverem aqui, e nenhum desses tem risco de Action.
  -- Anulável NÃO é livre: quando existe, é da taxonomia única de §5.8.
  constraint audit_events_risk_check
    check (risk is null or risk in ('low','medium','high','blocked'))
);

create index if not exists audit_events_org_criado_idx
  on public.audit_events (organization_id, created_at desc);

create index if not exists audit_events_org_acao_idx
  on public.audit_events (organization_id, action_name, created_at desc);

-- O ator, para "o que a IA fez neste tenant" sem varrer a tabela inteira.
create index if not exists audit_events_org_ator_idx
  on public.audit_events (organization_id, actor_type, created_at desc);

alter table public.audit_events enable row level security;

comment on table public.audit_events is
  'Registro único de §5.17: quem fez o quê, com que risco e resultado. Escrevem Action Policy, Conversation, Identity, Jobs e TenantConfiguration. NÃO substitui api_audit_log (L-10, retenção 5 anos), que permanece. service_only (D35).';
comment on column public.audit_events.payload is
  'Contexto do evento. DIVERGÊNCIA DECLARADA: §5.17 chama esta coluna de `metadata`; o nome aqui é o pedido pela task da F04-T01. Nunca recebe corpo de mensagem do cliente — auditoria é quem/quando/o quê.';
comment on column public.audit_events.risk is
  'Taxonomia única de §5.8 (low|medium|high|blocked) quando o evento vem de uma Action; NULL quando vem de Conversation, Identity, Jobs ou Config.';

-- ---------------------------------------------------------------------------
-- 3 · Rodapé de privilégios (G-54)
-- ---------------------------------------------------------------------------

revoke all on public.pending_actions from public,anon,authenticated,service_role;
grant all on public.pending_actions to service_role;

revoke all on public.audit_events from public,anon,authenticated,service_role;
grant all on public.audit_events to service_role;

-- ---------------------------------------------------------------------------
-- 4 · A migration termina lendo o que afirmou
-- ---------------------------------------------------------------------------
--
-- Releitura do catálogo DEPOIS do revoke/grant: antes dele a checagem de
-- privilégio mediria o estado que a própria migration ainda ia corrigir (num
-- projeto Supabase o `alter default privileges … to anon` faz toda tabela nova
-- nascer exposta).

do $f04_t02_fim$
declare
  v_tabela text;
  v_policies integer;
  v_anon integer;
  v_auth integer;
  v_service integer;
begin
  foreach v_tabela in array array['pending_actions','audit_events'] loop
    if not exists (
      select 1 from pg_tables where schemaname = 'public' and tablename = v_tabela
    ) then
      raise exception 'F04-T02 não criou public.%', v_tabela;
    end if;
    if exists (
      select 1 from pg_tables where schemaname = 'public' and tablename = v_tabela
        and not rowsecurity
    ) then
      raise exception 'F04-T02 criou % sem RLS', v_tabela;
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
    if v_anon <> 0 or v_auth <> 0 then
      raise exception '% exposta: anon=% authenticated=% privilégio(s)', v_tabela, v_anon, v_auth;
    end if;

    select count(*) into v_service from pg_class c,
      aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
     where c.oid = ('public.' || v_tabela)::regclass and a.grantee = 'service_role'::regrole;
    if v_service = 0 then
      raise exception '% sem privilégio para service_role — o produto não escreveria nela', v_tabela;
    end if;
  end loop;

  -- A FK de organização é o que torna as duas tenant-aware de verdade: sem ela
  -- uma linha órfã sobreviveria à remoção do tenant.
  if (select count(*) from pg_constraint
       where conrelid = 'public.pending_actions'::regclass and contype = 'f' and convalidated) < 2 then
    raise exception 'pending_actions sem as duas FKs validadas (organizations e conversations)';
  end if;
  if (select count(*) from pg_constraint
       where conrelid = 'public.audit_events'::regclass and contype = 'f' and convalidated) < 1 then
    raise exception 'audit_events sem a FK validada de organizations';
  end if;

  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and tablename = 'pending_actions'
      and indexname = 'pending_actions_uma_por_conversa'
  ) then
    raise exception 'F04-T02 não instalou pending_actions_uma_por_conversa';
  end if;

  -- As três CHECKs de vocabulário, por NOME: "a tabela existe" aprovaria uma
  -- coluna `status` que aceitasse qualquer texto.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.pending_actions'::regclass
       and conname = 'pending_actions_status_check'
       and pg_get_constraintdef(oid) ilike '%timeout%'
  ) then
    raise exception 'pending_actions.status sem o CHECK dos quatro desfechos';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.pending_actions'::regclass
       and conname = 'pending_actions_desfecho_coerente'
  ) then
    raise exception 'pending_actions sem a coerência status ⇔ resolved_at';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.audit_events'::regclass
       and conname = 'audit_events_result_check'
       and pg_get_constraintdef(oid) ilike '%denied%'
  ) then
    raise exception 'audit_events.result sem o CHECK dos quatro resultados';
  end if;

  -- O herdado PERMANECE. Esta migration não é migração de auditoria.
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'api_audit_log'
  ) then
    raise exception 'api_audit_log sumiu — §5.17 diz que ela permanece ao lado de audit_events';
  end if;
end
$f04_t02_fim$;

notify pgrst,'reload schema';
