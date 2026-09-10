# F02/T04 — matriz auditável das APIs do CRM

Base lida: checkpoint T03 `ef4e32ecf75cebe891e8013da049a2488dcaae84`, somado ao patch T04 mantido neste diretório. Este mapa é inventário e régua; ele não declara a T04 concluída.

## Denominadores

O inventário lê 18 módulos de rota e 29 operações HTTP reais, listadas em `operations.txt`:

- 14 leituras e 15 escritas;
- 5 identidades relevantes por operação: `viewer`, `agent`, `manager`, `support_readonly` e sessão ausente;
- `role_cells = 29 × 5 = 145`;
- duas posições do mesmo membro A/B: A ativa e B ativa;
- `active_org_cells = 29 × 2 = 58`;
- 9 tabelas de domínio F02 exercitadas pelo isolamento RLS geral: `contacts`, `crm_companies`, `catalog_products`, `crm_orders`, `crm_order_items`, `crm_order_events`, `crm_notes`, `crm_tasks`, `crm_task_events`. Os receipts privados têm provas próprias e não entram como entidade HTTP.

Expectativa de papel por classe:

| classe                         | operações | células |                                          permitidas |                                              negadas |
| ------------------------------ | --------: | ------: | --------------------------------------------------: | ---------------------------------------------------: |
| leitura `viewer+`              |        14 |      70 | 56 (`viewer`, `agent`, `manager`, suporte readonly) |                                      14 (sem sessão) |
| escrita `agent+`               |        12 |      60 |                             24 (`agent`, `manager`) |          36 (`viewer`, suporte readonly, sem sessão) |
| escrita de catálogo `manager+` |         3 |      15 |                                       3 (`manager`) | 12 (`viewer`, `agent`, suporte readonly, sem sessão) |
| **total**                      |    **29** | **145** |                                              **83** |                                               **62** |

A coluna “prova” distingue camadas: `G` guard de rota, `A` comportamento HTTP, `S` serviço transacional, `R` RLS/constraints, `E` navegador real, `T` prova preparada fora da árvore. Uma prova de uma camada não é contada como se cobrisse outra.

## Matriz entidade × operação

| ID  | entidade / operação              | papel mínimo | escopo ativo na borda                                          | prova existente                                                                                                                                                                                                 | lacuna material                                                                       |
| --- | -------------------------------- | ------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| C01 | `GET /contacts`                  | viewer       | `resolveActiveOrg` → handler                                   | E: `f02-crm-orders.spec.ts:92-99`, A(handler): `contatos-lista-ordenacao.test.ts`                                                                                                                               | falta 401 direto da rota; não usa `requireRole`                                       |
| C02 | `POST /contacts`                 | agent        | `authz.org.orgId`                                              | E: `f02-crm-cadastros.spec.ts:130-139`; T: `f02-api-active-org.spec.ts`; R: `f02-t01-crm-schema.test.ts:176-276`                                                                                                | executar a prova A/B preparada; suporte readonly continua na matriz de papel          |
| C03 | `GET /contacts/[id]`             | viewer       | `resolveActiveOrg` → handler                                   | E: positivo/foreign `f02-crm-cadastros.spec.ts:140-144,248-249`; T: `f02-api-active-org.spec.ts`                                                                                                                | executar A/B preparado; falta 401 direto, pois não usa `requireRole`                  |
| C04 | `PATCH /contacts/[id]`           | agent        | `authz.org.orgId`                                              | E: positivo + viewer 403 `f02-crm-cadastros.spec.ts:163-172,274-278`; T: `f02-api-active-org.spec.ts`; R: `f02-t01-crm-schema.test.ts:176-276`                                                                  | executar A/B preparado; suporte readonly continua na matriz de papel                  |
| C05 | `DELETE /contacts/[id]`          | agent        | `authz.org.orgId` no handler                                   | T: próprio/foreign A/B em `f02-api-active-org.spec.ts`; A(handler): `contato-delete.test.ts:59-84`; R: `f02-t01-crm-schema.test.ts:176-276`                                                                     | executar A/B preparado; viewer, suporte e sessão ausente continuam na matriz de papel |
| C06 | `GET /contacts/[id]/timeline`    | viewer       | **patch T04:** `requireRole` + org em contato/leads/atividades | T: `contact-readers-active-org.test.ts`                                                                                                                                                                         | promover patch; remover rota da dívida do scanner                                     |
| C07 | `GET /contacts/[id]/crm-summary` | viewer       | **patch T04:** `requireRole` + org nas 6 leituras              | T: `contact-readers-active-org.test.ts`                                                                                                                                                                         | promover patch; remover rota da dívida do scanner                                     |
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

