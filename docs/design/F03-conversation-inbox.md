# Desenho F03 — Conversation + Channel Adapter + Inbox

Autoridade: `docs/DIRETRIZ.md` §5.6, §5.7, §7.4 e D16/D20/D34. Este arquivo
detalha COMO as dez tasks se apoiam no ciclo herdado do DeskcommCRM v1.17.0
sem criar uma segunda máquina de estados. Decisões estruturais em
[ADR-016](../decisions/ADR-016-conversa-d16-sobre-o-ciclo-herdado.md),
[ADR-017](../decisions/ADR-017-canal-saas-e-webhook.md) e
[ADR-018](../decisions/ADR-018-verify-v1.1.md).

## 0. O que já existe (medido no checkpoint 3c1f6f6e)

| Fato | Evidência |
|---|---|
| `conversations.status` aceita 7 valores de dois vocabulários | `supabase/baseline.sql:1394` |
| Autoridade de status é a RPC `fn_service_status`, com CAS por `service_revision` | `supabase/baseline.sql:19097-19128` |
| Gatilho de rede de segurança carimba revisão/assignee em mudança de status | `supabase/baseline.sql:19186-19209` |
| Atribuição/transferência passam por `fn_conversation_assign` | `supabase/baseline.sql:22456-22482` |
| `ServiceBoundary` é guarda de concorrência (CAS), não máquina IA×humano | `lib/atendimento/fronteira.ts:1-83` |
| Quem pode responder é decidido por `comandoDaConversa()` | `lib/inbox/comando-da-conversa.ts:206-271` |
| Ingestão WAHA já faz telefone → contato → conversa → mensagem | `lib/waha/ingest.ts:567-671` |
| Idempotência de entrada por `(organization_id, external_id)` | `supabase/baseline.sql:2298-2301` |
| `fromWebhook` resolve tenant por `channel_accounts` e enfileira quarentena | `src/tenant-context/from-webhook.ts:18-44` |
| Nenhuma rota HTTP chama `fromWebhook` ainda | comentário em `src/tenant-context/from-webhook.ts:3-8` |
| `channel_accounts` nasceu mínima; adaptação é da F03-T03 | `supabase/migrations/20260907150000_9001_channel_accounts_e_webhook_quarantine.sql:28-29` |
| Não existe adapter `mock` nem `mock_outbox` | `lib/channels/index.ts:10-24` |
| Não existe fila de saída: envio é síncrono no handler | `app/api/v1/messages/_handler.ts:577-821` |
| `messages.status` já cobre `queued/sent/delivered/read/failed` | `supabase/baseline.sql:1665` |
| `job_queue` já tem `organization_id not null`, `attempts`, `max_attempts` | `supabase/baseline.sql:6473-6503` |

## 1. F03-T01 — Máquina de estados D16 sobre o ciclo herdado

### 1.1 Onde o estado D16 mora

Coluna nova `conversations.saas_state` (CHECK com os 8 estados de D16) e
`saas_state_entered_at`. O CHECK herdado de `status` **não muda**: os leitores,
gatilhos e RPCs legados continuam idênticos.

### 1.2 Uma autoridade, uma projeção

- **Autoridade de evento**: `src/conversation/transition.ts`. É o único código
  de aplicação que escreve `saas_state`. Valida o par `(from, event)` contra
  `src/conversation/transitions.ts` (espelho literal da tabela de §5.6),
  avalia a guarda, escreve `saas_state`/`saas_state_entered_at` e delega o
  lado legado do movimento às RPCs herdadas (`fn_service_status`,
  `fn_conversation_assign`), preservando `service_revision`, demanda e
  coerência de assignee.
- **Projeção mecânica**: gatilho `trg_saas_state_project`
  (`AFTER UPDATE OF status`) espelha para `saas_state` qualquer mudança de
  `status` feita por escritor legado. Não inventa transição: aplica o mapa
  total `LEGACY_TO_D16`. É suprimido quando o movimento veio de `transition()`,
  que sinaliza `set_config('app.conversation_transition','1',true)` na mesma
  transação.

