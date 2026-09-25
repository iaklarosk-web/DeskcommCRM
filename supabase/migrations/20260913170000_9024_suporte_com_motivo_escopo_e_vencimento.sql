-- F11-T02 — o acompanhamento (suporte) ganha MOTIVO, ESCOPO e vencimento
-- escolhido, e passa a nascer só leitura pelo caminho SaaS (D39, D51;
-- ADR-030 §4). Timestamp criado à mão na sequência da 9023; arquivo aplicado é
-- imutável.
--
-- ─── O que nasce aqui ──────────────────────────────────────────────────────
--
-- 1. `platform_support_sessions.reason` (10–500) e `.scope` (enum fechado
--    `all`, `inbox`, `crm`, `settings`, `billing`; default `all`). `reason`
--    aceita NULL só pelas sessões ANTIGAS (a coluna nasce numa tabela com
--    histórico); toda sessão nova por `fn_start_support_saas` o exige.
--
-- 2. `fn_start_support_saas(p_actor, p_session, p_org, p_previous, p_reason,
--    p_scope, p_ttl)` — chama a `fn_start_support` herdada (que reconfirma
--    sessão, autoridade, MFA e TTL ≤ 3600) com o modo FORÇADO em
--    `support_readonly`, e grava motivo e escopo na linha. Não duplica a
--    validação: reusa. `full` continua existindo no enum para o kit herdado;
--    nenhuma sessão nova desta base nasce `full`.
--
-- 3. `fn_support_context()` passa a devolver `reason` e `scope` — é o que o
--    banner mostra e o que o guarda de rota lê para negar rota fora do escopo.
--    Redefinida por `create or replace`, mesma assinatura, corpo idêntico ao
--    anterior mais os dois campos.
--
-- Par obrigatório (D08): este arquivo + apêndice byte-fiel no baseline, ANTES
-- do bloco da varredura de anon, que é o último. Função nova em `public` leva
-- `revoke execute … from public, anon` (AGENTS.md §0).

-- ---------------------------------------------------------------------------
-- 1 · motivo e escopo
-- ---------------------------------------------------------------------------

alter table public.platform_support_sessions
  add column if not exists reason text,
  add column if not exists scope text not null default 'all';

do $f11_t02_checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'platform_support_sessions_reason_check'
                    and conrelid = 'public.platform_support_sessions'::regclass) then
    alter table public.platform_support_sessions
      add constraint platform_support_sessions_reason_check
      check (reason is null or char_length(btrim(reason)) between 10 and 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'platform_support_sessions_scope_check'
                    and conrelid = 'public.platform_support_sessions'::regclass) then
    alter table public.platform_support_sessions
      add constraint platform_support_sessions_scope_check
      check (scope in ('all', 'inbox', 'crm', 'settings', 'billing'));
  end if;
end
$f11_t02_checks$;

comment on column public.platform_support_sessions.reason is
  'Motivo do acompanhamento (D39): obrigatório em toda sessão nova (fn_start_support_saas); NULL só em sessões anteriores à 9024.';
comment on column public.platform_support_sessions.scope is
  'Escopo do acompanhamento (ADR-030 §4): all | inbox | crm | settings | billing. O guarda de rota nega rota fora do escopo (403 support_scope).';

-- ---------------------------------------------------------------------------
-- 2 · início do suporte pelo caminho SaaS: só leitura, com motivo e escopo
-- ---------------------------------------------------------------------------

create or replace function public.fn_start_support_saas(
  p_actor uuid, p_session uuid, p_org uuid, p_previous uuid,
  p_reason text, p_scope text, p_ttl integer default 3600
) returns uuid language plpgsql security definer set search_path = public as $f$
declare v_id uuid;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 or char_length(btrim(p_reason)) > 500 then
    raise exception 'support_reason_required';
  end if;
  if p_scope is null or p_scope not in ('all', 'inbox', 'crm', 'settings', 'billing') then
    raise exception 'support_scope_invalid';
  end if;
  -- Reusa a validação herdada (sessão, autoridade, MFA, alvo ativo, saída
  -- pendente, TTL ≤ 3600) com o modo FORÇADO em só leitura.
  v_id := public.fn_start_support(p_actor, p_session, p_org, p_previous, 'support_readonly', p_ttl);
  update public.platform_support_sessions
     set reason = btrim(p_reason), scope = p_scope
   where id = v_id;
  return v_id;
end $f$;
revoke all on function public.fn_start_support_saas(uuid, uuid, uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.fn_start_support_saas(uuid, uuid, uuid, uuid, text, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3 · o contexto do suporte carrega motivo e escopo
-- ---------------------------------------------------------------------------

create or replace function public.fn_support_context()
returns jsonb language sql stable security definer set search_path = public as $f$
 select jsonb_build_object('id', s.id, 'organization_id', s.organization_id,
 'actor_user_id', s.actor_user_id, 'auth_session_id', s.auth_session_id,
 'previous_organization_id', s.previous_organization_id, 'expires_at', s.expires_at,
 'name', o.display_name, 'locale', o.locale,
 'reason', s.reason, 'scope', s.scope,
 'access_mode', case when s.access_mode = 'support_readonly' or p.scope <> 'full'
 then 'support_readonly' else 'full' end,
 'status', case when s.expires_at <= now() then 'expired'
 when p.user_id is null or a.id is null or (a.not_after is not null and a.not_after <= now())
 or o.status <> 'active' then 'revoked'
 when (p.mfa_required or exists(select 1 from auth.mfa_factors f where f.user_id=s.actor_user_id and f.status='verified'))
 and coalesce(auth.jwt()->>'aal','aal1') <> 'aal2' then 'revoked'
 else 'active' end)
 from public.platform_support_sessions s
 join public.organizations o on o.id=s.organization_id
 left join public.platform_admins p on p.user_id=s.actor_user_id and p.revoked_at is null
 left join auth.sessions a on a.id=s.auth_session_id and a.user_id=s.actor_user_id
 where s.actor_user_id=auth.uid()
 and s.auth_session_id=nullif(auth.jwt()->>'session_id','')::uuid and s.ended_at is null
 limit 1;
$f$;
revoke all on function public.fn_support_context() from public, anon;
grant execute on function public.fn_support_context() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4 · A migration termina lendo o que afirmou
-- ---------------------------------------------------------------------------

do $f11_t02_fim$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                    and table_name = 'platform_support_sessions' and column_name = 'reason') then
    raise exception 'platform_support_sessions.reason não existe';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                    and table_name = 'platform_support_sessions' and column_name = 'scope') then
    raise exception 'platform_support_sessions.scope não existe';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'fn_start_support_saas') then
    raise exception 'fn_start_support_saas não existe';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'fn_start_support_saas'
                and has_function_privilege('anon', p.oid, 'execute')) then
    raise exception 'fn_start_support_saas executável por anon';
  end if;
  if position('''reason'', s.reason' in pg_get_functiondef('public.fn_support_context()'::regprocedure)) = 0 then
    raise exception 'fn_support_context não devolve reason';
  end if;
end
$f11_t02_fim$;

notify pgrst, 'reload schema';
