# ADR-042 — F19: cobrança real por Stripe e o padrão KN do `/admin`

Decisões da F19 que afetam mais de um módulo (AGENTS.md §8). §7.9 manda
decompor a fase em tasks antes de executar. A mensagem do proprietário de
19/09/2026 (depois do fechamento da F18) escolheu **Stripe + padrão KN do
`/admin`** entre F16 / F17 / Stripe / as 41 ferramentas da fila / consertos,
respondeu oito decisões de produto em cards e aprovou o brief com as três
objeções do `contraponto` (1 aceita como teste na T00, 2 resolvida pela opção
(a), 3 aceita como teste na T00). As escolhas de produto são dele, registradas
como **D57** em `docs/DIRETRIZ.md` §2. O verificador muda em
[ADR-043](ADR-043-verify-v1.12-F19.md).

## Contexto

A F12 (ADR-030) entregou assinatura, planos, máquina de estados, carência,
bloqueio 402, conciliação e um gateway **mock** — checkout e webhook fictícios
assinados por HMAC (`src/billing/gateway/mock.ts`, `webhook-mock.ts`). D52 (b)
fixou que o gateway real seria **Stripe**, em fase própria. O que já existe e
a F19 reaproveita, medido no código em 19/09/2026:

| Peça da F12 | Onde | O que a F19 faz com ela |
|---|---|---|
| `BILLING_GATEWAY` | `lib/env.ts:253` — enum só com `mock` | ganha `stripe` |
| `aplicarEventoDoGateway(ctx, evento)` | `src/billing/assinatura.ts:303` — evento genérico `{gateway, event_ref, event_type, occurred_at, payload}`; `(gateway, event_ref)` único = duplicata recusada; `occurred_at < last_event_at` = fora de ordem | é o receptor: o adapter TRADUZ o evento do Stripe para este contrato, não escreve máquina nova |
| `transicao(de, evento)` | `src/billing/estados.ts:64` — 10 transições, espelhadas no CHECK 9023 | inalterada; `cancelled` passa a poder vir do gateway (Portal) |
| `iniciarCheckout` | `assinatura.ts:234` — cria a fatura do CRM e devolve `{assinatura, fatura}` | inalterada; o adapter cria a sessão de Checkout do Stripe com `client_reference_id = organization_id` |
| `varrerCarencia` / `BILLING_GRACE_DAYS=7` | `assinatura.ts:396`, D52 b | inalterada: `invoice.payment_failed` → `past_due`; a varredura bloqueia depois de 7 dias |
| `mudarPlano` / `cancelar` (telas de `/app/billing`) | `assinatura.ts:422/442` | viram só-leitura para organização com `gateway=stripe`: troca e cancelamento acontecem no Customer Portal e voltam pelo webhook (D57 b) |
| origens `operator`/`seed`/`fixture` | CHECK `subscriptions_origin_check` | continuam sem cliente Stripe: KN Tecnologia e `deka` não mudam |

O kit da casa tem o módulo provado (`OS-Template/billing/BILLING.md`, DF-33:
uma conta Stripe KN, um Product por plano, chave restrita por OS, webhook
idempotente por tabela de eventos, **estado buscado no provedor** em vez de
lido do payload, `/admin/assinaturas` com cinco ações, `GET /api/admin/summary`
por token). A F19 porta as regras dele para o modelo da F12; não copia o
schema Drizzle (a F12 já tem `billing_events` e `subscriptions`).

## Decisão

### 1. §B23 (b) entra como T00: a geração 5 tem preço

`lib/agent-engine/edge/llm/pricing.ts` casa por prefixo e só conhecia
`claude-sonnet-4`/`claude-opus-4`: `claude-sonnet-5` (o padrão da organização)
e `claude-opus-5` caíam em `null` → `estimated_cost_cents=0` → a tela de uso
mostrava ZERO. Entram `claude-opus-5` (5/25), `claude-sonnet-5` (2/10) e
`claude-haiku-4-5` (1/5) USD por milhão, tarifa da tabela do skill
`claude-api` (cache read 0,1×, cache write 1 h 2×). Prova:
`tests/unit/f19-t00-preco-da-geracao-5.test.ts` (`modeloTemPreco=3/3`, a
jornada da F18 recotada em 15,87 cents), mutante 81. A parte (a) do §B23 (o
modelo da prova é o da organização) fica como aviso no script da jornada.