Não há segunda máquina: eventos têm um dono; escrita legada tem uma tradução
determinística e total. Divergência é impossível porque os dois escrevem a
mesma coluna.

### 1.3 Mapas (total nos dois sentidos)

`LEGACY_TO_D16` — usado no backfill e na projeção:

| `status` legado | `saas_state` |
|---|---|
| `open` | `open` |
| `pending` | `waiting_human` |
| `claimed` | `human_handling` |
| `ai_handling` | `ai_handling` |
| `resolved` | `resolved` |
| `closed` | `resolved` |
| `archived` | `archived` |

`D16_TO_LEGACY` — usado por `transition()` ao chamar as RPCs herdadas:

| `saas_state` | `status` legado |
|---|---|
| `open` | `open` |
| `ai_handling` | `ai_handling` |
| `waiting_customer` | `ai_handling` |
| `waiting_confirmation` | `pending` |
| `waiting_human` | `pending` |
| `human_handling` | `claimed` |
| `resolved` | `resolved` |
| `archived` | `archived` |

O engrossamento é declarado e finito: `waiting_customer → ai_handling`,
`waiting_confirmation → waiting_human` e `closed → resolved`. Fora desses três
pares, ida e volta são identidade. O teste enumera os 8 estados e os 7 valores
legados e falha se aparecer par de engrossamento não declarado.

### 1.4 Prova

`tests/unit/f03-t01-conversation-states.test.ts` conta os eventos DA TABELA em
tempo de teste (nunca escritos à mão), enumera 8 × E pares e imprime
`conversation-states: states=8 events=16 pairs=128 valid=V/V invalid_rejected=I/I`
com `V+I = 128`. Par ilegal lança `IllegalTransition` e incrementa
`conversation_illegal_transition{from,event}` em `src/obs/counters.ts`.

## 2. F03-T02 — Contrato de ChannelAdapter e adapter mock

`src/channels/contract.ts` define o contrato de §5.7
(`verifySignature`, `resolveAccountKey`, `parseInbound`, `send`, `fetchMedia`)
como `SaasChannelAdapter`. Não substitui o `ChannelAdapter` herdado de
`lib/channels/types.ts:152`: o adapter `waha` de F03 **embrulha** o herdado
(`lib/waha/*`, `lib/channels/adapters/waha.ts`) e o adapter `mock` grava em
`mock_outbox`. `WHATSAPP_MODE=mock` (D12) seleciona o mock; o `verify.sh` força
esse modo.

Prova: `channel-adapter-contract: adapters=2 cases=6 pass=12/12` — os seis casos
(assinatura válida/inválida, account_key resolvido, parse com allowlist, parse
com campo desconhecido contado, envio devolve `provider_message_id`) rodam
idênticos nos dois adapters.

## 3. F03-T03 — `channel_accounts` resolve o tenant

`channel_accounts` ganha `phone_e164` e `channel_session_id` (FK para
`channel_sessions`), que é o vínculo explícito exigido pelo target-state —
`messages.channel_session_id` e `conversations.channel_session_id` são
`NOT NULL`, então a conta de canal precisa apontar a sessão herdada.

Rota nova `app/api/v1/webhooks/saas/[provider]/route.ts`: verifica assinatura,
resolve `account_key` pelo adapter, chama `TenantContext.fromWebhook` ANTES de
qualquer escrita. Sem match → linha em `webhook_quarantine`, contador
`tenant_ctx_rejected{source=webhook,reason=unknown_account}` e resposta 202
(o provedor não deve reentregar um evento que nunca terá dono).
As rotas WAHA herdadas continuam intocadas.

Remetente (G-34/G-73): ordem `senderPn` → `remoteJidAlt` → `remoteJid`; JID
`@lid` sem alternativa vai para quarentena com `reason=lid_without_pn`.

Prova: `webhook-tenant: resolved=2/2 quarantine_rows=1 counter=1`.

## 4. F03-T04 — Idempotência de entrada

