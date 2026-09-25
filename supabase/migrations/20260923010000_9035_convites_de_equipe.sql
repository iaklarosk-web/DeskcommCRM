-- 9035 — F20-T01 (ADR-045 §1; D59, D61): o convite de equipe vira LINHA.
--
-- POR QUÊ. O convite era um token stateless: e-mail, organização, papel,
-- `interface_settings`, `invited_by` e prazos assinados dentro da própria URL
-- (`lib/auth/issue-invite.ts`). Três consequências medidas em 22/09/2026:
-- (1) a URL tem 559 caracteres e o WhatsApp não a torna clicável — quem recebe
-- não consegue entrar (VARREDURA §B27); (2) sem linha não há REVOGAÇÃO: um link
-- encaminhado vale até expirar e ninguém consegue cancelar; (3) sem linha não há
-- lista de pendentes — quem fechou a tela de criação do tenant perdeu o convite.
--
-- O QUE MUDA. Tabela nova `team_invites`, service_only (D35): o `token` É a
-- credencial do convite e não pode ser legível pelo PostgREST com a anon key.
-- O índice único PARCIAL (`where accepted_at is null and revoked_at is null`)
-- é o que faz "reenviar revoga o anterior" (D61 b) ser garantia do BANCO —
-- um convite vivo por pessoa por organização, com `lower(email)` para que
-- caixa alta não abra uma segunda porta. Estados coerentes por CHECK: aceito
-- exige quem aceitou, revogado exige motivo do vocabulário fechado, e nenhuma
-- linha pode estar aceita E revogada.
--
-- O e-mail tem prazo (D61 d): a aplicação o apaga no aceite (o vínculo passa a
-- ser `accepted_by`) e o cron `data-retention` remove a linha morta 30 dias
-- depois. A cascata da LGPD do produto é disparada por anonimização de CONTATO
-- e não alcança convite de equipe — o titular aqui é outro (ADR-045 §3).
--
-- Aditiva e idempotente. Prova comportamental em
-- tests/invariants/f20-t01-team-invites-schema.test.ts, no mesmo commit.
begin;

create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  token text not null,
  email text not null,
  role text not null,
  interface_settings jsonb not null default '{"preset":"completa"}'::jsonb,
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 16 chars base64url = 96 bits: rota pública com teto de 60 tentativas por
  -- IP/hora torna varredura inviável; token curto seria convite adivinhável.
  constraint team_invites_token_check check (token ~ '^[A-Za-z0-9_-]{16,64}$'),
  constraint team_invites_email_check check (char_length(btrim(email)) > 0 and email = lower(email)),
  constraint team_invites_role_check check (role in ('viewer', 'agent', 'manager', 'admin')),
  constraint team_invites_settings_objeto check (jsonb_typeof(interface_settings) = 'object'),
  constraint team_invites_revoked_reason_check check (revoked_reason is null or revoked_reason in ('manual', 'reenviado')),
  constraint team_invites_aceite_coerente check ((accepted_at is null) = (accepted_by is null)),
  constraint team_invites_revogacao_coerente check ((revoked_at is null) = (revoked_reason is null)),
  constraint team_invites_nao_aceito_e_revogado check (accepted_at is null or revoked_at is null)
);

create unique index if not exists team_invites_token_uk on public.team_invites (token);
-- O índice do "um vivo por pessoa": aceito ou revogado sai do caminho e a mesma
-- pessoa pode ser convidada de novo.
create unique index if not exists team_invites_um_vivo_por_email
  on public.team_invites (organization_id, lower(email))
  where accepted_at is null and revoked_at is null;
create index if not exists team_invites_pendentes_idx
  on public.team_invites (organization_id, created_at desc)
  where accepted_at is null and revoked_at is null;

comment on table public.team_invites is
  'Convite de equipe com ciclo de vida (F20, D59/D61): token curto (a URL /i/<token>), prazo de 7 dias, aceite único e revogação. service_only — o token é credencial.';
comment on index public.team_invites_um_vivo_por_email is
  'Um convite VIVO por pessoa por organização: é este índice que faz reenviar revogar o anterior (D61 b).';

