# F02/T04 — matriz auditável das APIs do CRM

Base funcional: `5f3df2cf064e9c441d228ce3a956201e5403d692`. Checkpoint
integral verificado: `03ec6a3b56826ab882782efb1dd5185f47e52a8c`.
O gate07 aprovou o recorte E2E `13/13`, os mutantes `27/27` e registrou
`STATUS: READY (F02)`. Este mapa declara a conclusão técnica da fase dentro dos
limites de sandbox e mocks descritos abaixo.

## Denominadores

O inventário final lê 21 módulos de rota e 34 operações HTTP reais, listadas em
`f02-t04-api-operations.txt:1-34` @ `5f3df2cf`:

- 17 leituras e 17 escritas;
- 5 identidades relevantes por operação: `viewer`, `agent`, `manager`, `support_readonly` e sessão ausente;
- `role_cells = 34 × 5 = 170`, como inventário/composição de guardas e papéis;
- as 170 células **não** representam 170 requisições HTTP executadas;
- o recorte HTTP histórico usa duas posições do mesmo membro, A ativa e B ativa,
  sobre as 29 operações originais: `active_org_cells = 29 × 2 = 58/58`;
- 9 tabelas de domínio F02 exercitadas pelo isolamento RLS geral: `contacts`, `crm_companies`, `catalog_products`, `crm_orders`, `crm_order_items`, `crm_order_events`, `crm_notes`, `crm_tasks`, `crm_task_events`. Os receipts privados têm provas próprias e não entram como entidade HTTP.

Expectativa de papel por classe:

| classe                                    | operações | células |                                          permitidas |                                              negadas |
| ----------------------------------------- | --------: | ------: | --------------------------------------------------: | ---------------------------------------------------: |
| leitura `viewer+`                         |        17 |      85 | 68 (`viewer`, `agent`, `manager`, suporte readonly) |                                      17 (sem sessão) |
| escrita `agent+`                          |        13 |      65 |                             26 (`agent`, `manager`) |          39 (`viewer`, suporte readonly, sem sessão) |
| escrita de catálogo/configuração `manager+` |       4 |      20 |                                       4 (`manager`) | 16 (`viewer`, `agent`, suporte readonly, sem sessão) |
| **total de composição**                   |    **34** | **170** |                                              **98** |                                               **72** |

A coluna “prova” distingue camadas: `G` guard de rota, `A` comportamento HTTP,
`S` serviço transacional, `R` RLS/constraints, `E` navegador real e `T` teste de
organização ativa promovido e depois executado. Uma prova de uma camada não é
contada como se cobrisse outra. A última coluna preserva as lacunas registradas
no checkpoint inicial; elas são históricas e não substituem o estado final
observado após a tabela.

## Matriz entidade × operação

