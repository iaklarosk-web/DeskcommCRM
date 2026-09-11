-- F05-T01/T02/T03 — o handoff ganha REGISTRO: motivo em enum, resumo de sete
-- campos e fila de claim (§5.11, D19/D34/D35; §5.2 grupo `handoff`).
-- Timestamp criado pelo Supabase CLI; arquivo aplicado é imutável.
--
-- ─── Por que uma tabela e não colunas em `conversations` ───────────────────
--
-- `waiting_human` é ESTADO da conversa e continua sendo a única verdade sobre
-- "de quem é a conversa agora" (D16, `src/conversation/transition.ts`). O que
-- nasce aqui é outra coisa: o DOSSIÊ de uma passagem — por que ela aconteceu e
-- o que a pessoa precisa ler para assumir. Guardar isso como colunas de
-- `conversations` daria uma SEGUNDA máquina de estados (o `claimed_at` da
-- coluna divergindo do `saas_state` da linha) e apagaria o histórico: a conversa
-- que foi para a fila três vezes teria um dossiê só, o último.
--
-- Por isso esta migration NÃO cria estado novo (target-state de §5.11, linha da
-- 5.11 do DIRETRIZ): `handoffs` não tem coluna `status`. "Aberto" é
-- `claimed_at is null`, derivado — uma coluna de status seria a segunda verdade
-- sobre o mesmo fato, livre para discordar do índice e do `saas_state`.
--
-- ─── O que é REUSADO, e por isso não aparece aqui ──────────────────────────
--
--  · o silêncio infinito e `contacts.force_human` continuam em
--    `lib/agent-engine/agent/human-handoff.ts` (nada a migrar);
--  · o AVISO da organização continua sendo `agent_inbox_items(kind='handoff')`,
--    que já existe, já tem tela e já deduplica por episódio aberto. `handoffs`
--    nasce AO LADO dele, não no lugar — apagar o aviso herdado tiraria da
--    Central de avisos uma linha que hoje aparece;
--  · a atribuição do claim é de `fn_conversation_assign`, chamada pela
--    `transition()` no evento `human.claimed`. Nenhuma trava nova: o segundo
--    claim é recusado porque `human_handling` não tem linha `human.claimed` na
--    tabela D16, e a linha da conversa está travada `for no key update`.
--
-- ─── `last_messages` tem SEMPRE cinco posições ─────────────────────────────
--
-- §5.11: "`last_messages` exatamente 5". Conversa mais curta que isso preenche
-- as posições antigas com `null` — a posição existe e declara que não houve
-- mensagem ali. A alternativa (array menor) faria "não havia mensagem" e "o
-- montador esqueceu de ler" ficarem indistinguíveis, que é exatamente o que a
-- contagem de sete campos existe para separar.
--
-- ─── `pending_action` é o ÚNICO dos sete campos que aceita NULL ────────────
--
-- E aceita de propósito: a maioria dos handoffs acontece sem nenhuma ação
-- pendurada, e um texto fabricado ("nenhuma") para satisfazer um `not null`
-- seria dado inventado no dossiê que a pessoa vai ler. O campo é DECLARADO
-- (a coluna existe e é sempre escrita pelo montador); o valor é honesto.
--
-- Par obrigatório (D08): este arquivo + apêndice byte-fiel no baseline, ANTES
-- do bloco da varredura de anon, que é o último.

-- ---------------------------------------------------------------------------
-- 1 · handoffs — o dossiê da passagem (§5.11)
-- ---------------------------------------------------------------------------

