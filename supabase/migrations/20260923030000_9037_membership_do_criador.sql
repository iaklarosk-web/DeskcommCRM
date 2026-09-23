-- 9037 — F20-T04 (ADR-045 §5; D60): criar empresa para OUTRA pessoa não deixa o
-- criador dentro dela.
--
-- POR QUÊ. `fn_create_tenant_with_owner` inseria a membership do ator sem
-- condição: quem cria a empresa virava admin definitivo dela, com escrita, sem
-- motivo, sem prazo e sem aparecer como suporte na auditoria — uma porta
-- lateral sobre o acompanhamento só-leitura que a F11/D51 desenhou (motivo de
-- 10–500 chars, escopo, vencimento de 1–60 min). Medido em 22/09/2026: o
-- proprietário era `admin` aceito nas três organizações da produção.
--
-- O QUE MUDA. Um `if`: a membership nasce quando `owner_email` é o e-mail do
-- ator (comparado sem caixa e sem espaços). Para outra pessoa, a empresa nasce
-- ativa, com assinatura (F11-T03) e convite pendente, e ZERO membros.
--
-- ORDEM (D60 b): esta migration só entra DEPOIS da ação de convite no `/admin`
-- (F20-T03) — sem ela, um convite que vencesse sem aceite deixaria a
-- organização órfã, porque o suporte é só-leitura e `POST /api/v1/team/invite`
-- nega escrita durante acompanhamento.
--
-- Organizações EXISTENTES não mudam (D60 c). Aditiva e idempotente
-- (`create or replace`). Prova em
-- tests/invariants/f20-t04-membership-do-criador.test.ts, no mesmo commit.
begin;

create or replace function public.fn_create_tenant_with_owner(
  p_actor uuid, p_key uuid, p_request jsonb, p_hash text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  prior public.idempotency_keys%rowtype;
  org public.organizations%rowtype;
  result jsonb;
begin
  if not exists (select 1 from public.platform_admins where user_id = p_actor
    and revoked_at is null and scope = 'full') then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':' || p_key::text, 0));
  select * into prior from public.idempotency_keys
    where key = p_key::text and endpoint = '/api/v1/admin/tenants:' || p_actor::text
      and expires_at > now() and tenant_creation_trusted;
  if found then
    if prior.request_hash <> decode(p_hash, 'hex') then
      raise exception 'idempotency_conflict' using errcode = '22023';
    end if;
    if prior.response_body->>'id' is distinct from prior.organization_id::text
      or not exists (select 1 from public.organizations where id = prior.organization_id and created_by = p_actor) then
      raise exception 'idempotency_provenance_invalid' using errcode = '22023';
    end if;
    return prior.response_body || jsonb_build_object('created', false);
  end if;
  insert into public.organizations(display_name, slug, legal_name, cnpj, status, settings, created_by)
    values (p_request->>'display_name', p_request->>'slug', coalesce(nullif(p_request->>'legal_name', ''), p_request->>'display_name'),
      p_request->>'cnpj', 'active', jsonb_build_object('plan', p_request->>'plan'), p_actor)
    returning * into org;
  -- F20-T04 (ADR-045 §5; D60): a membership do criador nasce SÓ quando o
  -- convite é para ele mesmo. Para outra pessoa, a empresa nasce com
  -- assinatura e convite pendente e ZERO membros — o acesso do dono da
  -- plataforma volta a ser a sessão de suporte de D51, com motivo, escopo e
  -- vencimento. Antes, esta linha rodava sem condição e fazia do
  -- `platform_admin` admin definitivo de toda empresa que ele criasse, fora do
  -- acompanhamento auditado (VARREDURA §B28).
  if lower(btrim(coalesce(p_request->>'owner_email', ''))) =
     (select lower(btrim(email)) from auth.users where id = p_actor) then
    insert into public.user_organizations(organization_id, user_id, role, accepted_at, interface_settings)
      values (org.id, p_actor, 'admin', now(),
        coalesce(p_request->'owner_interface_settings', '{"preset":"completa"}'::jsonb));
  end if;
  result := jsonb_build_object('id', org.id, 'slug', org.slug, 'display_name', org.display_name,
    'invite_id', gen_random_uuid(), 'issued_at', floor(extract(epoch from now()))::bigint);
  insert into public.idempotency_keys(organization_id, key, endpoint, request_hash, status_code, response_body, tenant_creation_trusted)
    values (org.id, p_key::text, '/api/v1/admin/tenants:' || p_actor::text,
      decode(p_hash, 'hex'), 201, result, true);
  return result || jsonb_build_object('created', true);
end $$;

do $f20_t04_fim$
begin
  if to_regprocedure('public.fn_create_tenant_with_owner(uuid, uuid, jsonb, text)') is null then
    raise exception '9037: fn_create_tenant_with_owner ausente';
  end if;
  if position('owner_email' in pg_get_functiondef('public.fn_create_tenant_with_owner(uuid, uuid, jsonb, text)'::regprocedure)) = 0 then
    raise exception '9037: a função não compara owner_email — a membership do criador voltaria a ser incondicional';
  end if;
end
$f20_t04_fim$;

commit;
