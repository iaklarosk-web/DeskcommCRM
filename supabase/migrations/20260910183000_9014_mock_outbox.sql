-- F03-T02 — a caixa de saída do modo mock (D12, ADR-017 decisão 1).
-- Timestamp criado pelo Supabase CLI; arquivo aplicado é imutável.
--
-- `WHATSAPP_MODE=mock` existe para que NENHUMA mensagem saia para pessoa real
-- durante a construção e o `verify.sh` (que força o modo). Sem uma tabela, o
-- caminho de saída ficaria sem prova: "não enviou" e "enviou e ninguém viu"
-- seriam indistinguíveis. Cada envio do adapter mock (src/channels/mock.ts)
-- grava UMA linha aqui, dentro de `withTenant(ctx)`.
--
-- É tabela `service_only` (D35): RLS ligada, ZERO policies, nenhum privilégio
-- para anon/authenticated. Ela é instrumento de verificação, não dado de
-- usuário — e um instrumento que o navegador lê é um instrumento que o
-- navegador pode escrever.
--
-- A idempotência é do ÍNDICE, não do código: `(organization_id,
-- idempotency_key)` único é o que faz o reenvio virar `do nothing` em vez de
-- uma segunda mensagem. Provar isso em TypeScript provaria o dublê.

create table if not exists public.mock_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid,
  to_e164 text,
  body text,
  idempotency_key text not null,
  created_at timestamptz not null default now()
);

-- Dedup ANTES do índice único: numa base que já tivesse a tabela sem o índice,
-- `create unique index` falharia no meio da migration e deixaria o schema pela
-- metade. Mantém a linha mais ANTIGA de cada par — é a do primeiro envio, e a
-- que a conversa realmente viu.
delete from public.mock_outbox a
 using public.mock_outbox b
 where a.organization_id = b.organization_id
   and a.idempotency_key = b.idempotency_key
   and (a.created_at, a.id) > (b.created_at, b.id);

create unique index if not exists mock_outbox_org_idempotency_unique
  on public.mock_outbox (organization_id, idempotency_key);

create index if not exists mock_outbox_org_created_idx
  on public.mock_outbox (organization_id, created_at desc);

alter table public.mock_outbox enable row level security;

comment on table public.mock_outbox is
  'Caixa de saída do modo mock (D12). service_only: RLS ligada, zero policies, só service_role. Uma linha por envio; única por (organization_id, idempotency_key).';
comment on column public.mock_outbox.idempotency_key is
  'Chave do envio. O provider_message_id do mock é DERIVADO dela (sha256 de organization_id:chave), por isso não é coluna: guardar um derivado permitiria que ele divergisse da fórmula.';

revoke all on public.mock_outbox from public,anon,authenticated,service_role;
grant all on public.mock_outbox to service_role;

-- Releitura do catálogo DEPOIS do revoke/grant — antes dele a checagem de
-- privilégio mediria o estado que a própria migration ainda ia corrigir, e num
-- projeto Supabase (que tem `alter default privileges … grant all on tables to
-- anon`) ela reprovaria a tabela recém-criada por um grant que some duas linhas
-- acima.
do $f03_t02$
declare
  v_policies integer;
  v_anon integer;
  v_auth integer;
  v_service integer;
begin
  if not exists(select 1 from pg_tables
    where schemaname='public' and tablename='mock_outbox') then
    raise exception 'F03-T02 não criou public.mock_outbox';
  end if;
  if exists(select 1 from pg_tables where schemaname='public'
    and tablename='mock_outbox' and not rowsecurity) then
    raise exception 'F03-T02 criou mock_outbox sem RLS';
  end if;
  select count(*) into v_policies from pg_policies
   where schemaname='public' and tablename='mock_outbox';
  if v_policies <> 0 then
    raise exception 'mock_outbox é service_only (D35) e apareceu com % policy(ies)', v_policies;
  end if;
  if not exists(select 1 from pg_indexes where schemaname='public'
    and tablename='mock_outbox' and indexname='mock_outbox_org_idempotency_unique') then
    raise exception 'F03-T02 não instalou mock_outbox_org_idempotency_unique';
  end if;
  if not exists(select 1 from pg_constraint
    where conrelid='public.mock_outbox'::regclass and contype='f' and convalidated) then
    raise exception 'mock_outbox sem FK validada para organizations';
  end if;
  select count(*) into v_anon from pg_class c,
    aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
   where c.oid='public.mock_outbox'::regclass and a.grantee='anon'::regrole;
  select count(*) into v_auth from pg_class c,
    aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
   where c.oid='public.mock_outbox'::regclass and a.grantee='authenticated'::regrole;
  if v_anon <> 0 or v_auth <> 0 then
    raise exception 'mock_outbox exposta: anon=% authenticated=% privilégio(s)', v_anon, v_auth;
  end if;
  select count(*) into v_service from pg_class c,
    aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
   where c.oid='public.mock_outbox'::regclass and a.grantee='service_role'::regrole;
  if v_service = 0 then
    raise exception 'mock_outbox sem privilégio para service_role — o adapter mock não escreveria';
  end if;
end
$f03_t02$;

notify pgrst,'reload schema';
