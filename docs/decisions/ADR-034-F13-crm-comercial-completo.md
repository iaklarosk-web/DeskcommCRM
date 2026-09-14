# ADR-034 — F13: CRM comercial completo sobre a base herdada (funis/oportunidades, campos configuráveis, papéis/filas, histórico, tarefas, pedidos e relatórios)

Decisões da F13 que afetam mais de um módulo (AGENTS.md §8). §7.9 manda
decompor a fase em tasks antes de executar; D53 (c) autoriza a F13 como
próxima fase (engenharia em staging, sem número de WhatsApp, sem liberação
geral, sem Stripe). D15 e ADR-003 deixaram "papéis extras" para a Fase 2 — esta
ADR reabre a ADR-003 para o papel `manager`. O verificador muda em
[ADR-035](ADR-035-verify-v1.8-F13.md). §B17 (busca do painel do dono) é
consertado nesta fase, por esta ADR (§4).

## Contexto

O que §7.9 pede da F13 — "funis/oportunidades, campos configuráveis,
papéis/filas, histórico, tarefas, pedidos e relatórios; jornadas e permissões
passam; indicadores conferem com origem; evolução preserva dados/vínculos" —
já tem base no Deskcomm v1.17.0, medida em `187fde8f`:

| Existe | Onde | O que falta para a F13 |
|---|---|---|
| Funis e etapas por organização (`crm_pipelines`, `crm_stages`; toda organização nasce com o funil "Pedidos" por gatilho) | `supabase/baseline.sql:1477`, `:1497`, `:684` (`fn_seed_default_pipeline_for_org`); rotas `app/api/v1/pipelines/*`; tela `app/app/settings/tenant/pipelines` | provar por organização no gate (nenhuma spec de funil está no inventário) |
| Oportunidades (`crm_leads`: etapa, dono, valor em `_cents`, ganho/perda com motivo, `custom_fields`) e linha do tempo (`crm_lead_activities`) | `baseline.sql:1441`, `:1405`; `lib/leads/*`, rotas `app/api/v1/leads/*` | **fila**: oportunidade sem dono não tem fila nem distribuição; vínculo oportunidade → pedido (`crm_lead_links.target_kind='order'` existe no CHECK `:1434`, nenhum escritor) |
| Campos configuráveis: definição por FUNIL (`crm_pipelines.settings.fields`, `customFieldSchema` em `lib/schemas/settings.ts:134`), valor em `crm_leads.custom_fields` e `contacts.custom_fields` (`:18162`) | `lib/leads/campos-do-funil.ts` | definição por ORGANIZAÇÃO para contatos e empresas (D21: `tenant_settings`); `crm_companies` não tem coluna de valores; nenhuma prova de que apagar uma definição preserva os valores |
| Papéis: `viewer|agent|manager|admin` no CHECK herdado; matriz D15 com três papéis (`manager` → `tenant_admin` por ADR-003) | `src/rbac/matrix.ts`, `lib/auth/types.ts:23` | `manager` como papel D15 próprio (Fase 2 por D15): configura funil/campos, distribui a fila e lê relatório sem administrar usuários, produtos ou acervo |
| Fila de CONVERSAS por rodízio (`lib/routing/decide.ts`, `selectRoundRobin`) e fila de handoffs `queue` (`src/handoff/registro.ts`) | `lib/routing/*` | nada disso distribui OPORTUNIDADE; `handoff.assignment=round_robin` continua Fase 2 (F15: automação/handoff) |
| Tarefas (`crm_tasks`, `crm_task_events`), notas (`crm_notes`), pedidos (`crm_orders`/`crm_order_items`/`crm_order_events`, ADR-012) | `baseline.sql:17844`, `:24108`, `:24168`, `:23602`; `src/crm/*` | preservar; o vínculo com a oportunidade entra pela linha do tempo, sem tocar o contrato |
| Relatórios: `fn_attendant_metrics` (funil por etapa + ganho/perda por responsável), `fn_activity_report`, `fn_atrito_metrics` | `baseline.sql:5789`, `:18005`, `:10502` | um relatório COMERCIAL da organização (funil com valor, ganho/perda, fila, tarefas, pedidos por estado) cuja cada indicador é conferido contra a tabela de origem (contagem, não amostra) |

