# ADR-036 — F15: automação e autonomia de IA por empresa/ação (política por ação, limites/pausa, handoff por rodízio, regras sobre o catálogo, conhecimento com proveniência)

Decisões da F15 que afetam mais de um módulo (AGENTS.md §8). §7.9 manda
decompor a fase em tasks antes de executar; a mensagem do proprietário de
14/09/2026 (fim da F13, D53 c) autorizou a F15 como próxima fase depois de
uma entrevista em bloco e do `contraponto` sobre o brief (as escolhas de
produto abaixo são dele, registradas como **D54** em `docs/DIRETRIZ.md` §2).
O verificador muda em [ADR-037](ADR-037-verify-v1.9-F15.md). §B16
(specs herdadas de suporte em modo de edição) é consertado nesta fase (§5);
§B5/§C6 (`create_task` pela IA) é resolvido por decisão do proprietário (§2 T01).

## Contexto

O que §7.9 pede da F15 — "autonomia por empresa/ação, aprovações, handoff,
regras, limites, pausa, auditoria e conhecimento; permitir/aprovar/bloquear/
transferir respeitados; repetição segura; custo e qualidade reais medidos;
nenhum efeito fora da política" — já tem base na árvore, medida em `426d011c`:

| Existe | Onde | O que falta para a F15 |
|---|---|---|
| Catálogo único de ações (12 entradas, `risk`, `executors`, `confirmation`), caminho ÚNICO de execução com auditoria, pendência por `by_risk` contra `actions.confirm_from_risk` (D33) | `src/actions/catalog.ts:106-247`, `src/actions/execute.ts:213-250`, `src/actions/pending-store.ts` | política POR AÇÃO e por organização (`allow\|approve\|block\|transfer`) sobre o caminho de execução; hoje só o risco decide |
| `create_task` no catálogo com executor `ai`, mas o domínio nega executor não humano (`non_human_executor_denied`) | `src/actions/tools/pedido.ts:183-192`, `src/crm/authorization.ts:52`; VARREDURA §B5/§C6 | abrir `tasks.create` a `ai_agent`/`automation` com auditoria própria — o tipo `TrustedCrmExecutor` já prevê os dois (`authorization.ts:14-17`) |
| `ai.enabled` honrado pelo turno (`turno.ts:340`); uso gravado em `ai_usage_events` por organização (F01/F04) | `src/ai/turno.ts`, `src/entitlement/` | limite diário de turnos por organização, pausa automática ao bater, aviso por usuário |
| Fila de handoff `queue` (`handoff.assignment` só aceita `["queue"]`) e rodízio puro `selectRoundRobin` (reusado pela fila de oportunidades na F13) | `src/tenant-config/schema.ts:118`, `src/handoff/registro.ts`, `lib/routing/decide.ts` | `round_robin` como valor do enum e atribuição na criação do handoff |
| Motor de regras herdado: `automation_rules(trigger_event, conditions, actions)`, `automation_rule_runs`, consumidor do `event_log` (`runAutomationForEvent`), condições, throttle, adiamento pela janela | `lib/automation/engine.ts`, `lib/automation/actions/*` (7 ações herdadas fora do catálogo: `add_tag`, `assign_owner` fixo, `call_webhook`, `create_or_move_lead`, `send_ai_message`, `send_whatsapp`, `start_message_flow`) | ações da regra restritas ao catálogo D17 (executor `automation`); idempotência no BANCO (`automation_rule_runs` tem só índices comuns, `baseline.sql:5950-5952`); emissores: só `lead.stage_changed`/`lead.created` existem no `event_log` |
| Conhecimento: `ai_chunks` com `content_hash` e `knowledge_source_id`; a busca devolve `source_name` | `src/knowledge/ingestao.ts`, `src/knowledge/busca.ts:50-52` | provar reindex incremental (trecho inalterado não reembeda) e proveniência citada na resposta |

## Decisão

### 1. Vocabulário e o que NÃO muda

