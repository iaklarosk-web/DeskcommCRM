# ADR-026 — Notificações por usuário e lembrete recorrente sobre o catálogo, sem abrir o domínio a automação

## Contexto

A F05-T05..T09 pede quatro coisas sobre mecanismos que já existiam em parte:
aviso por USUÁRIO para seis eventos (§5.16), quando o produto só tinha o aviso
de organização (`agent_inbox_items`) e o barramento (`event_log`); o lembrete
recorrente PJ (§5.12, D23) enviado pelo catálogo com executor `automation`,
quando `send_message` já existia mas nenhuma conversa nascia sem entrada de
cliente; a resposta do cliente virando `update_order_quantity` (§7.6 T08) e o
corte sem resposta virando "task + notificação"; e a tela de uso de IA lida de
`ai_usage_events` (§7.6 T09).

Medido nesta árvore antes das tasks:

- `authorizeCrmCommand` (`src/crm/authorization.ts:41-49`) recusa executor
  não-humano (`non_human_executor_denied`) e exige `ctx.source === "session"`;
  o tipo `TrustedCrmExecutor` já prevê `automation`, a autorização não. A
  VARREDURA-MELHORIAS §B5/§C6 registra isso como decisão do proprietário, e o
  proprietário, em 11/09/2026, a listou entre as pendências DELE.
- A tabela D16 (`src/conversation/transitions.ts`) só admite
  `automation.outbound` a partir de `resolved` e `waiting_customer`, e o caso
  "nenhuma" de §5.6 não tem linha — não há estado de origem para validar.
- `conversations` não tinha o `tags` de §5.6; `contacts.tags` é do contato e
  livre.
- `job_runs` (9016) exige `job_id` em `job_queue`, cujo `kind` é CHECK fechado.
- Toda escrita que gera aviso já acontece DENTRO de uma transação de
  `withTenant` (efeito de `transition()`, pendência de D33, worker de saída,
  serviço de tarefas). `getSetting` abre a sua própria conexão.

## Decisão

### 1. `notify(db, ctx, …)` recebe a transação; a Setting é lida nela

`src/notifications/notify.ts` escreve `notifications` (e `email_outbox` quando
`notifications.email.enabled`) com o `db` do chamador: o fato e o aviso entram
juntos ou não entram. `getSettingIn(db, ctx, key)` nasce em `tenant-config`
para ler a Setting SEM segunda conexão — o impasse de pool é o mesmo motivo do
`poolNaTransacao` de `src/channels/inbound.ts`. `notifyFora()` existe só para
o cron, que não está em transação. Os avisos herdados (`agent_inbox_items`,
`event_log`) continuam sendo escritos: `notifications` amplia, não substitui.

Destinatários, por evento (§5.16 deixa a lista com o chamador):
`handoff.created` e `confirmation.requested` → a fila (`handoff.queue_roles`);
`customer.replied_while_human` → o dono da conversa, senão a fila;
`task.assigned` → o assignee, quando muda e não é o próprio ator;
`reminder.no_reply` → a fila; `job.blocked` → `tenant_admin`. Membros ativos
apenas; `platform_admin` nunca. `notifications.email.to`, quando configurada,
é a caixa da organização e recebe TUDO; senão o e-mail é o do usuário.

### 2. O caso "nenhuma" é `iniciarPorAutomacao()`, dentro de `src/conversation`

Não se acrescenta linha à tabela D16 (ela é a especificação do proprietário —
ADR-019). `iniciarPorAutomacao` cria a conversa pela RPC herdada
(`fn_upsert_wa_conversation`, a MESMA identidade `uniq_conversations_1to1…`),
põe `saas_state = waiting_customer` na mesma transação, projeta o legado por
`fn_service_status` e, se a conversa já existia, delega a `transition()`
(`automation.outbound`), que valida o par. Estados fora de `resolved`/
`waiting_customer` são conversa OCUPADA: a automação não fala no meio de um
atendimento; a linha do período fica `skipped_reason=conversation_busy`. O
único escritor de `saas_state` continua sendo `transition.ts`.

### 3. `conversations.saas_tags`, com vocabulário fechado

Coluna nova (9022), CHECK `<@ {awaiting_quantity}`, escrita só por
`src/conversation/tags.ts`. É a marca que o turno lê para tratar a próxima
mensagem como resposta ao lembrete. A tag sai quando o turno conclui o
lembrete (pedido criado/alterado ou pendente; handoff) — turno que só
conversou a deixa, porque a próxima mensagem ainda é do lembrete.

### 4. O disparo por tenant é `job_queue` + `job_runs`, por ADIÇÃO de kinds