create table if not exists public.handoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  reason text not null,
  customer text not null,
  intent text not null,
  summary text not null,
  last_messages jsonb not null default '[null,null,null,null,null]'::jsonb,
  pending_action text,
  suggested_next_step text not null,
  created_by text not null,
  claimed_by uuid,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  -- Os OITO motivos de §5.11 (os 7 gatilhos de D19 mais `forbidden_request` de
  -- §5.9). Enum e NUNCA frase (G-78): motivo em prosa não vira etiqueta de
  -- contador nem filtro de fila, e o CHECK é o que impede o primeiro texto
  -- livre de entrar por um caminho que esqueceu do enum do TypeScript.
  constraint handoffs_reason_check check (reason in (
    'customer_request','high_risk_action','low_confidence','out_of_knowledge',
    'complaint','provider_error','tenant_rule','forbidden_request'
  )),
  constraint handoffs_created_by_check
    check (created_by in ('ai','system','human')),
  -- Os cinco campos que §5.11 exige não-vazios. `char_length(btrim(...)) > 0` e
  -- não `not null`: `not null` aceita a string vazia, e resumo vazio é
  -- exatamente o desfecho que `summary=present` existe para reprovar.
  constraint handoffs_campos_preenchidos check (
    char_length(btrim(customer)) > 0
    and char_length(btrim(intent)) > 0
    and char_length(btrim(summary)) > 0
    and char_length(btrim(suggested_next_step)) > 0
  ),
  -- Exatamente CINCO posições (§5.11). `jsonb_typeof` antes do comprimento
  -- porque `jsonb_array_length` de um objeto levanta erro em vez de recusar a
  -- linha — e erro dentro de uma constraint é um vermelho que fala do Postgres.
  constraint handoffs_cinco_ultimas_mensagens check (
    jsonb_typeof(last_messages) = 'array' and jsonb_array_length(last_messages) = 5
  ),
  -- Coerência do claim: assumido ⇔ tem quem e quando. Sem ela caberia linha com
  -- `claimed_at` e sem dono, e a fila mostraria como assumido um handoff que
  -- ninguém assumiu.
  constraint handoffs_claim_coerente
    check ((claimed_by is null) = (claimed_at is null))
);

-- Dedup ANTES do índice único (doutrina de migrations §8). Hoje a tabela é nova
-- e isto casa zero linhas; escrever mesmo assim é o que impede que uma
-- re-aplicação sobre estado intermediário (tabela criada, índice não, alguma
-- escrita no meio) derrube a migration e deixe o schema pela metade. Mantém a
-- linha mais ANTIGA de cada conversa.
delete from public.handoffs a
 using public.handoffs b
 where a.claimed_at is null and b.claimed_at is null
   and a.organization_id = b.organization_id
   and a.conversation_id = b.conversation_id
   and (a.created_at, a.id) > (b.created_at, b.id);

-- UM handoff ABERTO por conversa — a mesma identidade de episódio que o aviso
-- herdado já usa (`agent_inbox_items ... and status = 'open'`). Parcial em
-- `claimed_at is null` para que a conversa que voltou para a IA (`resume_ai`) e
-- foi para a fila de novo tenha o SEGUNDO dossiê, e não uma colisão.
create unique index if not exists handoffs_um_aberto_por_conversa
  on public.handoffs (organization_id, conversation_id)
  where claimed_at is null;

-- A consulta da FILA (§5.11, `assignment = queue`): o que está aberto no
-- tenant, do mais antigo para o mais novo — quem esperou mais aparece primeiro.
create index if not exists handoffs_fila_aberta_idx
  on public.handoffs (organization_id, created_at)
  where claimed_at is null;

-- "O que ESTE atendente assumiu", sem varrer o histórico do tenant.
create index if not exists handoffs_org_assumido_idx
  on public.handoffs (organization_id, claimed_by, claimed_at desc)
  where claimed_by is not null;

-- O histórico por conversa (a conversa que foi para a fila três vezes).
create index if not exists handoffs_org_conversa_idx
  on public.handoffs (organization_id, conversation_id, created_at desc);

alter table public.handoffs enable row level security;

comment on table public.handoffs is
  'Dossiê de uma passagem para humano (§5.11, D19): por que saiu da IA e o que a pessoa precisa ler para assumir. NÃO é estado — estado é conversations.saas_state (D16); "aberto" aqui é claimed_at is null. Nasce AO LADO de agent_inbox_items(kind=handoff), que continua sendo o aviso da organização. service_only (D35): RLS ligada, zero policies, só service_role — o Inbox a lê pelo servidor, via withTenant.';