### 2. Gateway `stripe` ao lado do `mock`, mesma máquina de estados

`src/billing/gateway/stripe.ts` — HTTP puro contra `STRIPE_API_BASE` (sem
SDK, como o kit), funções puras testáveis sem rede:

| Evento do Stripe | O que o adapter faz |
|---|---|
| `checkout.session.completed` (mode `subscription`) | grava `customer_ref` e `gateway_ref` (id da subscription) na assinatura da organização de `client_reference_id`; **busca a subscription no Stripe** e traduz o `status` dela: `trialing`/`active` → `payment_confirmed` (com `trial_ends_at`), `past_due`/`unpaid` → `payment_failed`, `canceled` → `cancelled` |
| `invoice.paid` / `invoice.payment_succeeded` | `payment_confirmed` (renova) |
| `invoice.payment_failed` | `payment_failed` → `past_due`; a carência da F12 faz o resto |
| `customer.subscription.updated` | busca a subscription; traduz o `status` como acima e **sincroniza `plan_code`** pelo `price.id` → `STRIPE_PRICE_IDS` (troca de plano feita no Portal) |
| `customer.subscription.deleted` | `cancelled` — dados preservados (D44), acesso `billing_only` |
| qualquer outro tipo | `ignored` (200), sem linha |

Recusas ANTES de gravar (todas 4xx, o Stripe reenvia por até 3 dias):
assinatura `Stripe-Signature` ausente/inválida ou fora da tolerância de 5 min
→ 401; `livemode` ≠ `STRIPE_MODE` → 422; `price.id` fora de `STRIPE_PRICE_IDS`
→ 422; organização não encontrada por `client_reference_id`/`gateway_ref` →
200 `ignored` (`unknown_subscription`, como a F12). Segredo vazio → 503 (G-27).
Fixtures = payloads REAIS do Stripe, versionados em `tests/fixtures/stripe/`
(AGENTS §5 regra 13).

**Estado buscado no provedor (objeção do kit):** em `checkout.session.completed`
e `customer.subscription.updated` o estado vem de `GET /v1/subscriptions/{id}`,
nunca do payload — `state_from_provider=1/1` mede um payload que diz `active`
enquanto o provedor diz `past_due`. A ordem por `occurred_at` da F12 continua
valendo por cima (fora de ordem é contado, não aplicado).

### 3. Migration 9033

`billing_events.gateway` e `subscriptions.gateway` aceitam `stripe`;
`billing_events.event_type` ganha `cancelled` (o Portal cancela e o gateway
avisa); colunas novas `subscriptions.customer_ref text`,
`subscriptions.trial_ends_at timestamptz`, `billing_events.livemode boolean`;
índice `(gateway, gateway_ref)` em `subscriptions` para o webhook achar a
organização. CHECKs reconstruídos em **bloco único** drop+add no apêndice do
baseline (lição 26 da F14), ANTES da guarda `$f12_t01_fim$`; MANIFEST; prova
em `tests/db/` no mesmo commit (a RLS das quatro tabelas é a da 9023 —
service-only — e a prova confere que continua). Nenhuma tabela nova.

### 4. Trial de 7 dias (D57 c) e cartão obrigatório

`BILLING_TRIAL_DAYS=7` (default declarado; `0` desliga). O Checkout é criado
com `subscription_data[trial_period_days]` e
`payment_method_collection=always`: com ou sem trial, sem cartão não há
assinatura. `trialing` mapeia para `active` com `trial_ends_at`; a tela mostra
"período de teste até <data>". O critério da F11 "nenhum acesso operacional
gratuito por falha no fluxo" passa a ler-se "sem cartão no Checkout = sem
acesso" — as specs herdadas que afirmam "sem pagamento = sem acesso" são
reescritas nesta fase (objeção 3, aceita como teste; contadas na T00: 2 specs
de navegador, `f11-admin-e-entrada` e `f12-assinatura`, percorrem o
`mock-checkout` por URL e testid — passam a percorrer o checkout do gateway
configurado por um helper que declara qual gateway exercitou).