`recurring_reminder` e `recurring_reminder_cutoff` entram no CHECK de
`job_queue.kind` com a dança da 9016 (reconstruir sem estreitar). Cada tenant
que bate a janela local vira uma linha em `job_queue` (status `running` →
`done`/`failed`, contagens no `payload`) e uma em `job_runs`. É o "um job run
por tenant" de §5.1/§5.13 sem fila nova.

### 5. A idempotência é do índice; a retomada é do código

`reminder_runs_um_por_periodo (organization_id, customer_id, period_key)`.
O claim vem ANTES de qualquer envio; conflito com linha já enviada é duplicata
evitada e contada; conflito com linha ainda não enviada (queda entre o claim e
o envio) retoma o envio — a chave de idempotência do adapter
(`reminder:{org}:{customer}:{period}`) segura o resto. `cutoff_at` é coluna
fixada no envio: mudar a Setting depois não move o prazo do que já saiu.

### 6. O corte TENTA a tarefa pelo catálogo e grava o que o catálogo respondeu

`create_task` com executor `automation` é o único caminho legítimo (D17). Hoje
o domínio recusa (`non_human_executor_denied`), a recusa é auditada e fica em
`reminder_runs.task_denied_code`; sem pedido `draft`, `no_draft_order`. O
AVISO (`reminder.no_reply`) não depende disso e sai hoje. Quando o proprietário
decidir §B5/§C6, o corte não muda: o catálogo passa a responder `executed` e
`task_id` passa a ser preenchido. Esta ADR **não** abre o domínio a automação:
o proprietário listou essa decisão como dele.

### 7. Resposta depois do corte vai para gente, sem provedor

`replied_late` é decidido pela ENTRADA contra o `cutoff_at`; o turno, ao ver
o lembrete tardio, chama `transfer_to_human` (`tenant_rule`, intent
`resposta_apos_o_corte_do_lembrete`) ANTES do provedor, com zero chamadas, e
não toca no pedido. §7.6 T08 fala em "exceção/avaliação humana configurada";
a configuração não existe (D48: nunca inferida) e o único desfecho honesto até
ela existir é humano.

### 8. A tela de uso lê `ai_usage_events` por `resumoDeUso`, no servidor

`/app/settings/tenant/ia/uso` e `GET /api/v1/settings/ai/uso` respondem pela
mesma função; o total vem de uma agregação do Postgres, não de soma no
cliente. Coexiste com a tela herdada `/app/ai/usage` (por agente, sobre
`llm_calls`, `manager+`): `ai_usage_events` é projeção de `llm_calls` desde a
F04-T08, então os dois relatórios leem a mesma chamada — unificá-los é
trabalho de F11/F13, com inventário de leitores.

## Alternativas rejeitadas

- **Abrir `authorizeCrmCommand` a `automation` nesta fase.** Resolveria
  T08 "task" — e tomaria uma decisão que o proprietário reservou para si,
  no mesmo commit em que se declara a fase pronta.
- **Criar a tarefa por SQL direto no corte.** Side effect fora do catálogo
  (D17, regra dura 3).
- **Acrescentar `open → automation.outbound` à tabela D16.** Reescreveria a
  especificação do proprietário para caber no código (ADR-019 recusou o mesmo
  gesto na F03).
- **Escrever `saas_state` no módulo do lembrete ao criar a conversa.** Um
  segundo escritor de estado — exatamente o que a ADR-016 recusa.
- **Reusar `contacts.tags` para `awaiting_quantity`.** Tag de contato é livre
  e é do contato; a marca é da CONVERSA e tem enum.
- **Uma tabela própria de "job runs do lembrete".** Terceira contabilidade de
  execução ao lado de `job_queue`/`job_runs`.
- **`notify` abrindo `withTenant` por conta própria.** Aviso órfão quando a
  transação do fato voltasse atrás; impasse de pool quando não voltasse.
- **Excluir comentários do grep de §7.6.** Dois comentários citavam o nome do
  método do adapter; afrouxar a varredura para ignorar comentário é o
  afrouxamento que esconderia um chamador real num bloco de comentário. Os
  comentários foram reescritos.

## Consequências

- `notifications`, `email_outbox` e `reminder_runs` nascem `service_only`
  (D35) com prova comportamental de RLS no mesmo commit e entrada em
  `PROVA_PROPRIA`; `isolation: tables` cresce três.
- A linha `handoff:` do VERIFY SUMMARY passa a ser gravada (T04 + `notify=H`);
  `reminder:` é gravada pela suíte do lembrete. Mutantes 50, 51 e 52.
- Limites declarados no BUILD-STATE: tarefa do corte recusada por C6; exceção
  configurável para resposta tardia inexistente; tag que permanece quando uma
  pessoa resolve a conversa sem turno da IA; provedor de e-mail e de IA reais
  `NOT VALIDATED (real)`.

## Data

2026-09-11

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-026-notificacoes-e-lembrete-sobre-o-catalogo.md`).
