# ADR-040 — F18: um motor de IA só (unificação do §B8)

Decisões da F18 que afetam mais de um módulo (AGENTS.md §8). §7.9 manda
decompor a fase em tasks antes de executar. A mensagem do proprietário de
18/09/2026 (depois do fechamento da F14) escolheu **unificar os dois turnos de
IA** entre F16 / F17 / Stripe / unificação, respondeu sete decisões de produto
em cards e aprovou o brief com as três objeções do `contraponto` aceitas como
teste. As escolhas de produto são dele, registradas como **D56** em
`docs/DIRETRIZ.md` §2. O verificador muda em
[ADR-041](ADR-041-verify-v1.11-F18.md).

## Contexto

O §B8 (VARREDURA; ADR-038 Consequências; FINAL-VALIDATION §8 risco 26) diz que
existem dois turnos de IA nesta árvore:

| | Motor herdado | Turno SaaS |
|---|---|---|
| Entrada | evento `ai_agent.dispatch_requested` (`lib/channels/pos-entrada.ts:294`) → `workers/agent-worker/main.ts` → `runAgentTurn` | `responderTurno` (`src/ai/turno.ts:339`), chamado pelo chat do site (F14) e pelas provas |
| Ferramentas | 60 `crm_*` servidas por MCP (`lib/mcp/tools/`) | catálogo D17 com 14 ações (`src/actions/catalog.ts`) |
| Política por ação (F15) | **não** | sim (`allow`/`approve`/`block`/`transfer`) |
| Teto diário de turnos (F15) | **não** | sim (`ai.limits.daily_turns`) |
| Auditoria por ação | parcial | sim (`action_runs`, `audit_log`) |
| Medido pelo gate | não | sim (72 testes, linha `channels:`) |

Medido na PRODUÇÃO em 18/09/2026, antes de decidir:

- `elegivelParaWorkerLegado` devolve `false` sempre (`lib/ai/agents/no-ar.ts:34`):
  o worker de resposta antigo já está desligado; quem responderia é o
  agent-engine pelo despacho.
- **Nenhum agente publicado**: duas versões em `draft` na organização
  `kn-tecnologia`, **nenhum agente** na `deka`. Como `agenteAtende` exige
  `published_version_id`, hoje o motor herdado não responde a ninguém — o §B8 é
  risco **latente**, que vira real na publicação do primeiro agente.
- O único agente com ferramentas declara **19** das 60
  (`ai_agent_versions.tool_ids`), não as 60.
- Tráfego real: 1 conversa e 1 mensagem de saída no banco inteiro (o número de
  WhatsApp não foi conectado, D12-4). **É o momento mais barato para trocar o
  motor**: não há cliente no meio.
- A versão publicada guarda `system_prompt`, `model` e `knowledge_source_ids`;
  o turno SaaS já sabe montar contexto com persona (`src/ai/contexto.ts:235`) e
  já aceita escopo de fontes no acervo (`src/knowledge/busca.ts:151`,
  `p.escopo.fontes`). Reusar prompt e acervo é **ligação, não reescrita** — e a
  T00 prova isso antes de a fase crescer.

Inventário completo das 60 ferramentas, com o que cada uma faz e o arquivo onde
o herdado a implementa, em `CRM-OS/docs/f18/FERRAMENTAS-MCP-INVENTARIO-20260918.md`
(13 a migrar, 6 já cobertas, **41 na fila de espera**). A fila é deliberada: o
proprietário pediu que o que ficar de fora fique anotado para entrar depois.

## Decisão

### 1. O turno SaaS assume o despacho, por organização

Chave nova `ai.engine` (`saas` | `legacy`), **default `saas`**, no molde do
`ai_dispatch_mode` que já existe (`lib/schemas/settings.ts:34`). O worker do
despacho lê a chave: `saas` → `responderTurno`; `legacy` → `runAgentTurn` como
hoje. A volta atrás é uma chave por organização, não um deploy.

### 2. Ferramentas: 13 entram, 41 esperam, o que faltar vira handoff

Entram no catálogo (14 → **28** ações) as 19 declaradas menos as 6 já cobertas,
mais `crm_cancel_appointment` (decisão do proprietário, §4):