## Decisão

### 1. Vocabulário e o que NÃO muda

"Oportunidade" é o `crm_leads` herdado (D22: "pipeline/oportunidades na
expansão SaaS"); nenhum renome físico. `crm_orders` é o pedido operacional
(ADR-012) e o contrato não muda: a oportunidade se VINCULA a um pedido já
existente (`crm_lead_links`), nunca o cria por baixo. Nada da Deka em código
(D06): funis, etapas, campos e papéis da fila são configuração por organização.

### 2. Tasks (critério de saída com denominador)

| Task | Entrega | Critério de saída | Depende de |
|---|---|---|---|
| **F13-T00** | Esta ADR + ADR-035 (verify v1.8: F13 em `GATED_PHASES`, spec nova no inventário, linha `crm:`, `rbac: roles=4` a partir da F13, mutantes 66–68) + branch `feat/F13-crm-comercial` a partir de `187fde8f` + **§B17** (§4) | `node --test tests/verify/gate.cases.mjs` verde com o caso F13; §B17: `grep -c '::text' app/api/v1/admin/tenants/route.ts` = 0 e caso de spec (§4) | F08 fechada (`187fde8f`) |
| **F13-T01** | Campos configuráveis por ORGANIZAÇÃO: chaves `crm.fields.contacts` e `crm.fields.companies` em `tenant_settings` (tipo novo `custom_fields`: lista de `customFieldSchema`, ≤ 50, chaves únicas); migration `9026` acrescenta `crm_companies.custom_fields jsonb` (objeto, default `{}`), apêndice idempotente no baseline, MANIFEST; `src/crm/campos/` valida valor contra definição (tipo, obrigatório, opções) e é o ÚNICO validador — rotas de contatos e empresas passam por ele; tela `/app/settings/tenant/crm-fields` (papel `manager`+); apagar uma definição NÃO apaga valor gravado (evolução preserva dados) | integração: `fields_defined=F values_rejected=R/R values_preserved=V/V` com F ≥ 4, R ≥ 3 (tipo, obrigatório, opção), V = valores existentes antes de apagar a definição; e2e: campo criado na tela aparece no formulário da empresa e o valor volta do banco (2/2 tenants) | T00 |
| **F13-T02** | Papel `manager` (ADR-003 reaberta): `PAPEIS_D15` = 4; permissões novas `pipelines.manage`, `fields.manage`, `opportunities.assign`, `reports.read`; `manager` = `attendant` + as quatro; `tenant_admin` ganha as quatro; `attendant` e `platform_admin` negados; `papelD15DoHerdado('manager')` deixa de virar `tenant_admin`; `PAPEL_HERDADO.manager='manager'`; `validateSeed` aceita `manager`; rotas novas desta fase usam `requirePermission` | unit: `rbac: roles=4 denied_expected=D denied_actual=D` (D derivado da matriz; sobe em relação aos 19 de hoje); integração: `roles_denied=K/K` nas rotas novas (attendant em `distribute`, `fields` e `reports` → 403) | T00 |
| **F13-T03** | Fila de oportunidades: `crm.distribution` (`manual|round_robin`, default `manual`) e `crm.queue_roles` (default `["attendant"]`) em `tenant_settings`; `src/crm/oportunidades/`: `fila(ctx, pipeline)` = oportunidades `open` sem dono; `distribuir(ctx, pipeline)` = rodízio (`selectRoundRobin` de `lib/routing/decide.ts`, `lastAssignedAt` lido de `crm_leads.assigned_at`) entre membros aceitos cujo papel D15 está em `crm.queue_roles`; `reivindicar(ctx, id, user)` = claim (segundo claim → `409 already_assigned`); cada atribuição grava `assigned_at`, `owner_kind='user'` e uma linha `owner_assigned` em `crm_lead_activities`; rotas `GET /api/v1/crm/opportunities/queue`, `POST .../distribute` (`opportunities.assign`), `POST .../[id]/claim`; tela `/app/crm/fila` | integração: `queue_size=Q distributed=Q/Q balanced=1 (max-min<=1) second_claim_rejected=1/1 manual_mode_untouched=1/1 activities=Q/Q`; e2e: tela lista a fila, "Distribuir" esvazia e mostra o dono (2/2 tenants) | T02 |
| **F13-T04** | Histórico, tarefas e pedidos preservados: `POST /api/v1/crm/opportunities/[id]/link-order {order_id}` (pedido da MESMA organização; `crm_lead_links` `target_kind='order'`, `link_kind='order_of_opportunity'`, único por par) + linha `order_linked`; a linha do tempo da oportunidade (`GET /api/v1/leads/[id]/timeline`, herdada) mostra as linhas novas ao lado das herdadas (`lead_created`, `stage_changed`, `task_created`, emitidas pelas rotas PostgREST que a integração não alcança — a spec de navegador as confere); nenhuma tabela de pedido/tarefa/nota muda | integração: `history_types=H` (H ≥ 3 tipos distintos gravados pelo módulo de oportunidades numa jornada: `owner_assigned`, `owner_claimed`, `order_linked`) `orders_linked=1/1 cross_org_link_denied=1/1`; e2e: a linha do tempo da oportunidade criada pela rota mostra `lead_created` + `owner_assigned` + `order_linked` (3/3) | T03 |
| **F13-T05** | Relatório comercial: `fn_crm_report(p_org, p_from, p_to) returns jsonb` (migration 9026; `security invoker`, `stable`, `revoke … from public, anon`): `funnel[]` (etapa: abertas, `value_cents`), `closed` (ganhas/perdidas e valor no período por `closed_at`), `by_owner[]`, `queue_size`, `tasks` (abertas, vencidas, concluídas), `orders[]` por estado (contagem, `total_cents`); rota `GET /api/v1/reports/crm?from&to` (`reports.read`); tela `/app/reports/crm` | integração: `report_indicators=K/K` (K ≥ 8; cada indicador recalculado por SQL independente sobre a tabela de origem e comparado, inclusive o outro tenant = 0); e2e: tela mostra os mesmos números da rota (2/2 tenants) | T04 |
| **F13-T06** | Spec `tests/e2e/f13-crm-comercial.spec.ts` (inventário fechado: 3 jornadas × 2 tenants + 1 do painel do dono = **7 testes**), mutantes 66–68, i18n espanhol, `e2e.yml`, smoke, evidência, BUILD-STATE, FINAL-VALIDATION, produção (`scripts/prod/up.sh` + `prova.sh` DEPOIS do READY), COMECE-AQUI, custo | gate `READY (staging)` com a linha `crm:` medida; `mutants_killed` sobe 3; `prod: sha=<commit da F13>` | T01–T05 |

### 3. A linha `crm:` (o que a fase mede)

Gravada pela suíte de integração `tests/integration/f13-crm-comercial.test.ts`
via `gravarLinhaDoVerify("crm", …)`, como `admin:`/`billing:` (ADR-031):

```
crm: fields_defined=F values_rejected=R/R values_preserved=V/V queue_size=Q distributed=Q/Q balanced=1 second_claim_rejected=1/1 history_types=H orders_linked=1/1 cross_org_link_denied=1/1 report_indicators=K/K roles_denied=D/D
```

Contrato (ADR-035): `fields_defined>=4`, `values_rejected>=3` e igual ao
denominador, `values_preserved` igual ao denominador (≥ 1), `queue_size>=3`,
`distributed=queue_size`, `balanced=1`, `second_claim_rejected=1`,
`history_types>=3`, `orders_linked=1`, `cross_org_link_denied=1`,
`report_indicators>=8` e igual ao denominador, `roles_denied>=3` e igual ao
denominador.

### 4. §B17 — busca do painel do dono

`app/api/v1/admin/tenants/route.ts` monta `slug::text.ilike` dentro do `or`
e o PostgREST recusa o cast (500 em produção, VARREDURA §B17). `slug` já é
texto: a expressão vira `slug.ilike.%q%`. O caso de spec entra na spec NOVA
(`f13-crm-comercial`, jornada do dono: `?q=<slug de A>` devolve A e não B),
não na `f11-admin-e-entrada`: o inventário de F11/F12/F08 é fechado e
`EXPECTED_F11_E2E_TESTS` é afirmação independente (ADR-018) — mudar uma
fase fechada para consertar outra seria reescrever o passado.

### 5. Defaults declarados, nunca fato

`crm.distribution=manual` (a organização escolhe o rodízio); `crm.queue_roles=["attendant"]`;
nenhum campo configurável nasce definido (`crm.fields.*=[]`); o funil padrão
continua o herdado ("Pedidos", 8 etapas) — a organização renomeia/reordena
pela tela existente. O relatório não tem meta nem alerta: números e
denominadores, sem juízo (D27 é do proprietário).

## Alternativas rejeitadas

- **Tabela nova `crm_field_definitions`.** D21 já dá o lugar (`tenant_settings`,
  uma linha por chave, com `source`) e o merge de template da F16 precisa
  conhecer a origem de cada chave; uma tabela nova exigiria RLS, prova e
  MANIFEST para repetir o que a Setting já faz.
- **Definições de campo continuarem só por funil.** Empresa e contato existem
  fora de qualquer funil (ADR-012); a definição por funil fica para a
  oportunidade, que é onde nasceu.
- **Papéis personalizados (D15, "papéis personalizados") nesta fase.** Papel
  configurável é matriz por organização — muda `requireRole`, `fn_role_at_least`
  e as 155 policies (ADR-003). Sem cliente que peça, é generalidade
  especulativa; `manager` fecha o que §7.9 chama de "papéis" para um CRM
  comercial.
- **`handoff.assignment=round_robin` nesta fase.** A fila de handoff é de
  conversa (F15: automação, handoff, regras); a F13 distribui OPORTUNIDADE, e as
  duas filas partilham o rodízio puro de `lib/routing/decide.ts`.
- **Criar o pedido a partir da oportunidade ganha.** Quem cria pedido é o
  serviço de ADR-012 (produto, quantidade, unidade, preço resolvidos); a
  oportunidade não tem esses dados. Vínculo explícito, nunca conversão.
- **Relatório lido pela tela direto das tabelas.** Uma função SQL única é o que
  permite "indicador confere com a origem" ser uma prova (a suíte recalcula
  por fora e compara) em vez de uma promessa.

## Consequências

- `rbac: roles=4` a partir da F13 (ADR-035 §3); `denied_expected` sobe (D é
  derivado da matriz, não digitado).
- `tenant_settings` ganha 4 chaves (`crm.fields.contacts`, `crm.fields.companies`,
  `crm.distribution`, `crm.queue_roles`) — o schema de §5.2 passa de 24 para 28
  entradas; nenhuma tabela nova; 1 migration (9026) com coluna + função.
- Inventário do navegador: 13 specs, 58 testes por tenant (51 + 7).
- Produção recebe o código da F13 só DEPOIS do READY (staging): `bash
  scripts/prod/up.sh` (rebuild + baseline com o apêndice 9026) e `bash
  scripts/prod/prova.sh` → linha `prod:` nova no BUILD-STATE.

## Data

2026-09-14

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-034-F13-crm-comercial-completo.md`).
