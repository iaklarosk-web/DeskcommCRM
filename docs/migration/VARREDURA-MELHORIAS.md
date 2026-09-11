# Varredura de melhorias e correções — achados desta construção

Lista viva, montada enquanto F03 e F04 eram construídas. **Nada aqui é aplicado
sem pedido** (ADR-020, decisão 6): achado novo aplicado junto com a entrega é
escopo crescendo depois do "pronto".

Cada item diz o que foi medido, onde, e se já está consertado.

---

## A. Consertados durante a construção (ficam aqui como registro)

### A1. Preço de modelo dependia da ordem das chaves do objeto
`estimatedCostCents` casava o id do modelo por prefixo iterando o objeto, então
`gpt-4o-mini` podia ser cotado pela linha de `gpt-4o` — **15 vs 250 USD por
milhão de tokens, ~16×**. Latente desde a F01. Corrigido para casar o MAIOR
prefixo, com teste de regressão afirmando os dois números.
`lib/agent-engine/edge/llm/pricing.ts`, commit `69e6715b`.

### A2. Duas contabilidades de consumo, uma cega
`llm_calls` era escrita por `runModelCall` e lida pelo orçamento;
`ai_usage_events` existia desde a F01 **sem nenhum chamador de produção**, com
uma segunda tabela de preço. Ligar as duas por fora teria contado cada chamada
duas vezes. Unificado num CTE só, com `llm_call_id` único parcial — dupla
contagem virou `23505`. Commit `69e6715b`.

### A3. Teste de corrida que afirmava ordem de chegada
`crm-task-legacy-safety` usava `Promise.race` e exigia que o primeiro desfecho
fosse a vítima do deadlock. O Postgres solta os locks da vítima ao abortá-la, o
sobrevivente termina logo atrás, e a ordem é corrida de microtask. Passou nos
gates anteriores por sorte; reprovou o gate 02 da F03. Agora afirma a partição
(exatamente uma abortada com `40P01`, exatamente uma sobrevivente), que é mais
forte. Commit `6d742a6b`.

### A4. Dois mutantes dependiam de ripgrep, que não é dependência do repo
`02-verify-metrica-ausente.sh` usava `rg`. Num shell sem ripgrep o `if ! rg …`
inverte e o script se declara "MUTANTE VIVO" por ausência de ferramenta — um
gate que só fecha numa máquina. Trocado por `grep -qE`. Commit `073a07d8`.

### A5. Rota de webhook caía com mensagem legítima de cliente
Mensagem anterior ao fechamento do atendimento alcançava a transição a partir
de `archived`, cujo efeito `new_conversation` o schema herdado não comporta:
500 com a linha já gravada. A fronteira herdada passou a preceder a máquina.
ADR-019, commit `ec0d7c75`.

### A6. Resolver pelo inbox não encerrava de verdade
D16 `resolved` traduzia para o legado `resolved`, mas o produto só conta
`["closed","archived"]` como encerrado: a conversa sumia da aba "Fechadas",
seguia em `exclude_finished` e escapava do varredor de silêncio. Commit
`b101e239`.

### A7. Duas tabelas novas sem prova comportamental de RLS
`mock_outbox` e `job_runs` tinham prova de CATÁLOGO (policies, grants), não de
comportamento. O gate 01 da F03 as pegou. Prova real escrita em dois tenants,
com anti-vácuo medido nas duas. Commit `3072959a`.

### A8. Sandbox do gate não era reproduzível
A receita do ambiente de navegador só existia como cópia de `config.toml` na
evidência da F02. Virou `scripts/verify/sandbox.sh`, que a deriva do config
versionado por substituições conferidas e cria as extensões que o baseline
referencia e não cria. Commits `8ebad6d3` e `b101e239`.

---

## B. Achados NÃO consertados — proposta para o proprietário

### B1. Spec herdada que passa sem provar nada
`tests/e2e/inbox-responder-citando.spec.ts` procura `li, [role='listitem']`,
mas a lista renderiza `<button data-conversation-id>` desde antes da F02
(medido em `3c1f6f6e:components/inbox/ConversationListItem.tsx:172`). A guarda
do próprio spec então PULA os dois testes, e um teste que se pula sozinho é um
teste que afirma verde sem medir nada.
**Proposta:** corrigir o seletor e exigir que a jornada realmente abra a
conversa; se ela não puder rodar, declará-la fora do CI explicitamente em vez de
deixá-la pular em silêncio. Custo: baixo. Risco de não fazer: uma jornada de
resposta citando mensagem sem cobertura real.

### B2. 73 tabelas em `DEBITO_CONHECIDO` sem prova comportamental de RLS
`tests/invariants/rls-completude-varredura.test.ts` fotografou a dívida herdada
em 2026-08-27. A lista não cresceu nesta construção (tabela nova entra em
`TABLES` ou `PROVA_PROPRIA`, nunca ali), mas também não encolheu.
**Proposta:** uma tarefa por fase que mova N tabelas da dívida para prova real,
com o denominador caindo de forma visível no bloco do gate. Custo: médio,
divisível. Risco de não fazer: o isolamento dessas tabelas continua afirmado
pelo catálogo, não pelo comportamento.