drop trigger if exists team_invites_updated_at on public.team_invites;
create trigger team_invites_updated_at before update on public.team_invites
  for each row execute function public.fn_set_updated_at();

-- service_only (D35): RLS ligada, zero policies, nada para anon/authenticated.
alter table public.team_invites enable row level security;
revoke all on public.team_invites from public;
do $f20_t01_revoke$
begin
  if to_regrole('anon') is not null then execute 'revoke all on public.team_invites from anon'; end if;
  if to_regrole('authenticated') is not null then execute 'revoke all on public.team_invites from authenticated'; end if;
  if to_regrole('service_role') is not null then execute 'grant all on public.team_invites to service_role'; end if;
end
$f20_t01_revoke$;

-- Expurgo do convite MORTO (D61 d): aceito, revogado ou vencido há mais de
-- `p_dias` sai do banco. O convite vivo nunca é tocado, e o aceito já teve o
-- e-mail apagado pela aplicação — o que sobra aqui é a linha, não a pessoa.
-- Em LOTES, como as irmãs (`fn_podar_fila_de_jobs`, `fn_expurgar_nonces_de_oauth`):
-- um DELETE grande trava a tabela num banco de cliente.
create or replace function public.fn_expurgar_convites_mortos(p_dias int, p_lote int default 500)
returns int
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn_expurgar_convites_mortos$
declare
  v_removidos int;
begin
  -- Piso no CORPO, como as irmãs: chamador que passe 0 não apaga convite que
  -- acabou de morrer e ainda serve de histórico para quem investiga um acesso.
  if p_dias is null or p_dias < 1 then
    p_dias := 1;
  end if;

  with alvo as (
    select id
      from public.team_invites
     where (accepted_at is not null and accepted_at < now() - make_interval(days => p_dias))
        or (revoked_at is not null and revoked_at < now() - make_interval(days => p_dias))
        or (accepted_at is null and revoked_at is null and expires_at < now() - make_interval(days => p_dias))
     limit greatest(p_lote, 1)
  )
  delete from public.team_invites t
   using alvo
   where t.id = alvo.id;

  get diagnostics v_removidos = row_count;
  return v_removidos;
end
$fn_expurgar_convites_mortos$;

revoke execute on function public.fn_expurgar_convites_mortos(int, int) from public, anon, authenticated;
grant execute on function public.fn_expurgar_convites_mortos(int, int) to service_role;

comment on function public.fn_expurgar_convites_mortos(int, int) is
  'F20-T01 (D61 d): apaga em lotes o convite aceito, revogado ou vencido há mais de p_dias. O convite vivo nunca é tocado.';

-- A migration termina lendo o que afirmou.
do $f20_t01_fim$
declare
  v_policies integer;
  v_nome text;
begin
  select count(*) into v_policies from pg_policies where schemaname = 'public' and tablename = 'team_invites';
  if v_policies <> 0 then
    raise exception '9035: team_invites é service_only e ganhou % policies', v_policies;
  end if;
  if not exists (select 1 from pg_class where oid = 'public.team_invites'::regclass and relrowsecurity) then
    raise exception '9035: team_invites sem RLS ligada';
  end if;
  if exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
              where c.oid = 'public.team_invites'::regclass
                and a.grantee in ('anon'::regrole, 'authenticated'::regrole)) then
    raise exception '9035: team_invites com privilégio a anon/authenticated — D35 exige service_only';
  end if;
  foreach v_nome in array array['team_invites_token_uk', 'team_invites_um_vivo_por_email', 'team_invites_pendentes_idx'] loop
    if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = v_nome) then
      raise exception '9035: índice % ausente', v_nome;
    end if;
  end loop;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'team_invites_um_vivo_por_email'
                   and indexdef like '%accepted_at IS NULL%' and indexdef like '%revoked_at IS NULL%') then
    raise exception '9035: team_invites_um_vivo_por_email não é PARCIAL — aceito/revogado bloquearia convite novo';
  end if;
  if to_regprocedure('public.fn_expurgar_convites_mortos(int, int)') is null then
    raise exception '9035: fn_expurgar_convites_mortos ausente — o convite morto ficaria para sempre (D61 d)';
  end if;
end
$f20_t01_fim$;

commit;