| ID  | entidade / operação              | papel mínimo | escopo ativo na borda                                          | prova existente                                                                                                                                                                                                 | lacuna no checkpoint inicial (histórica)                                               |
| --- | -------------------------------- | ------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| C01 | `GET /contacts`                  | viewer       | `resolveActiveOrg` → handler                                   | E: `f02-crm-orders.spec.ts:92-99`, A(handler): `contatos-lista-ordenacao.test.ts`                                                                                                                               | falta 401 direto da rota; não usa `requireRole`                                       |
| C02 | `POST /contacts`                 | agent        | `authz.org.orgId`                                              | E: `f02-crm-cadastros.spec.ts:130-139`; T: `f02-api-active-org.spec.ts`; R: `f02-t01-crm-schema.test.ts:176-276`                                                                                                | executar a prova A/B preparada; suporte readonly continua na matriz de papel          |
| C03 | `GET /contacts/[id]`             | viewer       | `resolveActiveOrg` → handler                                   | E: positivo/foreign `f02-crm-cadastros.spec.ts:140-144,248-249`; T: `f02-api-active-org.spec.ts`                                                                                                                | executar A/B preparado; falta 401 direto, pois não usa `requireRole`                  |
| C04 | `PATCH /contacts/[id]`           | agent        | `authz.org.orgId`                                              | E: positivo + viewer 403 `f02-crm-cadastros.spec.ts:163-172,274-278`; T: `f02-api-active-org.spec.ts`; R: `f02-t01-crm-schema.test.ts:176-276`                                                                  | executar A/B preparado; suporte readonly continua na matriz de papel                  |
| C05 | `DELETE /contacts/[id]`          | agent        | `authz.org.orgId` no handler                                   | T: próprio/foreign A/B em `f02-api-active-org.spec.ts`; A(handler): `contato-delete.test.ts:59-84`; R: `f02-t01-crm-schema.test.ts:176-276`                                                                     | executar A/B preparado; viewer, suporte e sessão ausente continuam na matriz de papel |
| C06 | `GET /contacts/[id]/timeline`    | viewer       | `requireRole` + org em contato/leads/atividades                | A: `contact-readers-active-org.test.ts`; E: próprio/foreign A/B `f02-api-active-org.spec.ts:387-416`                                                                                                             | suporte readonly positivo não isolado                                                 |
| C07 | `GET /contacts/[id]/crm-summary` | viewer       | `requireRole` + org nas 6 leituras                             | A: `contact-readers-active-org.test.ts`; E: próprio/foreign A/B `f02-api-active-org.spec.ts:387-416`                                                                                                             | suporte readonly positivo não isolado                                                 |
| E01 | `GET /companies`                 | viewer       | `authz.org.orgId`                                              | A: `crm-empresas-api.test.ts:70-88`; E: `f02-crm-cadastros.spec.ts:104-128,241-247`; T: `f02-api-active-org.spec.ts`                                                                                            | executar o positivo/lista isolada A/B preparado                                       |
| E02 | `POST /companies`                | agent        | org/ator só da sessão                                          | A: `crm-empresas-api.test.ts:90-113,139-164`; E: `f02-crm-cadastros.spec.ts:100-128,264-268`; T: manager A/B em `f02-api-active-org.spec.ts`                                                                    | executar A/B preparado; agent positivo distinto continua na matriz de papel           |
| E03 | `GET /companies/[id]`            | viewer       | org + id                                                       | A: `crm-empresas-api.test.ts:124-137,150-164`; E: `f02-crm-cadastros.spec.ts:174-185`; T: próprio/foreign A/B em `f02-api-active-org.spec.ts`                                                                   | executar A/B preparado                                                                |
| E04 | `PATCH /companies/[id]`          | agent        | org + id                                                       | A: `crm-empresas-api.test.ts:115-137,139-164`; T: próprio/foreign A/B em `f02-api-active-org.spec.ts`                                                                                                           | executar A/B preparado; agent positivo distinto continua na matriz de papel           |
| E05 | `DELETE /companies/[id]`         | agent        | org + id                                                       | A: foreign/support/gate/conflito `crm-empresas-api.test.ts:124-176`; E: FK 409 `f02-crm-cadastros.spec.ts:188-190`; T: próprio/foreign A/B em `f02-api-active-org.spec.ts`                                      | executar a exclusão A/B preparada                                                     |
| P01 | `GET /products`                  | viewer       | `authz.org.orgId`                                              | E: A/B real `f02-crm-orders.spec.ts:100-109`; E: isolamento `f02-crm-cadastros.spec.ts:233-254`; R: `catalogo-so-gestor-muda-preco.test.ts:101-116`                                                             | papel viewer positivo não é isolado na API                                            |
| P02 | `POST /products`                 | manager      | org/moeda só da sessão                                         | E: manager positivo `f02-crm-cadastros.spec.ts:191-210`; T: manager A/B em `f02-api-active-org.spec.ts`; R: agent negado `catalogo-so-gestor-muda-preco.test.ts:118-152`                                        | executar A/B preparado; suporte readonly continua na matriz de papel                  |
| P03 | `PATCH /products/[id]`           | manager      | org + id                                                       | A: `catalogo-unidade-venda.test.ts:48-99`; E: `f02-crm-cadastros.spec.ts:212-232`; T: próprio/foreign A/B em `f02-api-active-org.spec.ts`; R: manager/agent A/B `catalogo-so-gestor-muda-preco.test.ts:118-203` | executar A/B preparado                                                                |
| P04 | `DELETE /products/[id]`          | manager      | org + id                                                       | T: sucesso próprio + foreign 404 A/B, estado/audit em `f02-api-active-org.spec.ts`; G: scanner; R: catálogo isola A/B                                                                                           | executar o foco HTTP preparado; agent/viewer/suporte continuam na matriz de papel     |
| O01 | `GET /crm-orders`                | viewer       | org + filtros                                                  | A: `crm-orders-api.test.ts:134-155`; E: A/B `f02-crm-orders.spec.ts:82-94`                                                                                                                                      | suporte readonly positivo não isolado                                                 |
| O02 | `GET /crm-orders/[id]`           | viewer       | org + id                                                       | A: `crm-orders-api.test.ts:134-155`; E: A/B + foreign `f02-crm-orders.spec.ts:82-280`                                                                                                                           | suporte readonly positivo não isolado                                                 |
| O03 | `POST /crm-orders/commands`      | agent        | TenantCtx/ator da sessão                                       | A: `crm-orders-api.test.ts:88-132`; S: `crm-orders.test.ts:197-624`; E: A/B, viewer 403, foreign 404 `f02-crm-orders.spec.ts:82-280`                                                                            | agent positivo distinto de manager na borda HTTP                                      |
| O04 | `GET /crm-orders/[id]/events`    | viewer       | org + order                                                    | A: `crm-orders-history-api.test.ts:33-69`; E: A/B + foreign `f02-crm-orders.spec.ts:82-280`                                                                                                                     | suporte readonly positivo não isolado                                                 |
| N01 | `GET /crm-notes`                 | viewer       | org + contact/order                                            | A: `crm-work-api.test.ts:225-309`; E: A/B + foreign + viewer `f02-crm-work.spec.ts:138-457`                                                                                                                     | suporte readonly positivo não isolado                                                 |
| N02 | `POST /crm-notes`                | agent        | TenantCtx/ator da sessão                                       | A: `crm-work-api.test.ts:124-223`; S: `crm-work.test.ts:581-727`; E: A/B `f02-crm-work.spec.ts:138-457`                                                                                                         | agent positivo distinto de manager na borda HTTP                                      |
| T01 | `GET /crm-orders/[id]/tasks`     | viewer       | org + order                                                    | A: `crm-work-api.test.ts:225-287`; E: A/B + foreign + viewer `f02-crm-work.spec.ts:138-457`                                                                                                                     | suporte readonly positivo não isolado                                                 |
| T02 | `POST /tasks/commands`           | agent        | TenantCtx/ator da sessão                                       | A: `crm-work-api.test.ts:124-223`; S: `crm-work.test.ts:339-579`; E: A/B, stale/replay/foreign `f02-crm-work.spec.ts:138-457`                                                                                   | agent positivo distinto de manager na borda HTTP                                      |
| T03 | `GET /crm-task-events`           | viewer       | org + contact/order                                            | A: `crm-work-api.test.ts:225-397`; E: A/B + foreign + viewer `f02-crm-work.spec.ts:138-457`                                                                                                                     | suporte readonly positivo não isolado                                                 |
| L01 | `GET /tasks`                     | viewer       | org da sessão; query não escolhe tenant                        | A: `tarefas-rota-nao-tem-porta-dos-fundos.test.ts:150-199`; E: legado A `f02-crm-work.spec.ts:375-412`; T: lista isolada A/B em `f02-api-active-org.spec.ts`                                                    | executar A/B preparado; suporte readonly continua na matriz de papel                  |
| L02 | `POST /tasks`                    | agent        | org/autor da sessão + contato pré-validado                     | A: `tarefas-rota-nao-tem-porta-dos-fundos.test.ts:201-345`; E: legado A `f02-crm-work.spec.ts:375-390`; T: manager A/B em `f02-api-active-org.spec.ts`                                                          | executar A/B preparado; suporte readonly continua na matriz de papel                  |
| L03 | `PATCH /tasks/[id]`              | agent        | org/id; linked 409; contato pré-validado                       | A: `tarefas-rota-nao-tem-porta-dos-fundos.test.ts:346-541`; E: legado A `f02-crm-work.spec.ts:391-402`; T: próprio/foreign A/B em `f02-api-active-org.spec.ts`                                                  | executar A/B preparado; suporte readonly continua na matriz de papel                  |
| L04 | `DELETE /tasks/[id]`             | agent        | org/id; linked 409                                             | A: `tarefas-rota-nao-tem-porta-dos-fundos.test.ts:346-551`; E: legado A `f02-crm-work.spec.ts:403-412`; T: próprio/foreign A/B em `f02-api-active-org.spec.ts`                                                  | executar A/B preparado; suporte readonly continua na matriz de papel                  |

