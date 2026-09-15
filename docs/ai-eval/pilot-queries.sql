-- docs/ai-eval/pilot-queries.sql — F07-T08 (§7.8, §3.3, D27)
--
-- Uma consulta por medida de D27 que SAI DO BANCO (três) mais uma de apoio.
-- Cada uma devolve UMA linha, com o denominador ao lado do número (D24, G-03).
-- As outras três medidas de D27 — pedidos perdidos por esquecimento, duração
-- do piloto e critério de invalidação — não saem de SQL e ficam com o
-- proprietário (§3.3, §8.6): nada aqui as inventa.
--
-- Como rodar (staging desta VPS; a senha vem do env de segredos, nunca daqui):
--   psql "postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:56422/postgres" \
--     -v tenant=deka -v dias=7 -f docs/ai-eval/pilot-queries.sql
-- Parâmetros: :tenant (slug da organização; o piloto é o deka) e :dias
-- (janela em dias correntes, contada até agora). O período é explícito na
-- linha de saída — sem período, número de "por dia" não significa nada.
--
-- Mensagens de WhatsApp = linhas de `messages` (canal do provedor, direção
-- `inbound`/`outbound`) da organização; `provider` diz por onde entrou
-- (`mock` no staging; `waha` em operação real).

\set ON_ERROR_STOP on

-- medida: mensagens_por_dia
-- Mensagens de WhatsApp (entrada + saída) por dia corrente, na janela.
select
  :'tenant'                                         as tenant,
  :dias                                             as janela_dias,
  count(*)                                          as mensagens,
  count(*) filter (where m.direction = 'inbound')   as recebidas,
  count(*) filter (where m.direction = 'outbound')  as enviadas,
  round(count(*)::numeric / greatest(:dias, 1), 2)  as mensagens_por_dia,
  string_agg(distinct coalesce(m.provider, 'n/a'), ',') as provedores
from public.messages m
join public.organizations o on o.id = m.organization_id
where o.slug = :'tenant'
  and m.created_at >= now() - make_interval(days => :dias);

-- medida: conversas_resolvidas_sem_handoff
-- Conversas criadas na janela que chegaram a `resolved`/`archived` (D16) SEM
-- nenhum registro em `handoffs`, sobre o total de conversas criadas na janela.
-- Numerador e denominador na mesma linha; percentual só ao lado deles.
with janela as (
  select c.id, c.saas_state
  from public.conversations c
  join public.organizations o on o.id = c.organization_id
  where o.slug = :'tenant'
    and c.created_at >= now() - make_interval(days => :dias)
)
select
  :'tenant'                                                        as tenant,
  :dias                                                            as janela_dias,
  count(*)                                                         as conversas,
  count(*) filter (where j.saas_state in ('resolved', 'archived'))  as resolvidas,
  count(*) filter (where j.saas_state in ('resolved', 'archived')
                     and not exists (select 1 from public.handoffs h where h.conversation_id = j.id)) as resolvidas_sem_handoff,
  case when count(*) = 0 then null
       else round(100.0 * count(*) filter (where j.saas_state in ('resolved', 'archived')
                     and not exists (select 1 from public.handoffs h where h.conversation_id = j.id)) / count(*), 1)
  end                                                              as pct_resolvidas_sem_handoff
from janela j;

-- medida: pedidos_pj_via_whatsapp
-- Pedidos de empresa (PJ = `company_id` preenchido, D22/D46) criados na
-- janela pelo canal `whatsapp` (é o que `create_order` da IA grava,
-- src/actions/tools/pedido.ts), sobre o total de pedidos PJ criados na janela.
-- "Semanais" de §3.3 é a janela pedida em :dias (7 para uma semana).
with pj as (
  select p.channel, p.source
  from public.crm_orders p
  join public.organizations o on o.id = p.organization_id
  where o.slug = :'tenant'
    and p.company_id is not null
    and p.status <> 'cancelled'
    and p.created_at >= now() - make_interval(days => :dias)
)
select
  :'tenant'                                                  as tenant,
  :dias                                                      as janela_dias,
  count(*)                                                   as pedidos_pj,
  count(*) filter (where channel = 'whatsapp')               as pedidos_pj_via_whatsapp,
  count(*) filter (where channel = 'whatsapp' and source = 'ai') as dos_quais_pela_ia,
  case when count(*) = 0 then null
       else round(100.0 * count(*) filter (where channel = 'whatsapp') / count(*), 1)
  end                                                        as pct_via_whatsapp
from pj;

-- medida: handoffs_por_motivo (apoio)
-- Não é medida de D27: diz POR QUE a IA passou a mão (enum D19), para ler a
-- medida anterior. Uma linha, com o total e a distribuição por motivo.
with h as (
  select h.conversation_id, h.reason
  from public.handoffs h
  join public.organizations o on o.id = h.organization_id
  where o.slug = :'tenant'
    and h.created_at >= now() - make_interval(days => :dias)
), motivos as (
  select reason, count(*) as n from h group by reason
)
select
  :'tenant'                                           as tenant,
  :dias                                               as janela_dias,
  (select count(*) from h)                            as handoffs,
  (select count(distinct conversation_id) from h)     as conversas_com_handoff,
  (select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb) from motivos) as por_motivo;
