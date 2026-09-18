# ADR-019 — Conversa arquivada: a fronteira herdada reabre; D34 pede conversa nova

## Contexto

D34 fecha: "mensagem em conversa `archived` cria conversa nova". A tabela de
§5.6 escreve a mesma coisa na linha `inbound.message` a partir de `archived`, e
`getOrCreateForCustomer` é descrito como "uma conversa **não arquivada** por
cliente e canal".

O código herdado responde essa pergunta de outro jeito, e responde em dois
lugares provados:

1. `uniq_conversations_1to1_per_contact_session`
   (`supabase/baseline.sql:5107-5109`) é único por `(organization_id,
   contact_id, channel_session_id)` **sem recorte de estado**: uma conversa por
   contato e sessão, arquivada ou não. `fn_upsert_wa_conversation` faz `on
   conflict` exatamente sobre ele.
2. `fn_service_inbound` (`supabase/baseline.sql:19039-19088`) trata
   `closed/resolved/archived` como `reopened` e devolve a MESMA conversa ao
   estado `open`, com demanda nova e `service_revision + 1`.

O índice não é decorativo: `lib/automation/start-conversation.ts` reabre por
causa dele; a fusão de contatos duplicados conta com a `unique_violation` dele
para não abortar (`supabase/baseline.sql:19415-19421`); e seis provas o citam
nominalmente (`tests/invariants/operador-nao-pisa-no-humano.test.ts:73`,
`service-boundary.test.ts:376`, `messages-list-paginacao.test.ts:171`,
`gov-helpers.ts:125`, `human-cases.test.ts:77`,
`tests/e2e/juntar-contatos-duplicados.spec.ts:14`).

Há ainda um terceiro fato, que foi medido nesta fase: `fn_service_inbound`
**desiste** quando `m.sent_at <= c.service_closed_at` — mensagem anterior ao
fechamento não reabre atendimento encerrado. Nesse caso a conversa permanece
terminal e `messages.service_revision` fica nulo.

## Decisão

1. **A janela de serviço herdada precede a máquina D16.** `src/channels/inbound.ts`
   lê `messages.service_revision` depois de `fn_service_inbound`. Nulo significa
   que a fronteira não atribuiu a mensagem a nenhum atendimento: a linha fica
   gravada, nenhuma transição roda, o fato é contado em
   `conversation_inbound_fora_da_fronteira` e a rota responde 200 com
   `in_service_window: false`. Nada se perde e nada se move.
2. **"Conversa nova a partir de `archived`" NÃO é entregue na F03.** O efeito
   `new_conversation` continua declarado na tabela D16 — a tabela é a
   especificação do proprietário — e continua sem executor. Com a decisão 1, o
   caminho deixa de ser alcançável pela entrada.
3. **A divergência vai para o proprietário, não para o silêncio.** Entregar D34
   literalmente exige tornar `uniq_conversations_1to1_per_contact_session`
   parcial (`where ... status <> 'archived'`), reescrever o `on conflict` de
   `fn_upsert_wa_conversation` com o predicado correspondente e **refazer a
   prova dos nove dependentes acima**, incluindo a jornada de fusão de contatos
   duplicados. Isso muda o comportamento do caminho herdado, não só do SaaS.

## Alternativas rejeitadas

- **Tornar o índice parcial nesta fase.** Trocaria uma invariante de
  deduplicação com nove dependentes provados por uma não provada, dentro de uma
  fase cujo objetivo é a entrada de mensagem. É o que o target-state proíbe:
  "não substituir CHECKs nem remover `force_human`/silêncio antes de provar
  todos os leitores/escritores".
- **Deixar como estava.** A transição alcançava `archived`, o efeito
  `new_conversation` levantava `EffectNotImplemented` e a rota caía — numa
  mensagem legítima de cliente, com a linha gravada e a transação desfeita.
  Está travado por `tests/integration/f03-fronteira-de-servico.test.ts` e pelo
  mutante `39-f03-fronteira-de-servico.sh`.
- **Mandar a mensagem para `webhook_quarantine`.** Quarentena é o balde de
  "evento sem dono" (ADR-017). Aqui o dono é conhecido: pôr uma mensagem
  legítima ali a esconderia do atendimento.
- **Reescrever a linha da tabela D16 para `archived → open`.** Faria o código
  parecer conforme mudando, em silêncio, uma decisão que o proprietário tomou.
  A tabela continua dizendo o que ele decidiu; esta ADR diz o que foi entregue
  e o que falta decidir.

## Consequências

Na F03, uma mensagem para uma conversa arquivada segue o comportamento herdado:
`fn_service_inbound` reabre a MESMA conversa quando a mensagem é posterior ao
fechamento, e não reabre quando é anterior. A conversa nova de D34 fica
pendente de decisão do proprietário, registrada como limite da fase no
BUILD-STATE. Enquanto ela não vier, o efeito `new_conversation` permanece sem
executor e qualquer chamador futuro que o alcance falha de forma ruidosa, nunca
em silêncio.

## Data

2026-09-10

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-019-conversa-arquivada-e-a-janela-de-servico.md`).