`messages` ganha coluna `provider` e índice único
`(organization_id, provider, external_id) where provider is not null`. A
constraint herdada `messages_org_external_id_unique` permanece: o índice novo
acrescenta a dimensão de provedor exigida por §5.7 sem tocar no contrato antigo.

Fixtures reais em `tests/fixtures/waha/2026.7.2/*.json` (G-42), com telefones
substituídos. O parser grava só a allowlist e conta `unknown_fields{name}`.

Prova: `webhook: replay=2 stored=1 tables_checked=T` com `T ≥ 4`, medindo as
tabelas por snapshot de contagem de `pg_tables` em `public` antes e depois do
primeiro POST (G-26), nunca por lista escrita à mão.

## 5. F03-T05 — Pipeline de entrada

`src/channels/inbound.ts` orquestra, dentro de `withTenant(ctx)`:
telefone → contato → conversa → mensagem → interação, reaproveitando as RPCs
herdadas (`fn_upsert_wa_contact`, `fn_upsert_wa_conversation`, `fn_service_inbound`)
e emitindo o evento D16 `inbound.message` por `transition()`. Os efeitos
pós-entrada herdados (`lib/channels/pos-entrada.ts`) — opt-out, demanda,
campanha, despacho do agente — são preservados na mesma ordem.

Prova: 1ª mensagem `+1 +1 +1 +1`; 2ª do mesmo número
`customers=+0 conversations=+0 messages=+1` (8/8).

## 6. F03-T06 — Envio humano e status

`src/actions/catalog.ts` nasce aqui com **uma** entrada, `send_message`
(risk `medium`, `confirmation: none`, executores `human`), e o `execute()`
mínimo. `src/actions/` é o único diretório que importa `adapter.send`.
O webhook de status atualiza `sent → delivered → read` reaproveitando o
`handleAck` herdado (`lib/waha/ingest.ts:931-952`).

Prova: `outbound: mock_outbox=1 status_transitions=3/3 audit_rows=1`.

## 7. F03-T07/T08 — Fila de saída, retry e bloqueio

`job_queue` recebe o `kind` `outbound_message` e o `status` `blocked`
(adição ao CHECK; `dead` permanece). Tabela nova `job_runs` registra cada
tentativa (job, tentativa, início, fim, erro normalizado). `src/jobs/enqueue.ts`
rejeita payload sem `organization_id` e conta a recusa; o job é idempotente por
`message_id`. Retry N=3 com backoff; na terceira falha o job vai para `blocked`
com erro registrado e `notify(job.blocked)`.

Provas: `outbound-failure: attempts=3 final=sent` e
`final=blocked error_logged=1 notified=1`;
`outbound-queue: rejected_without_tenant=2/2 duplicate_sends=0/2`.

## 8. F03-T09 — Inbox

A UI herdada (`components/inbox/*`) já tem assumir, liberar, transferir, fechar
e reabrir. F03 acrescenta o estado D16 visível na lista e no cabeçalho e o
filtro por estado e responsável, lendo `saas_state`. Nenhuma ação nova de
escrita é criada fora das rotas herdadas; elas passam a atravessar
`transition()` no servidor.

Prova: `pnpm test:e2e -g inbox` = 7/7 por tenant, cada ação seguida de assert do
texto do estado.

## 9. F03-T10 — verify.sh v1.1

Detalhado na [ADR-018](../decisions/ADR-018-verify-v1.1.md). Em resumo: `webhook`
deixa de ser literal `pending` e passa a ser lida de
`.verify-logs/metrics/webhook.line`; F03 entra na lista de fases com gate
completo, herdando integralmente os controles de F02 (sandbox, snapshot de
inputs, E2E fechado) e acrescentando as specs de inbox. Mutante novo: sem chave
de idempotência → `stored=2`, exit 1.

## 10. Limites declarados

Meta Cloud API, Instagram, e-mail de entrada e webchat ficam fora (D05 Fase 2).
Número real da Deka é tarefa humana (D04). Toda a execução usa
`WHATSAPP_MODE=mock` e `AI_PROVIDER=mock` com empresas fictícias; nenhum
provedor real é exercitado e nenhuma mensagem é enviada a pessoa.
