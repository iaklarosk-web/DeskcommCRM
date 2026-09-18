-- F14-T05 — a sessão do visitante do chat do site entra na cascata da LGPD
-- (ADR-038 §3; achado do gate f14-gate-01, régua
-- tests/invariants/lgpd-cascata-alcanca-quem-guarda-pessoa). Timestamp criado à
-- mão na sequência da 9030; arquivo aplicado é imutável.
--
-- `webchat_sessions` (9030) guarda nome, e-mail/telefone, user-agent e URL da
-- página do visitante e aponta para `contacts` — dado de pessoa fora da
-- cascata: anonimizar o contato devolvia SUCESSO e a sessão continuava legível.
-- TRIGGER na transição `is_anonymized false → true` de `contacts`, e não um passo
-- dentro de `fn_lgpd_cascade_redact_contact`, pelo mesmo motivo das migrations
-- 0174/0184/0210: aquela função vem do dump com ~180 linhas e um passo novo
-- obrigaria a carregar uma cópia inteira dela no apêndice. O gancho alcança
-- QUALQUER caminho que anonimize um contato, na mesma transação.
--
-- O que é PRESERVADO: `ip_hash` (hash com sal, é o freio por IP — não é dado
-- legível), `identified_at`, `created_at`, `last_seen_at` e o vínculo com a
-- conversa (que a cascata já redige). Que houve uma sessão, e quando, é
-- registro de operação.
--
-- Par obrigatório (D08): este arquivo + apêndice byte-fiel no baseline, ANTES
-- do bloco da varredura de anon (a função nasce aqui e o bloco final revoga o
-- EXECUTE de anon em quem ATUALIZA). Prova:
-- tests/invariants/f14-t00-webchat-sessions-service-only.test.ts (anonimizar
-- o contato apaga nome/contato/user-agent/URL da sessão, 4/4) e a régua da
-- cascata volta a verde sem dívida declarada.

create or replace function public.fn_redigir_sessoes_do_site_do_contato_anonimizado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.webchat_sessions
     set visitor_name    = null,
         visitor_contact = null,
         user_agent      = null,
         page_url        = null
   where organization_id = new.organization_id
     and contact_id = new.id;
  return new;
end;
$$;

revoke execute on function public.fn_redigir_sessoes_do_site_do_contato_anonimizado() from public, anon, authenticated;

drop trigger if exists trg_redigir_sessoes_do_site_ao_anonimizar on public.contacts;
create trigger trg_redigir_sessoes_do_site_ao_anonimizar
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized is true and old.is_anonymized is distinct from true)
  execute function public.fn_redigir_sessoes_do_site_do_contato_anonimizado();

-- A coerência da identificação (9030) exige nome + contato quando `identified_at`
-- não é nulo: a redação zera os dois, então o CHECK precisa aceitar a sessão
-- identificada e REDIGIDA — o carimbo fica (houve identificação), o dado sai.
alter table public.webchat_sessions drop constraint if exists webchat_sessions_identificacao_coerente;
alter table public.webchat_sessions
  add constraint webchat_sessions_identificacao_coerente check (
    (identified_at is null and contact_id is null)
    or (identified_at is not null and contact_id is not null
        and (
          (char_length(btrim(coalesce(visitor_name, ''))) > 0 and char_length(btrim(coalesce(visitor_contact, ''))) > 0)
          or (visitor_name is null and visitor_contact is null)
        ))
  );

comment on column public.webchat_sessions.visitor_name is
  'Nome que o visitante deu ao se identificar; NULL depois da anonimização do contato (trg_redigir_sessoes_do_site_ao_anonimizar, 9031).';

do $f14_t05_fim$
begin
  if not exists (
    select 1 from pg_trigger where tgrelid = 'public.contacts'::regclass and tgname = 'trg_redigir_sessoes_do_site_ao_anonimizar'
  ) then
    raise exception 'trg_redigir_sessoes_do_site_ao_anonimizar não existe';
  end if;
end
$f14_t05_fim$;

notify pgrst, 'reload schema';