| Grupo | Ações novas |
|---|---|
| Lead/funil (7) | listar leads, ver lead, listar funis, listar estágios, criar lead, atualizar lead, mover de estágio |
| Agenda (5) | tipos de atendimento, horários livres, listar compromissos, confirmar, desfecho |
| Agenda — desmarcar (1) | cancelar compromisso |
| Contato (1) | propor campo do contato |

**Fail-closed (objeção 1):** ferramenta declarada por um agente e **não**
migrada nunca some em silêncio — o turno devolve handoff para humano com linha
de auditoria nomeando a ferramenta que faltou. É o que mantém a fila de espera
honesta: o que falta aparece no painel, não no prejuízo.

### 3. Herança: mesmo prompt, mesmo acervo, mesmo anti-ban

Com `ai.engine=saas` e uma versão publicada, o contexto do turno SaaS usa o
`system_prompt` DESSA versão (e não só `ai.system_prompt`) e restringe o acervo
aos `knowledge_source_ids` dela. Pacing/anti-ban e a janela do humano seguem
como estão (F14): o que muda é o loop de ferramentas e as travas.

### 4. Desmarcar horário é `allow` (decisão do proprietário)

`cancel_appointment` entra com risco `medium` e política **`allow`**: a IA
desmarca sozinha, sem aprovação humana. O proprietário escolheu isso sabendo do
risco declarado no card ("um erro dela libera a agenda de alguém sem ninguém
ver"). Três freios permanecem e são medidos: compromisso passado não é
cancelável, toda execução grava `action_runs` + `audit_log`, e a organização
pode trocar para `approve` na tela de autonomia sem código.

### 5. Tasks

| Task | Entrega | Critério de saída (número com denominador) |
|---|---|---|
| T00 | ADR-040/041, verify v1.11, chave `ai.engine`, as duas provas das objeções 1 e 2 | prova da herança 1/1; prova do fail-closed 1/1; casos do gate do report 168 → 190 |
| T01 | Roteamento do despacho pela chave (`saas` \| `legacy`), volta atrás | `saas_turns`/`legacy_turns` medidos; `volta_atras=1/1` |
| T02 | 13 ações novas no catálogo (lead/funil, agenda, contato) | `tools_migradas=13/13`, política e auditoria em cada uma |
| T03 | `cancel_appointment` com `allow` e os três freios | `cancel_allow=1/1`, `cancel_passado_negado=1/1`, `cancel_auditado=1/1` |
| T04 | §B18 (prévia da conversa na entrada SaaS do WhatsApp) e §B19 (`lint:channels`) | `lint:channels` exit 0; prévia 1/1 |
| T05 | Spec `f18-motor-unico`, linha `engine:`, mutantes, smoke, fechamento | spec 7/7 nos dois modos; mutantes 77–80 |

### 6. Escopo declarado como NÃO verificável nesta fase

WhatsApp REAL continua `NOT VALIDATED (real)` — sem número (D12-4), a prova real
é o chat do site mais a entrada de WhatsApp simulada no staging (objeção 3,
aceita). A fase unifica o motor; provar o motor unificado no canal que motivou o
§B8 depende do número.

## Alternativas rejeitadas

- **Levar a política da F15 ao motor herdado** (a opção B que eu recomendei):
  menor e mais rápida, rejeitada pelo proprietário — deixaria dois motores para
  sempre e toda regra nova teria de ser escrita duas vezes.
- **Migrar as 60 ferramentas**: duas fases de trabalho para dar manutenção
  eterna a ação que ninguém declara. O inventário existe justamente para que
  isso não precise ser decidido de uma vez.
- **Virar a chave para todos de uma vez**: sem volta atrás por organização.

## Consequências

- Quem responde o cliente passa a ser o turno que o gate mede. A política por
  ação, o teto diário e a auditoria valem para todo canal, não só para o chat do site.
- A IA perde, na prática, 41 ferramentas herdadas — nenhuma delas declarada
  hoje. O que fizer falta entra pela fila de espera, com o arquivo do herdado
  como ponto de partida.
- `cancel_appointment` em `allow` é a primeira ação de efeito externo que a IA
  executa sem aprovação humana. Vale a pena reler esta linha quando houver
  cliente real na agenda.
- O motor herdado continua na árvore e continua servindo as telas; o que muda é
  quem atende o despacho.

## Data

2026-09-18.