comment on column public.handoffs.reason is
  'Enum de OITO valores (§5.11): os 7 gatilhos de D19 mais forbidden_request de §5.9. Nunca texto livre (G-78) — o CHECK é a catraca, e o espelho em TypeScript é src/actions/schemas.ts (HANDOFF_REASONS).';
comment on column public.handoffs.last_messages is
  'As CINCO últimas mensagens da conversa no instante do handoff, da mais antiga para a mais nova. SEMPRE cinco posições: conversa mais curta preenche as antigas com null, para que "não houve mensagem" e "o montador não leu" não fiquem indistinguíveis.';
comment on column public.handoffs.pending_action is
  'Nome da Action do catálogo (§5.8) que ficou pendurada, quando houver. ÚNICO dos sete campos de D19 que aceita NULL: a maioria das passagens não tem ação pendente, e inventar um texto para satisfazer um not null poria dado falso no dossiê que a pessoa vai ler.';
comment on column public.handoffs.claimed_by is
  'O attendant que assumiu, gravado DENTRO da transação de transition(human.claimed) — a mesma que chama fn_conversation_assign. Sem FK para auth.users pelo mesmo motivo de pending_actions.resolved_by: a identidade completa de quem agiu vive em audit_events.';
comment on column public.handoffs.summary is
  '≥1 frase (§5.11), montada do checkpoint/histórico — nunca de uma chamada extra ao provedor. Com reason=provider_error o texto é template determinístico: pedir resumo ao componente que acabou de falhar é pedir de novo a mesma falha.';

-- ---------------------------------------------------------------------------
-- 2 · Rodapé de privilégios (G-54)
-- ---------------------------------------------------------------------------
--
-- service_only (D35), pelo mesmo argumento de `pending_actions` e `audit_events`
-- (9017): o dossiê carrega o texto da conversa do cliente, e um registro que o
-- navegador lê é um registro que o navegador pode escrever. A fila do atendente
-- é servida pelo SERVIDOR, via `withTenant`, nunca pelo PostgREST.
--
-- `revoke ... from service_role` antes do `grant all` é deliberado: num projeto
-- Supabase o `alter default privileges ... to <role>` faz a tabela nova nascer
-- com privilégio que ninguém escreveu, e revogar de todos antes de conceder ao
-- dono é o que torna a linha seguinte a ÚNICA origem do acesso.

revoke all on public.handoffs from public,anon,authenticated,service_role;
grant all on public.handoffs to service_role;

-- ---------------------------------------------------------------------------
-- 3 · A migration termina lendo o que afirmou
-- ---------------------------------------------------------------------------
--
-- Releitura do catálogo DEPOIS do revoke/grant: antes dele a checagem de
-- privilégio mediria o estado que a própria migration ainda ia corrigir.

