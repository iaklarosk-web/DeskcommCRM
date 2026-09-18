-- F03-T01 — estado D16 da conversa sobre o ciclo herdado (ADR-016).
-- Timestamp criado pelo Supabase CLI; arquivo aplicado é imutável.
--
-- O vocabulário de oito estados de §5.6 mora em coluna NOVA. O CHECK herdado
-- `conversations_status_check` não é tocado: leitores, gatilhos e RPCs legados
-- continuam idênticos. Uma autoridade escreve evento (src/conversation/
-- transition.ts); toda escrita legada de `status` é PROJETADA para cá pelo
-- gatilho abaixo, que traduz um valor e não escolhe transição nenhuma.

alter table public.conversations add column if not exists saas_state text;
alter table public.conversations add column if not exists saas_state_entered_at timestamptz;

-- O mapa LEGACY_TO_D16 em UM lugar só do lado SQL: backfill e gatilho o
-- consomem daqui. O espelho TypeScript é src/conversation/state-map.ts.
create or replace function public.fn_saas_state_from_legacy(p_status text)
returns text language sql immutable security definer set search_path='' as $f03_t01$
  select case p_status
    when 'open'        then 'open'
    when 'pending'     then 'waiting_human'
    when 'claimed'     then 'human_handling'
    when 'ai_handling' then 'ai_handling'
    when 'resolved'    then 'resolved'
    when 'closed'      then 'resolved'
    when 'archived'    then 'archived'
  end
$f03_t01$;

-- Backfill total: `status_changed_at` já é o instante em que o ciclo herdado
-- entrou no estado atual, então não se fabrica hora nova. Valor fora do CHECK
-- herdado devolveria NULL e o SET NOT NULL abaixo derruba a migration — é a
-- falha alta que se quer, não um 'open' inventado.
update public.conversations
   set saas_state = public.fn_saas_state_from_legacy(status),
       saas_state_entered_at = status_changed_at
 where saas_state is null;

alter table public.conversations alter column saas_state set default 'open';
alter table public.conversations alter column saas_state set not null;
alter table public.conversations alter column saas_state_entered_at set default now();
alter table public.conversations alter column saas_state_entered_at set not null;

do $f03_t01$
begin
  if not exists(select 1 from pg_constraint
    where conrelid='public.conversations'::regclass
      and conname='conversations_saas_state_check') then
    alter table public.conversations
      add constraint conversations_saas_state_check
      check (saas_state in (
        'open','ai_handling','waiting_customer','waiting_confirmation',
        'waiting_human','human_handling','resolved','archived'
      ));
  end if;
end
$f03_t01$;

-- Projeção mecânica de escritor legado. Não é uma segunda máquina: aplica o
-- mapa total e carimba a hora só quando o valor projetado difere do atual.
--
-- Supressão: `transition()` sinaliza app.conversation_transition='1' na MESMA
-- transação antes de escrever; aí o movimento já tem dono e o gatilho cala.
--
-- É AFTER (G-57) e escreve com UPDATE na própria tabela. Não recursa porque o
-- gatilho é `of status` e este UPDATE não toca `status` — nenhuma guarda de
-- profundidade é necessária, e nenhuma existe de propósito.
create or replace function public.fn_saas_state_project()
returns trigger language plpgsql security definer set search_path='' as $f03_t01$
declare v_target text;
begin
  if coalesce(current_setting('app.conversation_transition', true), '') = '1' then
    return null;
  end if;
  v_target := public.fn_saas_state_from_legacy(new.status);
  if v_target is null or v_target = new.saas_state then
    return null;
  end if;
  update public.conversations
     set saas_state = v_target, saas_state_entered_at = clock_timestamp()
   where id = new.id;
  return null;
end
$f03_t01$;

drop trigger if exists trg_saas_state_project on public.conversations;
create trigger trg_saas_state_project after update of status on public.conversations
  for each row execute function public.fn_saas_state_project();

-- Filtro do inbox por estado (F03-T09) sempre entra com o tenant à frente.
create index if not exists idx_conversations_saas_state
  on public.conversations (organization_id, saas_state);

comment on column public.conversations.saas_state is
  'Estado D16 (DIRETRIZ §5.6). Escrito por src/conversation/transition.ts ou projetado de status pelo trg_saas_state_project; o status herdado permanece a autoridade do ciclo legado.';
comment on column public.conversations.saas_state_entered_at is
  'Instante da última mudança de saas_state; base das guardas de inatividade e arquivamento.';
comment on function public.fn_saas_state_from_legacy(text) is
  'Mapa total status legado -> estado D16 (ADR-016); espelho SQL de src/conversation/state-map.ts.';
comment on function public.fn_saas_state_project() is
  'Projeta escrita legada de status em saas_state; silencia quando app.conversation_transition=1.';

do $f03_t01$
declare
  v_col integer;
  v_notnull integer;
begin
  select count(*) into v_col from information_schema.columns
   where table_schema='public' and table_name='conversations'
     and column_name in ('saas_state','saas_state_entered_at');
  if v_col <> 2 then
    raise exception 'F03-T01 não criou as duas colunas de estado (achou %)', v_col;
  end if;
  select count(*) into v_notnull from information_schema.columns
   where table_schema='public' and table_name='conversations'
     and column_name in ('saas_state','saas_state_entered_at')
     and is_nullable='NO';
  if v_notnull <> 2 then
    raise exception 'F03-T01 deixou coluna de estado anulável (% de 2 not null)', v_notnull;
  end if;
  if not exists(select 1 from pg_constraint
    where conrelid='public.conversations'::regclass
      and conname='conversations_saas_state_check') then
    raise exception 'F03-T01 não instalou conversations_saas_state_check';
  end if;
  if not exists(select 1 from pg_constraint
    where conrelid='public.conversations'::regclass
      and conname='conversations_status_check') then
    raise exception 'F03-T01 removeu o CHECK herdado conversations_status_check';
  end if;
  if not exists(select 1 from pg_trigger
    where tgrelid='public.conversations'::regclass
      and tgname='trg_saas_state_project' and not tgisinternal) then
    raise exception 'F03-T01 não instalou trg_saas_state_project';
  end if;
  if exists(select 1 from pg_tables where schemaname='public'
    and tablename='conversations' and not rowsecurity) then
    raise exception 'F03-T01 desligou a RLS herdada de conversations';
  end if;
end
$f03_t01$;

alter function public.fn_saas_state_from_legacy(text) owner to postgres;
alter function public.fn_saas_state_project() owner to postgres;
revoke execute on function public.fn_saas_state_from_legacy(text)
  from public,anon,authenticated;
revoke execute on function public.fn_saas_state_project() from public,anon,authenticated;
grant execute on function public.fn_saas_state_from_legacy(text) to service_role;
grant execute on function public.fn_saas_state_project() to service_role;

notify pgrst,'reload schema';
