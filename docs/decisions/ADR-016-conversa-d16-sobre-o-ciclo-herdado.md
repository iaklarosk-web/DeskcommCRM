# ADR-016 — Estados D16 sobre o ciclo de atendimento herdado

## Contexto

A DIRETRIZ §5.6 (D16/D34) define oito estados de conversa, dezesseis eventos e
uma tabela quem/evento/guarda. O DeskcommCRM v1.17.0 já tem um ciclo próprio,
provado e em uso: `conversations.status` com sete valores de dois vocabulários
(`supabase/baseline.sql:1394`), a RPC `fn_service_status` como autoridade de
mudança com CAS por `service_revision` (`:19097-19128`), o gatilho de rede de
segurança `trg_service_stamp_status` (`:19186-19209`), `fn_conversation_assign`
para atribuição (`:22456-22482`), o `ServiceBoundary` como guarda de
concorrência (`lib/atendimento/fronteira.ts:1-83`) e `comandoDaConversa()` como
regra de quem pode responder (`lib/inbox/comando-da-conversa.ts:206-271`).

O target-state manda preservar `conversations`, `messages`, demanda e revisões,
não substituir CHECKs e compatibilizar D16 "por uma autoridade de transição com
tradução documentada, sem segunda máquina de estados concorrente". Dois estados
de D16 — `waiting_customer` e `waiting_confirmation` — não têm portador legado.

## Decisão

1. O vocabulário D16 vive em coluna nova `conversations.saas_state`, com CHECK
   próprio dos oito estados, mais `saas_state_entered_at`. O CHECK herdado de
   `status` não muda e nenhum leitor, gatilho ou RPC legado é alterado.
2. `src/conversation/transition.ts` é a única autoridade de evento e o único
   código de aplicação que escreve `saas_state`. Valida `(from, event)` contra
   `src/conversation/transitions.ts` — espelho literal da tabela de §5.6 —,
   avalia a guarda, escreve o estado e delega o lado legado do movimento às
   RPCs herdadas, preservando `service_revision`, demanda e assignee.
3. Escrita legada de `status` que não vem de um evento é espelhada por um
   gatilho `AFTER UPDATE OF status` que aplica o mapa total `LEGACY_TO_D16`.
   É projeção, não máquina: não escolhe transição, traduz um valor. Fica
   suprimido quando `transition()` sinaliza
   `set_config('app.conversation_transition','1',true)` na mesma transação.
4. Os dois mapas são totais e o engrossamento é finito e declarado:
   `waiting_customer → ai_handling`, `waiting_confirmation → waiting_human` e
   `closed → resolved`. Fora desses três pares, ida e volta são identidade.
5. Par `(estado, evento)` fora da tabela lança `IllegalTransition` e incrementa
   `conversation_illegal_transition{from, event}`.

## Alternativas rejeitadas

- **Reescrever o CHECK de `status` para os oito estados de D16.** Trocaria um
  vocabulário com leitores, gatilhos, RPCs e testes provados por um novo sem
  prova, de uma vez, e quebraria `fn_service_status`, `fn_service_inbound` e o
  espelho SQL de `comandoDaConversa`. É exatamente o que o target-state proíbe.
- **Derivar `saas_state` só por função, sem coluna.** `waiting_customer` e
  `waiting_confirmation` não são deriváveis de nenhum campo legado: a derivação
  perderia dois dos oito estados ou os inventaria.
- **Máquina nova em `src/`, ignorando as RPCs herdadas.** Seria a segunda
  máquina concorrente: dois donos de `status`, CAS perdido, demanda e revisão
  fora de sincronia.
- **Tabela separada de estado SaaS.** Um `join` a mais em toda leitura de inbox
  e duas linhas para uma conversa, sem ganho: a coluna já isola o vocabulário.

## Consequências

A F03 exercita em runtime apenas o subconjunto humano/entrada dos eventos
(`inbound.message`, `human.claimed`, `human.reply_sent`, `human.transferred`,
`human.resolved`, `human.reopened`). Os eventos de IA, confirmação e Job estão
na tabela e são provados por enumeração desde a F03, mas só ganham chamador em
F04 e F05 — a prova de F03-T01 mede a tabela, não o tráfego. Todo escritor
legado continua funcionando sem alteração; qualquer novo escritor de `status`
herda a projeção de graça. A migration que cria a coluna é imutável depois de
aplicada; mudança de mapa exige migration nova com a prova no mesmo commit.

## Data

2026-09-10

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-016-conversa-d16-sobre-o-ciclo-herdado.md`).