## Cobertura por camada

### Guard de sessão e papel

- `rotas-api-tem-gate-de-papel.test.ts:147-180` garante que rota nova não nasce sem gate; C06/C07 já foram removidas da dívida datada após receberem gate.
- `f02-api-session-composition.test.ts` preparado chama o ramo real `loadAuthUser() === null` de `requireRole`, exige 401 `unauthenticated`, conecta 27 handlers ao gate com o mínimo literal esperado e chama C01/C03 reais com `getUser() = null`. Resultado focal observado fora da árvore: `session_absent=29/29` por composição.
- `rbac-matrix.test.ts` mede todas as permissões D15 × três papéis e o papel nulo. Isso prova o núcleo `orders.write`, `tasks.create`, `notes.create`; não prova que cada rota chamou o gate certo.
- O mesmo teste focal exerce a tabela real de rank `viewer/agent/manager` contra os três mínimos usados. Junto do scanner método→mínimo, isso dá proveniência às 87 células de papel tenant sem repetir 87 mocks de handler.
- `f02-api-support-readonly-scanner.test.ts` preparado conecta `requireSupportWrite()` a `15/15` escritas e reprova `15/15` fontes mutadas em memória com a chamada removida. `suporte-guardas.test.ts` continua sendo a prova comportamental do 403 readonly.
- `f02-support-readonly-api.spec.ts` abre e encerra uma sessão real de suporte readonly, sem membership no tenant observado e sem depender de Realtime/WAHA. Ela lê cadastros, catálogo, pedidos e trabalho (`4/4` grupos), recusa uma escrita válida em cada grupo (`4/4`) e compara estado, recibo e auditoria antes/depois.

### API e organização ativa

- Prova executada simétrica A ativa/B ativa existe para 11/29 operações: C01, P01, O01–O04, N01–N02 e T01–T03. Isso corresponde a `22/58 active_org_cells`.
- C06/C07 foram corrigidas e promovidas; as quatro células do navegador aguardam execução. Seus nove testes unitários passaram na árvore atual.
- As 16 operações C02–C05, E01–E05, P02–P04 e L01–L04 passaram nas `32/58` células reais de `f02-api-active-org.spec.ts`. Com as 22 anteriores, são `54/58` células executadas; as quatro preparadas de C06/C07 não entram nesse numerador.
- As recusas de PATCH/DELETE por ID da outra organização comparam estado e auditoria antes/depois. P04 e C05 agora têm prova HTTP simétrica, além das provas transacionais dos serviços de pedidos e trabalho.

### Serviço

- Pedido: `crm-orders.test.ts`, 20/20, cobre autorização transacional, papel, org suspensa/revogada, IDs cruzados, replay, revisão, rollback e LGPD.
- Notas/tarefas vinculadas: `crm-work.test.ts`, 15/15, cobre autorização, IDs cruzados, concorrência, journal/audit atômicos e LGPD.
- Empresas, catálogo, contatos e tarefas legadas escrevem via cliente de sessão/handlers; sua autoridade final é guard + RLS, sem um serviço transacional F02 equivalente.

### RLS e constraints