"Política" é a escolha da organização por AÇÃO do catálogo para executores
não humanos: `allow` (executa), `approve` (fica pendente para o `attendant`,
como hoje), `block` (nega e audita), `transfer` (nega, audita e transfere a
conversa a um humano). O catálogo continua único (D17): a política não cria
ação, só decide o que acontece com uma. Executor `human` não é afetado (D40:
"autonomia da IA"). `blocked` na taxonomia de risco e `executors` do catálogo
continuam prevalecendo sobre a política (a configuração "não supera isolamento,
autorização nem limites comerciais", D40). O motor de regras herdado é
preservado; o que muda é o conjunto de ações que uma regra pode disparar.
Nada da Deka em código (D06).

### 2. Tasks (critério de saída com denominador)

| Task | Entrega | Critério de saída | Depende de |
|---|---|---|---|
| **F15-T00** | Esta ADR + ADR-037 (verify v1.9) + branch `feat/F15-automacao-e-autonomia` a partir de `426d011c` + **emissores** `conversation.resolved` (efeito da transição para `resolved`, `src/conversation/transition.ts`), `order.confirmed` (`executeOrderCommand` em `confirm_order`, `src/crm/orders/service.ts`), `task.overdue` (cron por tenant `forEachEligibleTenant`, idempotente por `(task, due_date)` via `not exists` no `event_log`) — todos por `public.emit_event` — + **migration 9027** (índice único parcial `automation_rule_runs (rule_id, event_id) where event_id is not null` + `revoke/grant` explícitos) com apêndice idempotente no baseline e MANIFEST + **§B16** (§5) | `node --test tests/verify/gate.cases.mjs` verde com os casos F15; `tests/db/f15-t00-idempotencia-das-regras.test.ts`: segunda inserção `(rule, event)` recusada 1/1; unit: cada emissor grava 1 linha por evento (3/3) e `task.overdue` 2× no mesmo `due_date` = 1 linha | F13 fechada (`426d011c`) |
| **F15-T01** | Política por ação: chave `actions.policy` em `tenant_settings` (tipo novo `action_policy`: objeto `{<nome do catálogo>: allow\|approve\|block\|transfer}`, chaves só do catálogo, ≤ 1 entrada por ação); defaults declarados (§4); `execute.ts` consulta a política DEPOIS de `executors`/`risk=blocked` e ANTES de `exigeConfirmacao`; `block` → `denied` com motivo novo `policy_blocked`; `transfer` → `transfer_to_human` da conversa + `denied` com `policy_transferred`; `create_task` por executor `ai`/`automation`: `authorizeCrmCommand` aceita `ai_agent`/`automation` para `tasks.create` (ctx de job/webhook, organização ativa) e a linha de auditoria leva `actor_type=ai\|automation`; rota `GET/PATCH /api/v1/settings/ai-autonomy` (`settings.manage` — `tenant_admin` e `manager`); tela `/app/settings/tenant/ia/autonomia` | integração: `policy_modes=4/4` (cada modo exercitado por executor `ai` numa ação de escrita, com o efeito conferido no banco: `allow` grava, `approve` pende, `block` não grava e audita, `transfer` não grava e a conversa vai a `waiting_human`) `ai_task_created=1/1 roles_denied=D/D` (attendant → 403 na rota); unit: validador do tipo recusa ação fora do catálogo e valor fora do enum | T00 |
| **F15-T02** | Limites e pausa: `ai.limits.daily_turns` (`int`, default 0 = sem limite, declarado) em `tenant_settings`; `src/ai/limite.ts` conta turnos do dia da organização em `ai_usage_events` (fuso `business.timezone`) ANTES de chamar o provedor; ao bater: nenhuma chamada, conversa segue para handoff `tenant_rule` (D19, "regra do tenant"; o resumo diz "limite diário"), notificação `ai.limit_reached` (7º evento de §5.16) ao `tenant_admin`, contador; `ai.enabled=false` continua a pausa manual; tela mostra uso do dia/limite | integração: `limit_hits=1/1 calls_after_limit=0/3` (três turnos depois do limite, zero chamadas ao provedor — asserção de saldo antes/depois em `ai_usage_events`, G-20) `paused=1/1 resumed=1/1` (limite reposto → turno volta a chamar) | T01 |
| **F15-T03** | Handoff por rodízio: `handoff.assignment` ganha `round_robin`; `src/handoff/registro.ts` atribui `assignee` na criação do handoff entre membros aceitos com papel em `handoff.queue_roles`, por `selectRoundRobin` com `lastAssignedAt` lido de `handoffs.assigned_at`; `queue` (default) inalterado; notificação `handoff.created` vai ao atribuído | integração: `handoffs=H balanced=1 assignees_distinct=K` com H ≥ 3, K ≥ 2, max−min ≤ 1; `queue` continua sem `assignee` (1/1) | T02 |
| **F15-T04** | Regras sobre o catálogo: ações de regra permitidas = `send_message`, `create_task`, `transfer_to_human`, `assign_owner` (entrada NOVA do catálogo, executor `automation`+`human`, risco `low`, atribui oportunidade por rodízio reusando `src/crm/oportunidades`); `lib/automation/actions/catalogo.ts` registra os quatro delegando a `execute(ctx, {kind:"automation"}, …)`; validador da rota `POST/PATCH /api/v1/automation-rules` recusa `actions[].type` fora da lista (`outside_catalog_denied`) e `trigger_event` fora dos 4 gatilhos + 2 herdados de lead; guarda no motor: ação fora da lista → `failed: outside_catalog`; tela `/app/settings/tenant/automation-rules` (`settings.manage`) | integração: `rules=4 runs=4/4` (uma regra por gatilho, cada uma disparada pelo emissor real do evento) `replays=4 duplicate_runs=0` (cada evento redespachado 1×: o índice 9027 recusa a segunda run) `outside_catalog_denied=1/1` | T01, T03 |
| **F15-T05** | Conhecimento: ingestão reindexa só trechos cujo `content_hash` mudou (unit + integração com o mock de embedding contando chamadas); a resposta do turno cita `source_name` dos trechos usados (`sources_cited`) | integração: `reindexed=N/N unchanged_skipped=M/M` (N trechos alterados reembedados, M inalterados sem chamada) `sources_cited=K/K` (K respostas com fonte, K = turnos que usaram conhecimento) | T02 |
| **F15-T06** | Spec `tests/e2e/f15-automacao-e-autonomia.spec.ts` (3 jornadas × 2 tenants + 1 = **7 testes**: política na tela → efeito no inbox; limite/pausa na tela; regra criada na tela dispara e aparece em runs; + 1 do painel do dono lendo o uso por organização), suíte de integração com a linha `autonomy:`, mutantes 69–72, i18n espanhol, `e2e.yml`, smoke, **`demo3` + `from-scratch`** (parados desde a F07), **linha `ai_real:`** (§3), evidência, BUILD-STATE, FINAL-VALIDATION, RETOMADA, COMECE-AQUI (prompt reescrito), produção (`scripts/prod/up.sh` + `prova.sh` DEPOIS do READY), custo | gate `READY (staging)` com a linha `autonomy:` medida; `mutants_killed` sobe 4; `demo3: e2e=…`, `from-scratch: pass=N/N`; `ai_real: turns=N/N`; `prod: sha=<commit da F15>` | T01–T05 |

### 3. A linha `autonomy:` (o que a fase mede) e a linha `ai_real:` (fora do bloco)

Gravada pela suíte de integração `tests/integration/f15-automacao-e-autonomia.test.ts`
via `gravarLinhaDoVerify("autonomy", …)`, como `crm:` (ADR-035):

```
autonomy: policy_modes=4/4 ai_task_created=1/1 limit_hits=1/1 calls_after_limit=0/3 paused=1/1 resumed=1/1 handoffs=H balanced=1 assignees_distinct=K rules=4 runs=4/4 replays=4 duplicate_runs=0 outside_catalog_denied=1/1 reindexed=N/N unchanged_skipped=M/M sources_cited=S/S roles_denied=D/D
```

Contrato (ADR-037): `policy_modes=4` e igual ao denominador; `ai_task_created=1`;
`limit_hits=1`; `calls_after_limit` numerador 0 com denominador ≥ 3;
`paused=1`; `resumed=1`; `handoffs>=3`; `balanced=1`; `assignees_distinct>=2`;
`rules>=4`; `runs=rules` e igual ao denominador; `replays>=rules`;
`duplicate_runs=0`; `outside_catalog_denied=1`; `reindexed>=1`,
`unchanged_skipped>=1` e `sources_cited>=1`, cada um igual ao denominador;
`roles_denied>=3` e igual ao denominador.

**Turnos reais ficam FORA do bloco.** O `verify.sh` força `AI_PROVIDER=mock`
(`scripts/verify.sh:45`, AGENTS §4); "custo e qualidade reais medidos" (§7.9)
é medido pelo script `scripts/staging/prova-ia.sh` contra o staging com o
provedor real, dentro do teto autorizado pelo proprietário (**≤ 20 turnos
`claude-haiku-4-5`**), e entra no cabeçalho do BUILD-STATE como
`ai_real: turns=N/N cost_usd=… limit_hit=1/1 calls_after_limit=0/K paused=1/1 sources_cited=S/S at=<data>`
— fora do bloco, como `prod:`/`smoke:` (ADR-032 §4). Métrica sem lastro não
entra pela metade (regra 7 da RETOMADA).

### 4. Defaults declarados, nunca fato

`actions.policy` nasce com: `get_customer`, `search_products`, `get_orders`,
`send_message` (só em conversa ativa — guarda de estado de D33 continua),
`transfer_to_human`, `request_confirmation`, `create_task`, `assign_owner`,
`resume_ai` = `allow`; `create_order`, `update_order_quantity` = `approve` (é o
D33 de hoje, agora explícito); `export_customer_data`, `delete_customer_data`
= `block` (já eram só humanas pelo catálogo; a política torna a recusa
legível na tela). `ai.limits.daily_turns=0` (sem limite até a organização
escolher). `handoff.assignment=queue`. Nenhuma regra nasce criada. O
proprietário e cada organização mudam pela tela.

### 5. §B16 — specs herdadas de suporte em modo de edição

`tests/e2e/suporte-temporario.spec.ts` e o trecho de acompanhamento de
`tests/e2e/agenda-presenca-recuperacao.spec.ts` afirmam edição dentro da
organização acompanhada (`access_mode=full`), modo que a rota SaaS não emite
desde a F11-T02 (só `support_readonly`). Decisão do proprietário (14/09):
**reescrever as asserções para só-leitura** — a spec passa a afirmar que a
escrita é recusada e a leitura funciona. Nenhuma spec apagada nem pulada
(D30); as duas continuam fora do inventário do gate (`e2e.yml` as roda).

## Alternativas rejeitadas

- **Política por RISCO apenas (o D33 de hoje).** Não distingue `create_task`
  de `create_order` sem mudar o risco no catálogo — e o risco é propriedade
  da ação, não da organização. Política por ação é o que D40 pede.
- **Tabela nova `ai_policies`.** D21 já dá o lugar (`tenant_settings`, uma
  linha por chave com `source`); tabela nova exigiria RLS, prova e MANIFEST
  para repetir o que a Setting faz. Mesmo motivo de ADR-034.
- **Motor de regras novo em `src/`.** O herdado tem condições, throttle,
  adiamento pela janela e runs auditadas provados no Deskcomm; reescrever
  seria REFAZER o que D29 manda ADAPTAR. O que se restringe é o vocabulário
  de ações, não o motor.
- **Manter as 7 ações herdadas disponíveis nas regras SaaS.** `call_webhook`
  é HTTP arbitrário (D18 proíbe), `send_whatsapp`/`send_ai_message` enviam
  fora do `send_message` do catálogo (invariante 3 de §5.7), `assign_owner`
  herdado é usuário fixo (a fila da F13 é por rodízio). Ficam registradas no
  motor para o kit herdado; a rota SaaS e a guarda do motor as recusam para
  organizações desta base.
- **Idempotência das regras só em memória.** `automation_rule_runs` sem
  índice único deixa dois drains concorrentes executar `send_message` duas
  vezes para o cliente; o índice parcial fecha isso no banco (G-57).
- **Limite em custo estimado (R$/dia).** Depende da tarifa configurada por
  modelo; turnos são o que `ai_usage_events` conta sem tarifa. O custo real
  vai para `ai_real:`.
- **Ingestão por URL ou upload nesta fase.** HTTP de saída novo exige
  allowlist e trata texto externo como dado (D18); é escopo declarado como
  fora pelo proprietário.
- **Turnos reais dentro do gate.** O gate força mock por desenho (D12, D25);
  uma linha real dentro do bloco seria métrica sem o lastro do gate.

## Consequências

- `tenant_settings` ganha 2 chaves (`actions.policy`, `ai.limits.daily_turns`)
  e `handoff.assignment` ganha um valor — o schema de §5.2 passa de 28 para
  30 entradas; 1 migration (9027) só com índice; nenhuma tabela nova, nenhuma
  prova de RLS nova.
- Catálogo passa de 12 para 13 entradas (`assign_owner`); `toolsFor(ctx, "ai")`
  continua devolvendo NOVE (D18): `assign_owner` é `automation`+`human`.
- `ActionDenyReason` ganha `policy_blocked` e `policy_transferred`. O enum de
  motivos de handoff (D19) NÃO cresce: `transfer` e o limite diário usam
  `tenant_rule` ("regra do tenant" da lista única) com o resumo dizendo qual
  regra — a unit `f05-t01-gatilhos` afirma oito motivos e continua verdadeira.
- `approve` pendura pela conversa (`pending_actions` exige `conversation_id`,
  D33): uma ação SEM conversa na entrada (`create_task`) sobrescrita como
  `approve` é negada com `invalid_input: conversation_required_for_confirmation`
  — a tela avisa; a prova exercita `approve` em `create_order`.
- `authorizeCrmCommand` aceita `ai_agent`/`automation` só para `tasks.create`
  (organização ativa); `crm_task_command_receipts`/`crm_task_events` já
  tinham CHECK `user|ai|automation` e recebem o tipo e o id do turno/run. O
  recibo idempotente do executor não humano é por TIPO (o id do turno muda a
  cada tentativa e um replay legítimo tem de bater). O corte do lembrete PJ
  (F05-T08) passa a criar a tarefa em vez de gravar `non_human_executor_denied`
  — as suítes `f04-action-policy` e `f05-lembrete-resposta` mudam de
  expectativa por esta decisão (D30: justificado, não afrouxado).
- Eventos de notificação passam de 9 para 10 (`ai.limit_reached`) — o CHECK
  das duas tabelas é reconstruído por ADIÇÃO na **migration 9028** (a
  segunda da fase: a 9027 é a idempotência das runs); `f05-t05` (unit e
  invariante) e `f12-t01-billing-schema` passam a afirmar dez.
- `handoffs.assigned_to`/`assigned_at` (**migration 9029**, a terceira da
  fase; sem FK, como `claimed_by`): em `round_robin` o dossiê nasce entregue
  (`src/handoff/rodizio.ts`), só o atribuído o vê na fila e é avisado, e o
  claim de outro é `assigned_to_other`. Atribuição não é claim.
- O limite diário mora no resolver PADRÃO de Entitlement
  (`resolverComLimiteDiario(resolverPorPlano)`, `src/ai/limite.ts`): `ai.reply`
  é negada com `daily_limit_reached` antes do provedor; quem injeta `resolver`
  (o dublê de D36) continua mandando. O aviso ao `tenant_admin` é um por dia
  (`jaAvisado`, dentro de `src/notifications`).
- `event_log` recebe três tipos novos (`conversation.resolved`,
  `order.confirmed`, `task.overdue`); o `EXPECTED_ENTITY_KIND` do motor ganha
  as três entradas (`conversation`, `crm_order`, `crm_task`).
- Inventário do navegador: 14 specs, 65 testes por tenant (58 + 7).
- Produção recebe o código da F15 só DEPOIS do READY (staging): `bash
  scripts/prod/up.sh` (rebuild + baseline com o apêndice 9027) e `bash
  scripts/prod/prova.sh` → linha `prod:` nova no BUILD-STATE.

## Data

2026-09-14

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-036-F15-automacao-e-autonomia-de-ia.md`).
