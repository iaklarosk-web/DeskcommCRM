# ADR-017 — Contrato de canal, webhook do SaaS e fila de saída

## Contexto

§5.7 define um `ChannelAdapter` com `verifySignature`, `resolveAccountKey`,
`parseInbound`, `send` e `fetchMedia`, resolução de tenant por
`channel_accounts`, quarentena para webhook sem organização, idempotência por
`(organization_id, provider, provider_message_id)` e modo mock com
`mock_outbox`. §5.13 pede `enqueue()` que rejeita payload sem
`organization_id`, retry 3 e estado `blocked`.

O herdado tem outra forma, também provada: `ChannelAdapter` em
`lib/channels/types.ts:152` com `provider/send/isConfigured/...`; três rotas de
webhook que resolvem tenant por `channel_sessions.webhook_path_token`
(`app/api/v1/webhooks/waha/[token]/route.ts:86-96`) ou por `body.session`
(`.../waha/route.ts:83-93`); idempotência por
`messages_org_external_id_unique (organization_id, external_id)`
(`supabase/baseline.sql:2298-2301`); envio **síncrono** dentro do handler HTTP
(`app/api/v1/messages/_handler.ts:577-821`), sem fila nem retry; nenhum adapter
mock; nenhuma fixture WAHA versionada. `fromWebhook` existe e ninguém o chama
(`src/tenant-context/from-webhook.ts:3-8`). A F01 deixou escrito na própria
migration que adaptar `channel_sessions` para `channel_accounts` é da F03-T03.

## Decisão

1. **Contrato novo, adapter embrulhado.** `src/channels/contract.ts` define
   `SaasChannelAdapter` com a forma de §5.7. O adapter `waha` embrulha o
   herdado (`lib/waha/*`), não o substitui; o adapter `mock` grava em
   `mock_outbox`. O `ChannelAdapter` de `lib/channels/types.ts` continua
   servindo as rotas herdadas sem alteração.
2. **Vínculo explícito, não renome.** `channel_accounts` ganha `phone_e164` e
   `channel_session_id` (FK para `channel_sessions`). É o mapeamento que o
   target-state exige: `conversations.channel_session_id` e
   `messages.channel_session_id` são `NOT NULL`, então a conta de canal precisa
   apontar a sessão herdada. Nenhuma identidade é copiada nem renomeada.
3. **Rota nova, rotas herdadas intocadas.**
   `app/api/v1/webhooks/saas/[provider]` implementa o contrato de §5.7: verifica
   assinatura (sem segredo → 503 e contador, G-27; assinatura inválida → 401 e
   zero escritas), resolve `account_key` pelo adapter e chama `fromWebhook`
   ANTES de qualquer escrita. Sem match → `webhook_quarantine`, contador e 202.
   As três rotas herdadas continuam servindo a operação atual; consolidá-las é
   trabalho de fase posterior, com a prova de todos os leitores.
4. **Idempotência aditiva.** `messages` ganha `provider` e índice único
   `(organization_id, provider, external_id) where provider is not null`. A
   constraint herdada permanece. A dimensão de provedor exigida por §5.7 é
   acrescentada sem tocar no contrato antigo nem em linhas existentes.
5. **Fila de saída sobre `job_queue`.** `event_log` é o barramento; `job_queue`
   é o Job de §5.13. Recebe o `kind` `outbound_message` e o `status` `blocked`
   por adição ao CHECK — `dead` permanece e nenhum job existente muda de
   classe. Tabela nova `job_runs` guarda cada tentativa. `src/jobs/enqueue.ts`
   rejeita payload sem `organization_id` e conta a recusa; o job é idempotente
   por `message_id`; retry N=3 com backoff; terceira falha vai para `blocked`
   com erro normalizado e `notify(job.blocked)`.
6. **Envio só pelo catálogo.** `src/actions/` é o único diretório que importa
   `adapter.send`. A entrada `send_message` e o `execute()` mínimo nascem aqui;
   o catálogo completo é F04-T01.

## Alternativas rejeitadas

- **Reescrever as rotas WAHA herdadas para `channel_accounts`.** Elas servem a
  operação hoje e resolvem tenant por token de URL e por nome de sessão; trocar
  a resolução sem provar todos os leitores trocaria um caminho provado por um
  não provado, e o contador de quarentena não substitui um 404 que já é o
  contrato do provedor nessas rotas.
- **Substituir a constraint de idempotência herdada.** Migration aplicada não
  se edita e a constraint tem leitores; a dimensão nova cabe num índice novo.
- **Fila própria só para saída.** Duplicaria claim, backoff e observabilidade
  que `job_queue` já tem, e contraria §5.13, que nomeia `job_queue` como o Job.
- **Manter o envio síncrono no handler.** Não há onde registrar tentativa,
  backoff nem `blocked`; T07 e T08 ficariam sem mecanismo.
- **Adapter mock por variável dentro do adapter WAHA.** Esconderia o modo mock
  dentro do caminho real; o contrato de dois adapters é o que a prova de
  F03-T02 mede (`adapters=2 cases=6 pass=12/12`).

## Consequências

Passa a haver, declaradamente, um caminho de entrada herdado e um caminho de
entrada SaaS, com a mesma autoridade de conversa (ADR-016) e a mesma tabela de
mensagens. A consolidação em um só caminho é trabalho futuro e exige inventário
de leitores. Fixtures WAHA passam a ser versionadas em
`tests/fixtures/waha/2026.7.2/` (G-42) com telefones substituídos; nenhum
payload real de cliente entra no repositório. Nenhuma mensagem é enviada a
pessoa real: `WHATSAPP_MODE=mock` é forçado pelo `verify.sh` (D12).

## Data

2026-09-10

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-017-canal-saas-e-webhook.md`).
