# ADR-025 — O handoff ganha dossiê e fila sem ganhar um segundo estado

## Contexto

A F05-T01/T02/T03/T04 pede quatro coisas sobre um mecanismo que **já existe e
funciona**: motivo em enum de oito valores, resumo de sete campos, fila de claim
e a guarda de que a IA não fala depois da passagem.

O que havia, medido nesta árvore antes desta task:

- `lib/agent-engine/agent/human-handoff.ts:118-150` — `performHumanHandoff`:
  `contacts.force_human = true`, conversa `ai_handling → pending`,
  `bot_silenced_until = 'infinity'`, crons cancelados,
  `agent_inbox_items(kind='handoff')` deduplicado por episódio aberto;
- três gatilhos: regex PT-BR (`human-handoff.ts:52-57`), tool do modelo
  (`inbound-turn.ts:286-304`) e orçamento esgotado (`inbound-turn.ts:564-629`);
- `isLeadInHandoff` (`human-handoff.ts:89-104`), lido no começo de todo turno;
- do lado SaaS: `transition()` com a tabela D16 (`handoff.requested`,
  `human.claimed`), o catálogo de dez Actions com `transfer_to_human` e
  `resume_ai`, e o turno de §5.9 com o silêncio derivado de `ai.reply_sent`;
- `src/actions/handoff-bridge.ts`, que gravava UM item de inbox e declarava, em
  comentário, que `handoffs` era de F05.

Cinco escolhas desta task afetam mais de um módulo e por isso estão aqui.

## Decisão

### 1. `handoffs` nasce AO LADO de `agent_inbox_items`, e sem coluna `status`

Migration 9020. A tabela é o DOSSIÊ da passagem (por que saiu da IA, o que ler
para assumir); o aviso da organização continua sendo `agent_inbox_items`, que
tem tela e uso. As duas linhas são escritas na MESMA transação de
`transition()`.

**Não há coluna `status`.** "Aberto" é `claimed_at is null` — derivado. O estado
da conversa é `conversations.saas_state` (D16), e uma coluna de status aqui
seria uma segunda verdade sobre de quem é a conversa, livre para discordar do
`saas_state` no primeiro caminho que esquecesse de atualizar os dois. O bloco
final da migration REPROVA se alguém acrescentar a coluna.

A identidade de episódio é reusada, não inventada: o índice parcial
`handoffs_um_aberto_por_conversa … where claimed_at is null` é o mesmo recorte
do `where not exists (… and status = 'open')` do aviso herdado.

### 2. O resumo é determinístico — ZERO chamadas `ai.summary`

**Divergência declarada em relação a §5.11**, que permite uma chamada contada.
Os sete campos saem do checkpoint e do histórico, dentro da transação da
passagem. Três razões, em ordem de força:

1. o motivo mais provável de handoff nesta fase é `provider_error` — pedir o
   resumo ao componente que acabou de falhar é pedir de novo a mesma falha (a
   própria §5.11 já abre exceção para este caso);
2. o segundo mais provável é `forbidden_request`, e mandar ao modelo o texto que
   se está tentando conter, para que ele o resuma, é dar à injeção uma segunda
   passagem pelo prompt;
3. resumo gerado muda entre duas execuções com o mesmo dado, e `fields_present=7/7`
   deixaria de ser prova reproduzível.

`pending_action` é o único dos sete que aceita `NULL`, e aceita por honestidade:
a maior parte das passagens não tem ação pendurada, e um texto fabricado
("nenhuma") seria dado inventado no dossiê que a pessoa vai ler. O campo é
sempre ESCRITO; o valor é o que for verdade.

### 3. A camada determinística de gatilhos roda DEPOIS do provedor

`forbidden_request` continua ANTES (ali o ponto é o dado do tenant nunca ser
lido, §5.9). `customer_request`, `complaint` e `tenant_rule` rodam depois da
única chamada ao modelo, e por isso são um PISO: só acrescentam o handoff que o
modelo deixou passar, nunca apagam o que ele pediu. Rodando antes, uma regex
tiraria do modelo — que enxerga a conversa inteira — a chance de declarar um
motivo melhor fundado.

Consequência de custo, declarada: esses três casos continuam custando UMA
chamada, exatamente como na F04. O contrato `provider_calls` do dataset de
`ai_eval` não muda.

