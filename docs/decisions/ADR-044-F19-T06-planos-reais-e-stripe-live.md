# ADR-044 — F19-T06: nome e preço reais dos planos (D14) e o Stripe LIVE na produção

Adendo à [ADR-042](ADR-042-F19-cobranca-real-por-stripe.md) (F19). A mensagem
do proprietário de 20/09/2026 (depois do fechamento da F19) escolheu, entre
F16 / F17 / a prova real do Stripe / as 41 ferramentas da fila / consertos, a
**prova real do Stripe** — e a entrevista em cards (dois blocos + contraponto)
mudou o desenho dela ao apurar um FATO: a chave gravada em `crm-staging.env`
é **`rk_live_…`** (restrita, modo LIVE, 107 chars), não a `rk_test_…` que a
ADR-042 §7 e D57 (e) previam. As escolhas de produto são dele, registradas
como **D58** em `docs/DIRETRIZ.md` §2. O verificador **não muda** (nenhum
campo novo: a prova de produção fica FORA do bloco, como `ai_real:`,
`webchat_real:` e `engine_real:`).

## Contexto

Com uma chave live, a prova no staging como desenhada (Checkout com o cartão
de teste 4242, US$ 0, linha `stripe_real:`) não roda: o modo live recusa o
cartão de teste e qualquer assinatura criada é real. O proprietário decidiu
**pular a prova no staging** (opção 3 do card "Chave teste") e **ligar o
Stripe LIVE na produção** com a chave que já gravou ("a que gerei e gravei já
é a oficial"). Ligar live obriga a decidir **D14** — preços live são os
cobrados de verdade —, e ele pediu recomendação e escolheu a tabela.

O que já existe e esta task reaproveita, medido no código em 20/09/2026:

| Peça | Onde | O que a T06 faz com ela |
|---|---|---|
| `plans` com `source in ('placeholder','owner')`, `price_cents`, `currency` | migration 9023 | migration 9034 grava nome/preço reais com `source='owner'` |
| `provisionar(cfg, {planos})` — recebe a lista, nunca decide | `src/billing/provisionar.ts:52` | passa a receber os planos do BANCO quando `source='owner'`; placeholders só quando não há decisão |
| `precoDoPlano` devolve o PRIMEIRO `price_` do plano na lista | `src/billing/gateway/stripe.ts:94` | preços antigos entram DEPOIS do vigente em `STRIPE_PRICE_IDS`: o webhook os aceita, o Checkout não os oferece (objeção 2) |
| `stripe-provision.ts` recusa `live` sem `--live` | `scripts/stripe-provision.ts` | ganha `SUPABASE_DB_URL` para ler os planos do dono; `--live` continua explícito |
| `secrets.sh` da produção não gera `STRIPE_*` (D57 f) | `scripts/prod/secrets.sh:74-79` | continua: as variáveis do Stripe entram por esta task, com o valor gravado sem passar pelo chat |
| rota `POST /api/v1/webhooks/stripe`, `STRIPE_MODE=live` | `lib/env.ts:282`, F19-T02 | o endpoint LIVE é registrado pela API (`POST /v1/webhook_endpoints`) com os 7 tipos tratados |

## Decisão

### 1. D14 fechado: Essencial / Profissional / Empresarial

| Código | Nome | Preço mensal | Limites (inalterados, 9023) |
|---|---|---|---|
| `PLAN_A` | Essencial | R$ 197,00 (19700 centavos, BRL) | 3 usuários, 500 respostas de IA/mês |
| `PLAN_B` | Profissional | R$ 597,00 (59700) | 10 usuários, 5.000 respostas de IA/mês |
| `PLAN_C` | Empresarial | R$ 1.497,00 (149700) | sem limite |

Base da recomendação (fatos medidos, não chute): turno em `claude-sonnet-5`
≈ 3,2 ¢ ≈ R$ 0,17 (F18 recotada com a tabela da F19-T00); pior caso de IA em
Sonnet = R$ 85/mês no A e R$ 850/mês no B; infra por tenant ≈ R$ 50–100
(VPS compartilhada, orçamento proposto); mercado BR de CRM + WhatsApp + IA
para PME em R$ 79–299 por usuário ou R$ 197–997 flat por empresa. Trial de 7
dias com cartão continua (D57 c). Risco declarado: o Profissional com 5.000
turnos em Sonnet custa mais do que cobra — a organização que chegar perto
deve ligar `ai.limits.daily_turns` (F15), e o modelo padrão dos tenants é
decisão de configuração, não desta task.

### 2. Migration 9034 — `plans` recebe a decisão do dono

`update … set name, price_cents, source='owner' where code=… and
source='placeholder'`: idempotente e **não sobrescreve** um valor que o dono
mude depois pela via própria (uma decisão futura vem por migration nova, não
por reaplicação desta). Guarda ao fim: exatamente 3 planos `owner` com
`price_cents > 0`. Apêndice idempotente no baseline **antes** da guarda
`$f12_t01_fim$`; MANIFEST; prova em `tests/invariants/f19-t06-planos-do-dono.test.ts`
(3/3 nome/preço/source; `plans` continua service_only — 4 operações × 2
papéis negadas, service_role lê 3/3). Nenhuma tabela nova.

As suítes herdadas da F12 que afirmavam "placeholder, preço 0" passam a
afirmar o que o banco tem (`source=owner`, os três preços) — o padrão mudou
por decisão do dono, e a suíte declara o que mede (RETOMADA, regra da F18).

### 3. `stripe:provision` lê os planos do dono; preços antigos viram legado

`planosAProvisionar(linhas)` (puro): se os três planos têm `source='owner'`,
o Product leva o nome real e o Price o `price_cents`/`currency` do banco;
se algum é placeholder, a lista inteira é `PLANOS_PLACEHOLDER` (nunca
mistura). O script lê o banco por `SUPABASE_DB_URL` (o mesmo caminho da
jornada). **Objeção 2 do contraponto, consertada:** `provisionar` inclui em
`STRIPE_PRICE_IDS`, depois do preço vigente, todo Price ativo recorrente do
mesmo Product na mesma moeda — `price_vigente:PLAN_A,price_antigo:PLAN_A` —
para que `customer.subscription.updated` de quem assinou no preço antigo não
seja recusado com `price_outside_list`, enquanto `precoDoPlano` (primeiro
da lista) continua oferecendo só o vigente no Checkout e no Portal.

### 4. Produção LIVE — o que muda e o que se mede sem cobrar

Ordem: (a) chave live sai de `crm-staging.env` e entra em `crm-prod.env`
(mover = gravar + apagar; só nome e tamanho aparecem); (b) `POST
/v1/webhook_endpoints` com `url=https://crm.kntecnologia.app/api/v1/webhooks/stripe`
e os 7 tipos de `TIPOS_TRATADOS` → `whsec_` gravado direto no env (se a chave
não tiver `webhook_endpoints: write`, a task PARA e pede o registro pelo
Dashboard); (c) `STRIPE_MODE=live pnpm stripe:provision --live` com os
planos do dono → `STRIPE_PRICE_IDS`, `STRIPE_PORTAL_CONFIGURATION_ID`; (d)
`BILLING_GATEWAY=stripe`; (e) `up.sh` só DEPOIS do READY (staging) do gate;
(f) `prova.sh` → `prod: … billing_gateway=stripe`; smoke
`webhook_stripe_unsigned_rejected=1/1` (401); cockpit `gateway ok=true`.

Linha nova FORA do bloco (`scripts/prod/prova-stripe-live.sh`):
`stripe_live: key_ok=1/1 products=3/3 prices=3/3 portal=1/1
webhook_endpoint=1/1 unsigned_rejected=1/1 summary_ok=1/1 checkout_paid=0/0
mode=live cost_cents=0` — tudo leitura ou criação de catálogo; **nenhum
Checkout, nenhuma cobrança**. `checkout_paid=0/0` é o que fica NOT VALIDATED
(real): o primeiro Checkout live é de um cliente ou do proprietário.

### 5. Task

| Task | Entrega | Critério de saída |
|---|---|---|
| T06 | ADR-044, D58, migration 9034 + apêndice + MANIFEST + prova; `planosAProvisionar` + legado em `STRIPE_PRICE_IDS` + script com `SUPABASE_DB_URL`; suítes da F12 declarando `owner`; mutante 86; gate f19-gate-04; `demo3` + `from-scratch` (migration mudou, regra 12); produção live; `stripe_live:`; docs; custo | `planos_owner=3/3`; `legado_aceito=1/1 vigente_no_checkout=1/1`; mutante 86 morto; `READY (staging)`; `prod: billing_gateway=stripe`; `stripe_live:` com 7 medidas em 1/1 e `checkout_paid=0/0` declarado |

## Alternativas rejeitadas

- **Criar uma `rk_test_` para a prova no staging** (recomendada por mim):
  recusada pelo proprietário nesta sessão; fica como pendência barata (10
  min) no COMECE-AQUI — `jornada-stripe.ts` continua pronto.
- **Prova no staging em modo live com o cartão do proprietário**: recusada
  (assinatura real, Products placeholder live na conta real).
- **Placeholder R$ 10/20/30 em live** enquanto D14 não fechasse: recusada —
  ele fechou D14 na hora.
- **Preço antigo como risco declarado** (objeção 2): recusada; consertar
  custa uma função pura e um caso de integração.

## Consequências

- A produção passa a cobrar de verdade quem chegar ao Checkout — hoje
  ninguém, porque o cadastro público continua desligado (D13); a liberação
  do BLOCKER-PROD é o portão seguinte e não faz parte desta task.
- As duas verdades de preço da ADR-042 viram UMA: `plans.price_cents` e o
  Price live nascem da mesma linha do banco.
- As fixtures do Stripe continuam MODELADAS (sem chave de teste não há
  evento para capturar): declarado em `tests/fixtures/stripe/README.md` e no
  FINAL-VALIDATION §3.
- Uma chave live vive no app de produção com as permissões que o proprietário
  deu; o gate nunca a lê (`.env.e2e` traz chaves fictícias, `env-e2e.sh:70-75`).

## Data

2026-09-20.
