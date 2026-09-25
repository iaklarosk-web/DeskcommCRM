-- 9036 — F20-T02 (ADR-045 §2; D61 b/d): o aceite do convite curto é ATÔMICO.
--
-- POR QUÊ. Com a linha de convite (9035), aceitar passa a ser três escritas:
-- validar o convite, criar a membership e marcar o convite como aceito. Em
-- passos separados, duas abas ou um duplo clique aceitam o mesmo convite duas
-- vezes, e um convite revogado ou vencido continua aceitável enquanto a
-- aplicação não olhar. Quem decide isso é o banco.
--
-- O QUE MUDA. Função nova `fn_aceitar_convite_de_equipe(p_token, p_user)`:
-- trava a linha (`for update`), recusa por motivo NOMEADO (`invite_not_found`,
-- `invite_revoked`, `invite_expired`, `invite_already_accepted`,
-- `invite_email_mismatch`), delega a membership à `fn_accept_team_invite` que
-- já existe (nada de segunda verdade sobre papel e interface) e marca o convite
-- APAGANDO o e-mail — o vínculo passa a ser `accepted_by` (D61 d).
--
-- Nenhuma tabela nova, nenhuma função herdada alterada. Prova em
-- tests/invariants/f20-t02-aceite-do-convite.test.ts, no mesmo commit.
begin;

-- O aceite APAGA o e-mail (D61 d), e a 9035 criou a coluna `not null` com CHECK
-- de conteúdo. Aqui ela passa a aceitar NULL, com a coerência que importa: quem
-- está VIVO (nem aceito nem revogado) tem de ter e-mail — é para quem o convite
-- foi feito. Aceito ou revogado pode não ter mais.
alter table public.team_invites alter column email drop not null;
alter table public.team_invites drop constraint if exists team_invites_email_check;
alter table public.team_invites add constraint team_invites_email_check
  check (email is null or (char_length(btrim(email)) > 0 and email = lower(email)));
alter table public.team_invites drop constraint if exists team_invites_vivo_tem_email;
alter table public.team_invites add constraint team_invites_vivo_tem_email
  check (accepted_at is not null or revoked_at is not null or email is not null);

create or replace function public.fn_aceitar_convite_de_equipe(p_token text, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn_aceitar_convite_de_equipe$
declare
  c public.team_invites%rowtype;
  v_email text;
  v_membership jsonb;
begin
  -- A trava é na LINHA do convite: é ela que serializa duas abas no mesmo link.
  select * into c from public.team_invites where token = p_token for update;
  if not found then
    raise exception 'invite_not_found' using errcode = '42501';
  end if;
  if c.revoked_at is not null then
    raise exception 'invite_revoked' using errcode = '42501';
  end if;
  if c.accepted_at is not null then
    raise exception 'invite_already_accepted' using errcode = '42501';
  end if;
  if c.expires_at <= now() then
    raise exception 'invite_expired' using errcode = '42501';
  end if;

  select lower(btrim(email)) into v_email from auth.users where id = p_user;
  if v_email is null or v_email <> lower(btrim(c.email)) then
    raise exception 'invite_email_mismatch' using errcode = '42501';
  end if;

  -- A membership continua sendo assunto da função herdada: papel, interface,
  -- reativação de membro revogado e idempotência já vivem lá.
  v_membership := public.fn_accept_team_invite(
    p_user, c.organization_id, c.role, c.invited_by, c.created_at, c.created_at, c.interface_settings
  );

  -- D61 (d): o e-mail sai da linha no aceite; quem responde "quem entrou" é
  -- `accepted_by`. A linha morta é expurgada depois pela retenção (9035).
  update public.team_invites
     set accepted_at = now(), accepted_by = p_user, email = null, updated_at = now()
   where id = c.id;

  return jsonb_build_object(
    'invite_id', c.id,
    'organization_id', c.organization_id,
    'membership', v_membership
  );
end
$fn_aceitar_convite_de_equipe$;

revoke all on function public.fn_aceitar_convite_de_equipe(text, uuid) from public, anon, authenticated;
grant execute on function public.fn_aceitar_convite_de_equipe(text, uuid) to service_role;

comment on function public.fn_aceitar_convite_de_equipe(text, uuid) is
  'F20-T02: aceite atômico do convite curto — trava a linha, recusa por motivo nomeado, delega a membership a fn_accept_team_invite e apaga o e-mail (D61 d).';

do $f20_t02_fim$
begin
  if to_regprocedure('public.fn_aceitar_convite_de_equipe(text, uuid)') is null then
    raise exception '9036: fn_aceitar_convite_de_equipe ausente';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'team_invites_vivo_tem_email') then
    raise exception '9036: team_invites_vivo_tem_email ausente — convite vivo poderia ficar sem destinatário';
  end if;
  if (select attnotnull from pg_attribute
       where attrelid = 'public.team_invites'::regclass and attname = 'email') then
    raise exception '9036: team_invites.email continua NOT NULL — o aceite não consegue apagá-lo (D61 d)';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, '{}'::aclitem[])) a
              where p.oid = 'public.fn_aceitar_convite_de_equipe(text, uuid)'::regprocedure
                and a.grantee in ('anon'::regrole, 'authenticated'::regrole)) then
    raise exception '9036: fn_aceitar_convite_de_equipe executável por anon/authenticated';
  end if;
end
$f20_t02_fim$;

commit;