### 5. Padrão KN do `/admin`

Dentro do painel `platform_admin` da F11 (`/admin/billing`, sessão), cinco
ações por organização com `gateway=stripe`: **suspender** (`pause_collection`),
**reativar**, **estender trial** (1..90 dias, `trial_end`), **provisionar na
mão** (assinatura `operator` sem Stripe, como o painel já faz) e **abrir no
Stripe** (link ao Dashboard, `test`/`live` conforme o modo). Cada uma audita
(`billing.admin.<acao>`). `GET /api/admin/summary` com
`Authorization: Bearer <ADMIN_SUMMARY_TOKEN>` devolve itens `{ok, valor,
detalhe}` (gateway e modo, assinaturas por estado, último webhook recebido,
webhooks recusados nas últimas 24 h, marcador do backup) — sem sessão, para o
cockpit da KN; token vazio = 503. O caminho fica `/admin/billing` (o da F11):
o padrão KN é o conjunto de ações e o cockpit, não o nome da rota.

### 6. Customer Portal (D57 b)

`/app/billing` ganha "Gerenciar assinatura" → `POST /v1/billing_portal/sessions`
→ redirect. Troca de plano e cancelamento acontecem lá e voltam por
`customer.subscription.updated/deleted`. Para organização `gateway=stripe`,
`POST /api/v1/billing/subscription/plan` e `/cancel` respondem 409
`use_portal`; para `mock`/`operator` continuam como na F12.

### 7. O gate roda contra um Stripe FALSO; a prova real é em staging pela CLI

No gate, `.env.e2e` traz `BILLING_GATEWAY=stripe`, chaves fictícias e
`STRIPE_API_BASE=http://127.0.0.1:<E2E_PORT+1000>`; um segundo `webServer` do
Playwright sobe `tests/e2e/utils/stripe-falso.mjs`, que responde às cinco
chamadas que o adapter faz (checkout session, subscription, portal session,
pause/resume, trial_end), serve uma página de checkout com "Pagar" e, ao
pagar, ENTREGA ao app os webhooks assinados com o `whsec` fictício
(`checkout.session.completed` e `invoice.paid`, como o Stripe). A suíte de
integração usa o mesmo falso em processo e grava `metrics/stripe.line`.
A prova REAL (`stripe_real:`, fora do bloco) roda no staging com a chave
restrita de teste do proprietário e `stripe listen --api-key … --forward-to`
(D57 e): checkout de teste criado, webhook recebido pela CLI, assinatura
ativada em `trialing`, tudo apagado ao fim com as linhas devolvidas.
**Produção fica `BILLING_GATEWAY=mock` nesta fase (D57 f — opção (a) da
objeção 2)**: a linha `prod:` declara `billing_gateway=mock`; ligar o Stripe
lá é registrar o webhook no domínio e gravar as chaves — ação do proprietário.

### 8. Tasks

| Task | Entrega | Critério de saída (número com denominador) |
|---|---|---|
| T00 | ADR-042/043, D57, branch, §B23 (b), verify v1.12 (F19 no gate, linha `stripe:`, casos 207 → 227), env vars com arquivo:linha, teste da objeção 1 (CLI com chave restrita) e da objeção 3 (specs contadas) | `modeloTemPreco=3/3`; mutantes 81–82 mortos; gate.cases 227/227; `stripe listen` conecta 1/1 |
| T01 | Migration 9033 + apêndice + MANIFEST + prova em `tests/db/` | `9033 aplicada=1/1`, `checks=3/3`, `colunas=3/3`, `rls_service_only=4/4` |
| T02 | `src/billing/gateway/stripe.ts` (assinatura, tradução, estado do provedor, preço fora da lista, livemode), rota `POST /api/v1/webhooks/stripe`, checkout pelo Stripe em `POST /api/v1/billing/checkout`, fixtures reais | `signature_rejected=1/1 livemode_mismatch=1/1 price_outside_list=1/1 checkout_created=1/1 activated=1/1 trialing_mapped=1/1 duplicates=1 out_of_order=1 state_from_provider=1/1` |
| T03 | D44 sobre eventos reais + Portal em `/app/billing` + 409 `use_portal` | `past_due=1/1 blocked_after_grace=1/1 cancelled_preserved=N/N portal_link=1/1` |
| T04 | Padrão KN: cinco ações em `/admin/billing`, `GET /api/admin/summary`, `scripts/stripe-provision.ts`, secrets de staging/prod | `admin_actions=5/5 summary_ok=1/1 provision=1/1` |
| T05 | Stripe falso, spec `f19-cobranca-stripe` (7 testes), helper de checkout nas specs herdadas, linha `stripe:` medida, mutantes 83–85, smoke +1, `stripe_real:`, fechamento | spec 7/7 × 2 tenants; `mutants_killed=85/85`; READY (staging); `demo3`; `from-scratch`; `prod:` com `billing_gateway=mock` |

