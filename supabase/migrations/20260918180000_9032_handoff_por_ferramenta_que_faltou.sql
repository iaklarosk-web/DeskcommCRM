-- 9032 — F18-T00 (ADR-040 §2, D56 b): o motivo de handoff `tool_missing`.
--
-- POR QUÊ. Quando o turno SaaS assume o despacho (F18), a IA passa a ter as
-- ações do catálogo, não as 60 ferramentas do MCP herdado. O agente publicado
-- pode declarar uma ferramenta que não foi migrada (41 estão na fila de espera
-- de `CRM-OS/docs/f18/FERRAMENTAS-MCP-INVENTARIO-20260918.md`). Hoje o turno
-- DESCARTA em silêncio o que está fora da lista (§5.9) — e silêncio é
-- exatamente o desfecho que a objeção 1 do contraponto proibiu: o cliente fica
-- sem resposta e ninguém fica sabendo qual ferramenta faltou.
--
-- O QUE MUDA. Um nono motivo, `tool_missing`: ferramenta DECLARADA pelo agente
-- publicado e ausente do catálogo vira handoff para humano, com o nome dela na
-- auditoria. Nome inventado pelo modelo continua descartado e contado — este
-- motivo é só para o que a organização de fato declarou.
--
-- O CHECK é reconstruído em BLOCO ÚNICO (drop + add), nunca `if not exists`:
-- a lição 26 da F14 — `add constraint if not exists` não atualiza o banco que
-- JÁ tem a constraint antiga, e o staging (que atualiza em vez de nascer)
-- ficaria com o vocabulário velho e recusaria a linha nova com 23514.
begin;

alter table public.handoffs drop constraint if exists handoffs_reason_check;
alter table public.handoffs add constraint handoffs_reason_check check (reason in (
  'customer_request','high_risk_action','low_confidence','out_of_knowledge',
  'complaint','provider_error','tenant_rule','forbidden_request','tool_missing'
));

comment on constraint handoffs_reason_check on public.handoffs is
  'Enum de NOVE valores (§5.11 + F18): os 7 gatilhos de D19, forbidden_request de §5.9 e tool_missing de ADR-040 §2 (ferramenta declarada pelo agente e não migrada). Nunca texto livre (G-78).';

commit;