## Ampliação integrada de T08/T10/T12

As cinco operações acrescentadas ao inventário original estão implementadas no
mesmo commit da prova final:

| ID  | operação                                | papel mínimo | prova observada |
| --- | --------------------------------------- | ------------ | --------------- |
| S01 | `GET /settings/commercial`              | viewer       | configuração A/B no navegador |
| S02 | `PATCH /settings/commercial`            | manager      | persistência A/B e recusa do viewer |
| D01 | `GET /crm-orders/daily`                 | viewer       | daily A/B com recorte, fuso, 501 itens e PDF completo |
| K01 | `GET /crm-orders/[id]/checks`           | viewer       | leitura própria/cross-tenant e histórico A/B |
| K02 | `POST /crm-orders/[id]/checks`          | agent        | pendente/parcial/completa, replay, revisão vencida e viewer 403 |

Essas cinco operações completam `34/34` no inventário e na composição. Elas não
são somadas ao denominador HTTP histórico de `58/58`, pois foram exercitadas por
casos integrados com recorte diferente.

## Cobertura final observada por camada

### Sessão, papel e suporte

- `tests/unit/f02-api-session-composition.test.ts:299-381` @ `5f3df2cf`
  chama a recusa 401 real, conecta `32/34` operações a `requireRole` com o mínimo
  esperado e chama os dois leitores manuais C01/C03. O resultado é composição,
  não 170 chamadas HTTP.