do $f05_t01_fim$
declare
  v_policies integer;
  v_anon integer;
  v_auth integer;
  v_public integer;
  v_service integer;
  v_motivo text;
  v_motivos_aceitos integer := 0;
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'handoffs'
  ) then
    raise exception 'F05-T01 não criou public.handoffs';
  end if;
  if exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'handoffs'
      and not rowsecurity
  ) then
    raise exception 'F05-T01 criou handoffs sem RLS';
  end if;

  select count(*) into v_policies from pg_policies
   where schemaname = 'public' and tablename = 'handoffs';
  if v_policies <> 0 then
    raise exception 'handoffs é service_only (D35) e apareceu com % policy(ies)', v_policies;
  end if;

  select count(*) into v_anon from pg_class c,
    aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
   where c.oid = 'public.handoffs'::regclass and a.grantee = 'anon'::regrole;
  select count(*) into v_auth from pg_class c,
    aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
   where c.oid = 'public.handoffs'::regclass and a.grantee = 'authenticated'::regrole;
  select count(*) into v_public from pg_class c,
    aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
   where c.oid = 'public.handoffs'::regclass and a.grantee = 0;
  if v_anon <> 0 or v_auth <> 0 or v_public <> 0 then
    raise exception 'handoffs exposta: anon=% authenticated=% PUBLIC=% privilégio(s)',
      v_anon, v_auth, v_public;
  end if;

  select count(*) into v_service from pg_class c,
    aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
   where c.oid = 'public.handoffs'::regclass and a.grantee = 'service_role'::regrole;
  if v_service = 0 then
    raise exception 'handoffs sem privilégio para service_role — o produto não escreveria nela';
  end if;

  -- As duas FKs validadas: sem elas uma linha órfã sobreviveria à remoção do
  -- tenant ou da conversa, e o dossiê apontaria para o nada.
  if (select count(*) from pg_constraint
       where conrelid = 'public.handoffs'::regclass and contype = 'f' and convalidated) < 2 then
    raise exception 'handoffs sem as duas FKs validadas (organizations e conversations)';
  end if;

  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and tablename = 'handoffs'
      and indexname = 'handoffs_um_aberto_por_conversa'
  ) then
    raise exception 'F05-T01 não instalou handoffs_um_aberto_por_conversa — dois dossiês abertos na mesma conversa voltariam a ser silenciosos';
  end if;
  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and tablename = 'handoffs'
      and indexname = 'handoffs_fila_aberta_idx'
  ) then
    raise exception 'F05-T01 não instalou handoffs_fila_aberta_idx — a fila varreria o histórico do tenant';
  end if;

  -- Os OITO motivos, um a um, contra o CHECK de verdade. "A constraint existe"
  -- aprovaria uma lista com sete — e o oitavo só falharia no dia em que um
  -- cliente pedisse o que não se pode.
  foreach v_motivo in array array[
    'customer_request','high_risk_action','low_confidence','out_of_knowledge',
    'complaint','provider_error','tenant_rule','forbidden_request'
  ] loop
    if not exists (
      select 1 from pg_constraint
       where conrelid = 'public.handoffs'::regclass
         and conname = 'handoffs_reason_check'
         and pg_get_constraintdef(oid) like '%''' || v_motivo || '''%'
    ) then
      raise exception 'handoffs_reason_check não aceita o motivo % de §5.11', v_motivo;
    end if;
    v_motivos_aceitos := v_motivos_aceitos + 1;
  end loop;
  if v_motivos_aceitos <> 8 then
    raise exception 'handoffs_reason_check cobre % motivos, e §5.11 tem 8', v_motivos_aceitos;
  end if;

  -- As três constraints que fazem o dossiê ser dossiê, por NOME.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.handoffs'::regclass
       and conname = 'handoffs_cinco_ultimas_mensagens'
  ) then
    raise exception 'handoffs sem a exigência de cinco últimas mensagens (§5.11)';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.handoffs'::regclass
       and conname = 'handoffs_campos_preenchidos'
  ) then
    raise exception 'handoffs sem a exigência de campos não-vazios — resumo vazio passaria';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.handoffs'::regclass
       and conname = 'handoffs_claim_coerente'
  ) then
    raise exception 'handoffs sem a coerência claimed_by ⇔ claimed_at';
  end if;

  -- Nenhum estado novo: `handoffs` não tem coluna de status (§5.11
  -- target-state). Se alguém acrescentar uma, esta migration reprova em vez de
  -- o produto passar a ter duas verdades sobre de quem é a conversa.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'handoffs' and column_name = 'status'
  ) then
    raise exception 'handoffs ganhou coluna status — estado da conversa é conversations.saas_state (D16), e um segundo estado de handoff é o que §5.11 recusa';
  end if;

  -- O aviso HERDADO permanece: `handoffs` amplia, não substitui.
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'agent_inbox_items'
  ) then
    raise exception 'agent_inbox_items sumiu — o aviso da organização continua sendo dele (§5.11 amplia, não substitui)';
  end if;
  -- E a RPC que o claim reusa continua de pé: sem ela, `human.claimed` deixaria
  -- de atribuir e a fila entregaria handoff sem dono.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'fn_conversation_assign'
  ) then
    raise exception 'fn_conversation_assign sumiu — é ela que o claim reusa pela transition()';
  end if;
end
$f05_t01_fim$;

notify pgrst,'reload schema';
