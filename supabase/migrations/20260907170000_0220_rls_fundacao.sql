-- 0220 — fundação de RLS da Fase 1 (F01-T03, DIRETRIZ §5.15, G-54).
--
-- Duas coisas, e só elas:
--
-- 1. `current_organization_id()`: a função que as policies NOVAS (F02+) usam
--    como predicado único — lê o GUC `app.organization_id` que o withTenant
--    (§5.1) injeta na transação, e na ausência dele o claim do JWT. As 162
--    policies herdadas continuam sobre `fn_user_org_ids()` — trocar o
--    predicado de 114 tabelas numa migration seria reescrever o que a prova
--    comportamental (rls-isolation) já mede; a troca, se vier, é 1 arquivo por
--    vez com a prova junto. O padrão novo vale a partir daqui.
--
-- 2. Revoke de `anon` em TODA tabela de tenant (G-54): o dump herdado trouxe
--    ~48 `GRANT ALL ... TO anon` em tabelas com organization_id. Nenhuma
--    policy do banco é específica de anon (medido em 2026-09-07: zero linhas
--    em pg_policies com roles contendo anon; as duas policies `USING (true)`
--    são de ai_models/ai_pricing, tabelas globais sem organization_id e fora
--    deste revoke) — anon já lia 0 linhas na prática; o revoke tira a única
--    coisa entre um bug de policy futuro e o vazamento. Dinâmico de propósito:
--    tabela de tenant nova que nascer com grant de anon é revogada na
--    re-aplicação, e a prova (rls-coverage) impede o retorno.
--
-- NÃO faz: `organization_id NOT NULL` nas 9 tabelas herdadas anuláveis
-- (agent_inbox_items, api_audit_log, incidents, metrics, playbook_pointers,
-- playbook_versions, skill_pointers, skill_versions, webhook_events_log) — são
-- MISTAS por desenho herdado: linha com organization_id NULL é escopo de
-- plataforma (a policy de api_audit_log trata o NULL explicitamente). Forçar
-- NOT NULL quebraria o update.sh de instalação com dados. Registrado em
-- docs/migration/target-state.md; tabela NOVA de tenant nasce NOT NULL (0219 é
-- o precedente).
--
-- Par obrigatório (D08): este arquivo + apêndice idempotente no baseline.sql.

create or replace function public.current_organization_id() returns uuid
language plpgsql stable as $$
declare
  v text;
begin
  v := nullif(current_setting('app.organization_id', true), '');
  if v is not null then
    return v::uuid;
  end if;
  -- Fora do Supabase (Postgres efêmero das provas) auth.jwt() não existe;
  -- resolução em runtime + guarda tornam a função utilizável nos dois mundos.
  begin
    v := nullif(auth.jwt() ->> 'organization_id', '');
  exception
    when undefined_function then v := null;
  end;
  return v::uuid;
end
$$;

comment on function public.current_organization_id() is
  'Tenant corrente para policies novas (§5.15): GUC app.organization_id (posto por withTenant, §5.1) ou claim organization_id do JWT. NULL = sem tenant — policy que usa esta função nega por comparação com NULL.';

revoke execute on function public.current_organization_id() from public;
revoke execute on function public.current_organization_id() from anon;
grant execute on function public.current_organization_id() to authenticated;
grant execute on function public.current_organization_id() to service_role;

-- G-54: revoga anon de toda tabela de tenant, dinamicamente.
do $$
declare
  t record;
begin
  for t in
    select g.table_name
      from information_schema.role_table_grants g
     where g.grantee = 'anon'
       and g.table_schema = 'public'
       and exists (select 1 from pg_tables pt
                    where pt.schemaname = 'public' and pt.tablename = g.table_name)
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public'
                      and c.table_name = g.table_name
                      and c.column_name = 'organization_id')
     group by g.table_name
  loop
    execute format('revoke all on table public.%I from anon', t.table_name);
  end loop;
end
$$;

-- Verificação (G-24): a migration termina lendo o que afirmou.
do $$
declare
  restantes int;
begin
  select count(distinct g.table_name) into restantes
    from information_schema.role_table_grants g
   where g.grantee = 'anon'
     and g.table_schema = 'public'
     and exists (select 1 from pg_tables pt
                  where pt.schemaname = 'public' and pt.tablename = g.table_name)
     and exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public'
                    and c.table_name = g.table_name
                    and c.column_name = 'organization_id');
  if restantes <> 0 then
    raise exception 'G-54 não cumprido: % tabela(s) de tenant ainda com grant a anon', restantes;
  end if;
  if to_regprocedure('public.current_organization_id()') is null then
    raise exception 'current_organization_id() não existe após a migration';
  end if;
end
$$;