### 9. Defaults declarados, nunca fato

`STRIPE_MODE=test`; `BILLING_TRIAL_DAYS=7` (D57 c — decisão); moeda `BRL`
(a da F12); preços placeholder R$ 10/20/30 por mês em modo test com
"(placeholder)" no nome do Product (D57 d) — preço e nome REAIS continuam D14;
carência 7 dias e sem pró-rata (D52 b); retentativas de cobrança = padrão do
Stripe; `STRIPE_PORTAL_CONFIGURATION_ID` vazio = configuração padrão da conta.

## Alternativas rejeitadas

- **Adotar o fluxo do kit (pagar antes, senha depois — DF-32)**: recusado pelo
  proprietário (D57 a); reescreveria o cadastro da F11 já medido.
- **Telas próprias de troca/cancelamento chamando a API do Stripe**: recusado
  (D57 b); o Portal é o padrão KN e reduz casos de erro a provar.
- **Copiar o schema Drizzle do kit**: a F12 já tem `billing_events` e
  `subscriptions` com o mesmo papel; duas tabelas de evento seriam duas
  verdades.
- **Registrar o webhook na produção já nesta fase**: opção (b) da objeção 2,
  recusada (D57 f) — produção fica `mock` até o proprietário registrar.

## Consequências

Achados da construção (T02–T05), registrados aqui porque mudam o que a F12
entregou:

- **Renovação não é ativação.** O Stripe manda `invoice.paid` a cada ciclo;
  `payment_confirmed` sobre `active` (renova) deixa de avisar
  `subscription.activated` — o aviso é só para pending/past_due/blocked →
  active. A F12 já contava assim (`activations`), só a notificação sobrava.
- **Duas verdades de preço, declaradas.** `plans.price_cents` continua 0
  (placeholder da F12, mostrado na tela) e o Product placeholder no Stripe
  cobra R$ 10/20/30 em modo test (D57 d). Quando D14 fechar, os dois mudam
  juntos: migration com `source='owner'` e `stripe:provision` com os valores.
- **`customer.subscription.created`** entra nos tipos tratados (pelo mesmo
  caminho do `updated`, com `metadata.organization_id` como último recurso):
  uma subscription criada fora do Checkout ainda chega à organização certa.
- **Suspender/reativar são eventos da tabela de transições**
  (`admin_suspended`, `admin_resumed`; 10 → 13 transições): o dono suspende
  de `active`/`past_due` para `blocked` e reativa de `blocked`; no Stripe é
  `pause_collection`. A suíte da F12 declara o número vigente.

- O caminho `pending_payment → Checkout → webhook → active` passa a existir
  com provedor real; a linha `stripe:` mede o que o mock nunca mediu
  (assinatura do webhook, livemode, preço fora da lista, estado do provedor).
- A produção sai da fase com o código do Stripe e o gateway `mock`: cobrança
  REAL em produção continua `NOT VALIDATED (real)` até o proprietário
  registrar o webhook e gravar as chaves (F17 encontra isso como pendência).
- Duas specs herdadas (F11, F12) passam a percorrer o checkout do gateway
  configurado — o gate deixa de exercitar a página `mock-checkout` pelo
  navegador; o mock continua medido pela integração (`billing:`).
- `trial de 7 dias` é a primeira decisão comercial registrada além da carência
  (D52 b): acesso liberado por 7 dias com cartão no arquivo.

## Data

2026-09-19.