- `tests/unit/f02-api-support-readonly-scanner.test.ts:92-110` @ `5f3df2cf`
  conecta as `17/17` escritas a `requireSupportWrite` e detecta `17/17` remoções
  em memória. Isso prova a cerca em cada handler; o caso HTTP usa quatro escritas
  representativas.
- `tests/e2e/f02-support-readonly-api.spec.ts:217-380` @ `5f3df2cf` abriu suporte
  sem membership no tenant observado, leu `4/4` grupos, recusou `4/4` escritas e
  preservou contato, catálogo, pedidos, notas e recibo. Pedidos/notas produziram
  exatamente `2` registros `authz.denied`, correlacionados ao header
  `x-request-id`, ator, organização, recurso e sessão de suporte (`:325-355`).
- O proxy gera ou ecoa UUID canônico e o encaminha à rota conforme
  `tests/unit/request-id-correlation.test.ts:10-65` @ `5f3df2cf`. O navegador
  comprovou um ID gerado e outro fornecido pelo cliente na correlação real acima.

### Organização ativa e navegador

- O recorte HTTP original permanece `58/58`: `26/58` células vieram das jornadas
  existentes das operações C01, C06–C07, P01, O01–O04, N01–N02 e T01–T03;
  `32/58` vieram das 16 operações simétricas em
  `tests/e2e/f02-api-active-org.spec.ts:372-416` @ `5f3df2cf`.