Dentro da camada, a ordem é `customer_request` → `complaint` → `tenant_rule`: um
cliente irritado que pede uma pessoa dispara os três, e o pedido é o mais fiel
ao que ele escreveu (a reclamação é o contexto, o pedido é a ação).

### 4. As quatro regex do gatilho herdado são COPIADAS, com catraca

`src/handoff/gatilhos.ts` copia os padrões de `human-handoff.ts:52-57` em vez de
importar a função. O motivo é de dependência: aquele módulo puxa
`fronteira-server`, `cron/scheduler`, `agent-activity` e o cliente Postgres no
topo do arquivo, e §5.9 é explícita sobre o turno SaaS não alcançar nada disso.

Cópia sem catraca é divergência com data marcada. A catraca é
`tests/unit/f05-t01-gatilhos.test.ts`: um corpus de treze frases (sete positivas,
seis negativas) roda pelos DOIS e a concordância tem de ser 13/13.

### 5. O claim reusa `transition(human.claimed)` — nenhuma trava nova

`src/handoff/registro.ts` não tem lock próprio. O segundo claim é recusado por
duas autoridades que já existiam:

1. `transition()` trava a linha da conversa (`for no key update`) e recusa o par
   `human_handling -human.claimed->`, que não está na tabela D16;
2. um `update … where claimed_at is null` DENTRO da mesma transação, que devolve
   zero linhas se alguém chegou antes.

A segunda existe por um caso que a primeira não cobre: a conversa que voltou
para a IA (`resume_ai`, D34) e foi para a fila de novo tem dois dossiês, e sem a
guarda o claim do novo carimbaria o velho.

O executor de efeito injetado devolve `false` de propósito: a atribuição da
conversa (dono, nome desnormalizado, evento de auditoria) continua sendo de
`fn_conversation_assign`, no executor interno de `transition()`. Devolver `true`
teria carimbado o dossiê e deixado a conversa sem dono.

## Alternativas rejeitadas

- **Colunas em `conversations` em vez de tabela nova.** Apagaria o histórico (a
  conversa que foi para a fila três vezes teria um dossiê só) e tornaria
  impossível auditar a passagem que não foi assumida.
- **`handoffs` substituindo `agent_inbox_items(kind='handoff')`.** Tiraria da
  Central de avisos uma linha que hoje aparece, numa task cuja entrega é
  acrescentar informação.
- **Uma chamada `ai.summary`, como §5.11 permite.** Ver decisão 2.
- **Camada determinística ANTES do provedor.** Mais barata (zero chamadas nos
  casos 1–3) e mais frágil: quebraria o contrato `provider_calls` já fixado pelo
  dataset da F04 e tiraria do modelo a chance de dar um motivo melhor.
- **Importar `detectHumanHandoffRequest` do módulo herdado.** Ver decisão 4.
- **Uma trava própria de claim (advisory lock, `select … for update` no dossiê).**
  Seria uma terceira autoridade sobre "de quem é a conversa", ao lado da tabela
  D16 e de `fn_conversation_assign`.
- **`round_robin` na fila.** É Fase 2 (§5.2). `handoff.assignment` fora de
  `queue` LANÇA em vez de cair no default: essa chave decide quem vê a conversa
  de um cliente, e adivinhar ali é escolher em silêncio por quem configurou
  outra coisa.

## Consequências

- `transfer_to_human` passa a devolver `handoff_id` além de `inbox_item_id`, e
  aceita dois campos opcionais (`intent`, `pending_action`). Chamadores antigos
  continuam válidos — os dois têm default.
- `handoffs` é `service_only` (D35): a fila do atendente é servida pelo servidor,
  via `withTenant`. A tela do Inbox (F05 adiante) lê por API, nunca pelo
  PostgREST.
- `notify(handoff.created)` por USUÁRIO (tabela `notifications` de §5.16)
  **continua não existindo**: é F05-T05. A linha `handoff:` do `verify` fica
  incompleta no campo `notify` até lá.
- O detector de `high_risk_action` deriva do catálogo, e **nenhuma das dez
  entradas de §5.8 é `high`/`blocked` hoje** — então esse caminho não dispara em
  produção. Está declarado no teste (`f05-t01-gatilhos`) e medido com catálogo
  injetado; o caminho que existe em produção para esse motivo é o modelo
  declará-lo.
- Subir o risco de uma Action para `high` passa a ter um efeito a mais, de
  graça: a IA para de executá-la e chama gente.

## Data

2026-09-11

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-025-handoff-dossie-e-fila.md`).
