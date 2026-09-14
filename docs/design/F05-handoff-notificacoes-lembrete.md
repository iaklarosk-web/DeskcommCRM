# Desenho F05 — Handoff + Notificações + Recurring Reminder + uso de IA

Autoridade: `docs/DIRETRIZ.md` §5.11, §5.12, §5.16, §7.6 e D19/D23/D34.
Depende da F04 (catálogo de dez ações, turno SaaS, `ai_eval`).

## 0. O que já existe (medido)

| Fato | Evidência |
|---|---|
| Handoff idempotente com silêncio infinito e trava do contato | `lib/agent-engine/agent/human-handoff.ts:118-150` |
| Gatilhos atuais: regex PT-BR, tool do modelo, orçamento esgotado | `human-handoff.ts:54-66`; `inbound-turn.ts:286-304`; `inbound-turn.ts:564-629` |
| Resumo vem do checkpoint durável, sem chamada extra ao modelo | `inbound-turn.ts:643,648` |
| Silêncio é lido no começo de todo turno | `human-handoff.ts:89-104` |
| Aviso operacional da organização, com 18 kinds, entre eles `handoff` e `job_dead` | `supabase/baseline.sql:6453-6466` |
| Retomada humana→IA já existe e limpa `force_human` | `lib/escalacao/retomada.ts:81-232` |
| Eventos D16 de confirmação e inatividade já estão na tabela, sem executor | `src/conversation/transitions.ts` |
| `notify(job.blocked)` da F03 usa `agent_inbox_items kind='job_dead'` | ADR-017 / desenho F03 §7 |
| Não existe tabela de notificação por USUÁRIO nem e-mail transacional ligado | §5.16 lista `notifications` como nova |
| Não existe `reminder_runs` | §5.12 |

## 1. Handoff — ampliar, não substituir (T01–T04)

`performHumanHandoff` continua sendo quem executa: silêncio, `force_human`,
cancelamento de crons e item de inbox. A F05 acrescenta em volta dele:

- **Motivo como enum de 8 valores** (7 gatilhos de D19 + `forbidden_request` de
  §5.9), nunca frase (G-78). Os três gatilhos herdados viram três desses
  valores; os cinco restantes ganham detector próprio.
- **Resumo de 7 campos** (`customer`, `intent`, `summary`, `last_messages` (5),
  `pending_action`, `reason`, `suggested_next_step`), montado do checkpoint —
  não de uma chamada extra ao modelo. Erro de provedor cai em template.
- **Fila de claim**: `tenant_settings.handoff.assignment = queue` (único valor
  da Fase 1). O claim reusa `fn_conversation_assign` pela `transition()` da F03
  (`human.claimed`), então o segundo claim é rejeitado pela mesma autoridade —
  sem trava nova.
- **Guarda pós-handoff**: em `waiting_human`/`human_handling` a IA não envia.
  Já é verdade por dois caminhos (silêncio herdado e o subset de executores do
  catálogo); a F05 mede `ai_msgs_after_handoff=0` sobre H ≥ 3 handoffs com
  `msgs_after > 0` de mensagens humanas, para a prova não ser vácuo.

`resume_ai` (já no catálogo desde a F04) é a única volta, e reusa
`devolverAtendimentoAoAgente`.

## 2. Notificações (T05)

§5.16 pede seis eventos: `handoff.created`, `task.assigned`,
`confirmation.requested`, `customer.replied_while_human`, `reminder.no_reply`,
`job.blocked`.

`agent_inbox_items` é aviso **da organização**; §5.16 pede aviso **por
usuário**. Os dois coexistem: `src/notifications/notify()` grava a linha por
usuário em `notifications` (nova) e continua criando o item de organização onde
o herdado já criava — nenhum aviso existente deixa de aparecer. O `job.blocked`
da F03, hoje só item de organização, passa a emitir os dois pela mesma função:
é a consolidação que a F03 adiou por não antecipar escopo.

E-mail é mock nesta fase (`email_outbox`), com o provedor real como item humano
com custo (D12).

## 3. Recurring Reminder (T06–T08)

Tabela `reminder_runs` com unique `(organization_id, customer_id, periodo)` —
a chave de idempotência de D23. O período é derivado da configuração
`orders.recurring_reminder` em `tenant_settings` (dia da semana, hora, horas de
corte, texto), nunca de constante no código.

Três conceitos que o desenho mantém separados, porque §7.6 avisa que misturá-los
fabrica regra comercial: **timeout de ausência de resposta**, **fechamento da
produção** e **janela/data de entrega**. A chave do lembrete deduplica o
DISPARO; ela não limita o cliente a um pedido por semana.

O envio é pela ação `send_message` com executor `automation` (T07) — o mesmo
`execute()` da F03, então a prova do grep de §5.7 continua valendo. A resposta
do cliente é interpretada pelo turno SaaS e vira `update_order_quantity`
(`by_risk`, portanto confirmação do atendente).

## 4. Uso de IA na tela (T09)

Lê `ai_usage_events`, que a F04 tornou projeção única de `llm_calls`
(ADR-021). O valor exibido tem de ser `sum(ai_usage_events)` do período — a
prova compara tela com banco, nunca tela com tela.

## 5. verify.sh v1.3 (T10)

Acrescenta `handoff` e `reminder` ao bloco, pelo mesmo mecanismo de métrica por
arquivo da ADR-005. Mutantes: sem a guarda de T04 → `ai_msgs_after_handoff ≥ 1`;
sem a chave do lembrete → `duplicates = 1`.

## 6. Limites declarados

Preferências de notificação, Google Calendar, motor genérico QUANDO/SE/ENTÃO e
agenda ficam fora (D05). Provedor de e-mail real é item humano com custo.
Parâmetros do lembrete da Deka (dia, hora, corte, texto) são configuração e
serão preenchidos pela empresa ao receber acesso (D48) — a engenharia usa
fixtures fictícias e não infere regra comercial.