- C06/C07 devolveram 200 para o contato próprio e 404 para o estrangeiro nos dois
  sentidos (`f02-api-active-org.spec.ts:387-416`). PATCH/DELETE estrangeiros
  conservaram o estado comercial e emitiram somente a auditoria de recusa esperada
  (`f02-api-active-org.spec.ts:278-349`).
- Navegação A/B passou em `tests/e2e/f02-crm-navigation.spec.ts:65-353` @
  `03ec6a3b`; a leitura do viewer espera o GET, exige HTTP200, confere a fixture
  exata na resposta e depois sua exibição na UI (`:316-337`). A jornada segue
  cobrindo catálogo completo, ficha e início do pedido. Daily/checks A/B passou em
  `tests/e2e/f02-daily-checks.spec.ts:168-385`: 501 itens, PDF com os 501 índices
  duas vezes, impressão sem escrita, conferência, replay, revisão vencida,
  isolamento e viewer 403 (`:180-250`, `:252-380`).

### Banco e limites da contagem

- `tests/integration/rls-isolation.test.ts:379-458` cobre as 9 tabelas F02 do
  denominador; as provas específicas permanecem referenciadas na matriz.
- O verify07 aprovou `unit=8380/8380`, `integration=72/72` e `db=1585/1585`,
  registrados respectivamente em
  `.verify-logs/f02-final-07/run.Zmng5CLM/{unit,integration,db}.json:1`.
  Essas contagens globais não aumentam os denominadores HTTP `58/58` nem as
  quatro escritas representativas do caso de suporte.

## Execuções integrais e fechamento

O relatório `.verify-logs/f02-final-05/run.w9FWFLk8/e2e.json:101-190,599-752`
registra `13/13` casos esperados, `skipped=0`, `unexpected=0`, `flaky=0` e
`duration=999983.488ms`. Nele passaram a matriz de organização ativa, C06/C07,
configuração comercial, navegação A/B, pedidos A/B, trabalho A/B, daily/checks
A/B e suporte readonly.

As tentativas anteriores continuam como histórico: `final01` fechou `9/13` e
expôs falhas de espera na navegação, extração do PDF e captura da resposta de
suporte; `repairs03` comprovou daily/checks e isolou a captura de saída; `repairs04`
revelou que o proxy respondia com ID diferente da auditoria. A ADR-015 levou ao
encaminhamento canônico comprovado no `final05`; nenhum desses resultados parciais
é reclassificado retroativamente como aprovação integral.

O gate05 executou 27 scripts mutantes e aprovou 23/27; os mecanismos 01/02/03/26
exigiram reparo. O gate06 aprovou 27/27, mas terminou NOT READY com E2E12/13; a
correção de espera em `03ec6a3b` passou A/B2/2. Esses resultados permanecem como
histórico e não são reclassificados.

O gate07 sobre `03ec6a3b` terminou em 10/09/2026 com exit 0 após `4617.77s`, às
`2026-09-10T06:11:30Z`. Tipos,
lint, build, shell, secrets e igualdade dos inputs passaram; unit8380/8380,
integração72/72, DB1585/1585 e E2E13/13 em sete specs passaram sem skip, falha,
ou flaky; mutantes27/27, `tests_pending=0`, `debt_known=0` e violações0. Os
indicadores das fases futuras continuam `pending` e não entram no fechamento de
F02. O resumo literal está em
`.verify-logs/f02-final-07/orchestration.log:1-33` e o término em
`.verify-logs/f02-final-07/result.json:1-4`. O número 30 identifica o mutante de
encaminhamento de request ID e não é denominador.

F02 está tecnicamente concluída no escopo de empresas fictícias, sandbox local e
WhatsApp/IA mock. Conforme D47, a construção pausa antes de F03. Aceite visual do
proprietário, operação Deka, provedores reais, E2E integral do upstream e produção
não foram validados; por D48, dados e operação Deka não bloqueiam este fechamento.