- `rls-isolation.test.ts:379-458` inclui as 9 tabelas F02 listadas no denominador e mede leitura própria + recusa A→B; os testes F02 específicos completam direção B, ACL e papel conforme a tabela.
- Empresas/contatos: `f02-t01-crm-schema.test.ts:176-335` prova viewer read-only, agent próprio/cross e suporte readonly.
- Catálogo: `catalogo-so-gestor-muda-preco.test.ts:101-215` prova agent lê mas não escreve, manager A/B escreve só o próprio e anon sem grant.
- Pedidos: `f02-t02-order-schema.test.ts:123-297` prova domínio read-only, receipts privados, leitura A/B e journal append-only.
- Trabalho: `f02-t03-work-schema.test.ts:105-296` prova notas/eventos append-only, receipts privados, A/B, linked task sem DML direto e legado gravável.
- O catálogo reconciliado de 146 testes de schema/RLS/LGPD é evidência de camada banco. Ele não aumenta o numerador das 58 células de organização ativa da API.

## Estado auditável do checkpoint em construção

- Inventário: `route_modules=18/18`, `http_operations=29/29`.
- Papéis: `role_cells=145/145` catalogadas; a composição liga a tabela real de permissões aos handlers. Não são 145 chamadas HTTP independentes.
- Os dois scanners e leitores focais foram promovidos. Composição de sessão ausente: `29/29`; cercas de escrita readonly: `15/15`, com `15/15` remoções detectadas em memória.
- Organização ativa: `54/58` células de navegador executadas, quatro C06/C07 preparadas e pendentes. A primeira jornada API passou em 223,766 s no sandbox local.
- Suporte readonly real: jornada compacta preparada para leitura de quatro grupos e recusa de quatro escritas; navegador pendente.
- Banco F02: `schema_rls_lgpd=146/146` reconciliados; `rls_domain_tables=9/9` mapeadas. Recibos privados têm provas próprias.
- O catálogo falhou na navegação com 509 produtos por timeout da RLS legada de escrita. A migration 9011 separa comandos; a medição REST autenticada posterior retornou total509/50linhas em99ms e total509/500linhas em74ms. A navegação ainda precisa ser repetida após essa correção.

A tabela acima preserva os links de preparação por operação; este estado prevalece sobre seus rótulos históricos “preparado”. F02 e sua jornada completa continuam em andamento.


## Ampliação T08/T10/T12 (09/09/2026)

O inventário atual soma 34 operações em 21 módulos (17 leituras/17 escritas).
A composição de sessão cobre 32 handlers com requireRole e os dois leitores
legados com autenticação explícita; suporte readonly tem 17/17 escritores
conectados à guarda e 17 mutações de conexão detectadas. Esses números são
composição de testes e não representam 34 ou 170 requisições HTTP realizadas.
O inventário nominal está em f02-t04-api-operations.txt.

| ID | Operação nova | Autorização | Prova preparada/observada |
|---|---|---|---|
| S01 | GET settings/commercial | viewer+, suporte ativo; plataforma direta recusada no serviço | Unit/integração comercial e jornada API comercial A/B |
| S02 | PATCH settings/commercial | manager/admin; readonly negado; full support revalidado | Unit/integração comercial, auditoria/aliases e jornada API |
| D01 | GET crm-orders/daily | viewer+, suporte ativo; plataforma direta recusada | Unit e integração diária A/B, 501 itens/fuso; navegador final pendente |
| K01 | GET crm-orders/:id/checks | viewer+, invoker/RLS, plataforma direta recusada | Unit/API e DB; navegador final pendente |
| K02 | POST crm-orders/:id/checks | agente humano+; suporte negado; ator/organização revalidados | Unit/API e integração transacional; navegador final pendente |

As 54/58 células HTTP anteriores continuam históricas até a execução integral
final. As novas provas não são somadas a elas como se todas tivessem o mesmo
recorte ou tivessem sido executadas sobre o mesmo commit.