### B3. `baseline.sql` mente se lido linearmente
O corpo vem de `pg_dump` e os apêndices o corrigem mais adiante no MESMO
arquivo: `ai_knowledge_sources.agent_id` aparece `NOT NULL` na linha 1113 e é
tornado anulável pelo apêndice da 0181 na 16365. Um agente (e uma pessoa) que
leia só o corpo conclui o oposto do estado real. Aconteceu nesta construção.
**Proposta:** um teste que, para cada coluna cujo corpo e apêndice divergem,
exija um comentário no corpo apontando o apêndice; ou gerar o baseline já
consolidado. Custo: médio. Risco de não fazer: decisões de schema tomadas
contra um estado que não existe.

### B4. `skip_only_occurrences=15` — inventariadas e classificadas

O campo é informativo por desenho (§8.3) e `tests_skipped=0` continua verdadeiro
no gate: nenhum teste do inventário obrigatório é pulado. As 15 ocorrências
foram lidas uma a uma. **Doze são legítimas, três não são.**

Legítimas — guarda de credencial ausente (D12: sem credencial, a fase fecha com
mock e a prova real fica marcada, não inventada):
`acervo-de-conhecimento.spec.ts:228,260,287,315` (`OPENAI_API_KEY_E2E`),
`followup-dossie.spec.ts:188` e `system-update.spec.ts:46` (`INTERNAL_SECRET`),
`agenda-google-volta-do-consentimento.spec.ts:108` (sem credencial Google),
`journeys/canal-oficial.spec.ts:93` (`META_SYSTEM_USER_TOKEN`).

Legítima — estado inalcançável naquele tenant:
`acervo-de-conhecimento.spec.ts:197` (a organização já tem chave de embedding,
então o estado "esperando" não existe ali).

Não são skip: `entrega-sem-tela-declara-quem-prova.test.ts:57,149` são o
COMENTÁRIO e a STRING de um teste que detecta teste falso — ele afirma que
`test.skip("depois eu faço", () => {})` NÃO conta como teste vivo. E
`tests/verify/gate.cases.mjs:396` é conteúdo de um arquivo-fixture gerado
dentro do próprio teste do gate.

**Os três que merecem ação:**

1. `agenda-conectar-google.spec.ts:126` — `test.skip("conectar a agenda do
   Google pela tela e ver a faixa mudar", …)`: skip **incondicional**, uma
   jornada inteira desligada. O comentário explica (falta conta Google de teste
   com consentimento pré-aprovado), o que é honesto, mas o resultado é uma
   jornada que nunca roda e nunca aparece como dívida em contador nenhum.
2. e 3. `inbox-responder-citando.spec.ts:76,104` — é o B1: a guarda pula porque
   o seletor nunca acha conversa, então dois testes afirmam verde sem medir.

**Proposta:** os dois casos são a mesma doença com gravidades diferentes — teste
que não roda e não é contado como não rodando. Ou viram dívida declarada num
contador do bloco (como `expected_failures` já é), ou o seletor/credencial é
consertado. Custo: baixo para o B1; o de agenda depende de conta de teste, que
é item humano.

### B5. `create_task` pela IA é negada pelo domínio
`executeLinkedTaskCommand` exige executor humano com sessão, então a tool
`create_task` de D18 volta `denied: non_human_executor_denied` quando a IA a
chama. Está declarado em código e em teste, não escondido — mas D18 lista
`create_task` como tool da IA.
**Decisão necessária (§5.5):** abrir a escrita do CRM a executor não-humano com
auditoria própria, ou retirar `create_task` do subset da IA e ajustar D18.
Hoje o catálogo promete uma coisa e o domínio entrega outra.

### B6. `expirarConfirmacoes()` não tem Job que a chame
A expiração de confirmação por timeout existe e é provada, mas nenhum job em
`job_queue` a executa de hora em hora. Enquanto não houver, o
`confirmation.timeout` de D33/D34 só acontece se alguém chamar a função.
**Proposta:** registrar o job na F05, junto do cron por tenant do lembrete.

### B7. Turno faz ~14 idas ao banco só para ler Settings
Cada `getSetting` é uma consulta. É a porta sancionada de §5.2, e não foi
otimizada de propósito, mas o custo cresce por turno.
**Proposta:** leitura em lote por prefixo (`ai.*`) numa consulta, preservando a
fachada. Custo: baixo. Ganho: latência do turno.

### B8. Dois turnos de IA convivem declaradamente
O turno de lead herdado (`runAgentTurn`, 12 tools nativas + 57 MCP) e o turno
SaaS (nove tools de D18) coexistem — ADR-021 o registra e
`elegivelParaWorkerLegado` continua `false`, então ninguém recebe duas
respostas. Unificá-los é trabalho de F13/F15 e exige inventário de leitores.
**Risco enquanto durar:** duas superfícies de ferramenta com políticas
diferentes. A prova de que só uma responde precisa continuar existindo a cada
fase.

### B9. `.github/workflows/e2e.yml` e o escopo do token
O push da branch falha porque o token do `gh` não tem escopo `workflow`, e o
commit da F03-T09 registra a spec nova no workflow para a CI acompanhar o gate
local. `gh auth refresh -h github.com -s workflow` destrava.
**Enquanto não destravar:** o trabalho existe só localmente, e a CI não roda as
specs novas.
