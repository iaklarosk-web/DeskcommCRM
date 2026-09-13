# ADR-030 — F11+F12: administração da plataforma, entrada guiada e assinatura/cobrança (tasks, contratos e defaults declarados)

Decisões de F11 e F12 que afetam mais de um módulo (AGENTS.md §8). §7.9 manda
decompor cada fase em tasks antes de executar; D51 (a) autoriza as duas juntas,
sem provedor real, sem produção e sem escolher preço, plano, nome, gateway ou
dias de carência (D11, D14, D44). O verificador muda em [ADR-031](ADR-031-verify-v1.6-F11-F12.md).

## Contexto

O que §7.9 pede de F11 (entrada: "empresa conclui configuração sem editar
código/banco; suporte auditado e limitado; nenhum acesso operacional gratuito
por falha no fluxo") e de F12 ("pagamento confiável ativa uma vez; eventos
duplicados/fora de ordem não duplicam acesso/cobrança; aviso/carência/bloqueio
com dias definidos") já tem base no Deskcomm v1.17.0, medida em `cfb3c34a`:

| Existe | Onde | O que falta para F11/F12 |
|---|---|---|
| Painel `/admin` com `requirePlatformAdmin` (linha em `platform_admins`, MFA) | `lib/auth/requirePlatformAdmin.ts`, `app/admin/(protected)/*` (tenants, users, usage, audit, lgpd, incidents) | estado da assinatura e uso por empresa; sem tela de planos/cobrança |
| Acompanhamento (suporte) por sessão, com modo `full`/`support_readonly`, TTL 1 h e `fn_support_context` | `platform_support_sessions` (0220), `lib/impersonate/support.ts`, `POST /api/v1/admin/tenants/[id]/impersonate` | **sem motivo, sem escopo**, modo `full` permitido, banner sem vencimento visível |
| Cadastro self-service com provisionamento de organização + `admin` | `lib/auth/provision.ts` (`ensureTenantForUser`), `/get-started` | organização nasce `active` e cai direto no wizard: **acesso operacional sem assinatura** (contra D38) |
| Wizard `/onboarding` (welcome → connect-whatsapp → connect-nuvemshop → setup-ai → funil → invite-team → testar → done) | `lib/onboarding/passos.ts`, `app/onboarding/*` | passos de loja/funil são do e-commerce herdado; falta provar os passos WhatsApp/IA em modo mock |
| Suspensão de tenant pelo admin (`status=suspended`, motivo ≥10) | `POST /api/v1/admin/tenants/[id]/suspend` | é bloqueio total pelo operador, não inadimplência (D44 preserva leitura e cobrança) |
| Entitlement Fase 1 (`allowed=true` para as 6 capabilities; seam `resolver`) | `src/entitlement/` (ADR-005, §5.3) | **resolver por plano** com `remaining` real (D14) |
| `organizations.settings.plan` gravado pelo admin ao criar tenant | `fn_create_tenant_with_owner` | é texto livre em JSON, sem catálogo, sem estado |
| Nenhuma tabela de plano, assinatura, evento de cobrança ou fatura | — | tudo de F12 |

## Decisão

### 1. Tasks de F11 (administração e entrada guiada)

Cada task fecha com o número da coluna "Critério de saída" no corpo do commit
(D37) e a fase fecha com as linhas `admin:` e `billing:` no bloco (ADR-031).

| Task | Entrega | Critério de saída (número com denominador) |
|---|---|---|
| **F11-T00** | As três decisões pequenas de D51 (d): §B11 (Sentry sem DSN = desligado; comunidade só por `SENTRY_DSN=community`), §B15 (escritor de fixtures tolera rerun idempotente por id e organização; comparação byte a byte só na primeira gravação), `products[].size` fora de `docs/tenants/*.seed.yaml`, do loader e do teste `f07-t03-seed-blocks` | `resolveSentryDsn("")=undefined` e `resolveSentryDsn("community")=DSN` provados (2/2); rerun do escritor com linha tocada por gatilho = 0 erros (1/1); `grep -c "size:" docs/tenants/*.seed.yaml` = 0 |
| **F11-T01** | Login/painel do proprietário: `platform_admin` de staging criado por `scripts/staging/seed-users.sh` (fictício, sem MFA — o de produção é o item 7 de D12); `/admin/tenants` mostra por empresa o estado da assinatura, o plano e o uso do mês; `/admin/billing` (F12-T07) entra no menu | e2e: `tenants_listed=2/2` (A e B visíveis ao dono, com estado da assinatura conferido contra o banco); smoke: `owner_login=1/1` |
| **F11-T02** | Suporte limitado e auditado (D39): `platform_support_sessions` ganha `reason` (obrigatório, 10–500), `scope` (enum `all`, `inbox`, `crm`, `settings`, `billing`) e o pedido escolhe `expires_in_minutes` (1–60, teto 60); `access_mode` aceito **só** `support_readonly` (`full` → 422); `requireRole` nega rota fora do escopo (403 `support_scope`); banner mostra motivo, escopo e vencimento; `audit_events`/`api_audit_log` carregam os três campos | integração: `support_sessions=2 support_reason=2/2 support_scope_denied=D/D support_writes_denied=W/W full_mode_rejected=1/1` com D ≥ 2 e W ≥ 4; e2e: uma sessão por tenant, escrita 403 e banner com os três campos (2/2) |
| **F11-T03** | Empresas e equipes dentro do plano: empresa criada pelo admin (`POST /api/v1/admin/tenants`) nasce com assinatura `active` de origem `operator` no plano pedido (default `PLAN_A`); convite de membro (`users.invite`) passa pelo entitlement; acima do limite do plano = 402 `limit_reached` e contador | integração: `invites_within_limit=K/K invite_over_limit_denied=1/1` (K = limite do plano placeholder) |
| **F11-T04** | Cadastro self-service com gate D38: `ensureTenantForUser` cria organização + assinatura `pending_payment` (falha na segunda escrita desfaz a primeira — organização sem assinatura não sobrevive ao fluxo); `app/app/layout.tsx` redireciona para `/app/billing` toda organização cuja assinatura não permite uso (`pending_payment`, `blocked`, `cancelled`); a ordem é assinatura → onboarding → produto | integração: `signup_awaiting_payment=1/1 org_without_subscription_after_failure=0/1`; e2e: `app_redirect_to_billing=1/1` |
| **F11-T05** | Wizard WhatsApp/IA em mock: `connect-whatsapp` conclui com a sessão mock (ADR-017), `setup-ai` com `AI_PROVIDER=mock`; `connect-nuvemshop` e `funil` só existem quando a integração de loja está ligada (já é assim para a loja; o funil passa a seguir a mesma regra); `onboarded_at` gravado no `done` | e2e: `wizard_steps=5/5 onboarded_at=1/1` só pela UI, sem SQL |
| **F11-T06** | Spec `tests/e2e/f11-admin-e-entrada.spec.ts` (inventário fechado: +6 testes), mutantes 60–61, i18n espanhol das telas novas, workflow `e2e.yml` | `mutants_killed` sobe 2; inventário `EXPECTED_F11_E2E_TESTS = 41 + 6` |

### 2. Tasks de F12 (assinatura, planos e cobrança — gateway mock)

| Task | Entrega | Critério de saída |
|---|---|---|
| **F12-T01** | Schema (migration `9023`, apêndice idempotente no baseline, MANIFEST, prova comportamental de RLS no MESMO commit): `plans` (catálogo GLOBAL, sem `organization_id`, seeds `PLAN_A/B/C`), `subscriptions`, `billing_events`, `invoices` (as três tenant-aware, `service_only`); backfill declarado: toda organização existente sem assinatura ganha `active` de origem `backfill` (conta impressa) | `tests/invariants/f12-t01-billing-schema.test.ts`: 3 tabelas × (8/8 authenticated negado, 4/4 anon negado, service_role lê de volta 1/1); CHECKs de estado e transição; `plans` com `anon=0` e leitura só a `authenticated` |
| **F12-T02** | Entitlement por plano (D14): `entitlement()` passa a ser assíncrono e o resolver padrão lê assinatura + plano + uso do período; `reason` é enum (`ok`, `legacy_without_subscription`, `subscription_pending_payment`, `subscription_past_due`, `subscription_blocked`, `subscription_cancelled`, `limit_reached`); `remaining` = limite − uso quando há limite | unit/integração: `capabilities=6 resolved=6/6 denied_by_status=3/3 denied_by_limit=1/1 remaining_measured=1/1`; `ai_eval` continua `provider_calls_at_zero_balance=0` |
| **F12-T03** | Contratação e pagamento com gateway MOCK: `POST /api/v1/billing/checkout` `{plan_code}` devolve um checkout mock; `POST /api/v1/billing/webhooks/mock` (HMAC com `BILLING_MOCK_WEBHOOK_SECRET`) recebe `payment_confirmed`/`payment_failed`; evento idempotente por `(gateway, event_ref)`; fora de ordem por `occurred_at` (evento mais antigo que o último aplicado é guardado e não aplicado); ativa UMA vez; fatura `paid` | integração: `events=4 duplicates=1 out_of_order=1 activations=1/1 invoices_paid=1/1` |
| **F12-T04** | Liberação de acesso, capacidades, limites e uso: tela `/app/billing` do `tenant_admin` (plano, estado, uso por capability com limite e restante, faturas, botão de checkout); `GET /api/v1/billing/subscription` e `GET /api/v1/billing/usage`; gate do layout (F11-T04) lê o mesmo `estadoDeAcesso` | e2e: tela contra banco `usage_rows=6/6` nos dois tenants |
| **F12-T05** | Mudança de plano e cancelamento: `POST /api/v1/billing/subscription/plan` (imediato, sem pro-rata — declarado como default), `POST /api/v1/billing/subscription/cancel` (`cancelled`, dados preservados, `/app/billing` continua legível, reativação por novo checkout) | integração: `plan_changed=1/1 cancelled=1/1 data_preserved=R/R billing_readable_after_cancel=1/1` |
| **F12-T06** | Inadimplência (D44): `payment_failed` → `past_due` + notificação `subscription.payment_failed` + `grace_until = now() + BILLING_GRACE_DAYS` (default **7**, declarado); job `billing_grace_sweep` por tenant (D20) → `blocked` + `subscription.blocked`; bloqueado = escrita 402 `subscription_blocked` nas rotas de negócio, leitura e `/app/billing` seguem; `payment_confirmed` reativa | integração: `past_due=1/1 notified=2/2 blocked_after_grace=1/1 writes_denied=W/W reads_allowed=M/M reactivated=1/1` |
| **F12-T07** | Conciliação: `src/billing/conciliacao.ts` compara faturas pagas × eventos `payment_confirmed` do período; `/admin/billing` lista assinaturas por empresa, eventos recebidos e divergências | integração: `reconciliation: invoices=N events=N matched=N mismatch=0` com N ≥ 2 |
| **F12-T08** | Spec `tests/e2e/f12-assinatura.spec.ts` (+4 testes), mutantes 62–64, verify v1.6 (ADR-031), smoke com passo de cobrança, evidência, BUILD-STATE, FINAL-VALIDATION, COMECE-AQUI | gate `READY (staging)` com `admin:` e `billing:` medidos; `mutants_killed` sobe 3 |

### 3. Modelo de assinatura (o que o código afirma e o que fica declarado)

**Tabelas.** `plans(code pk, name, price_cents, currency, limits jsonb, active, source)`;
`subscriptions(id, organization_id, plan_code, status, origin, gateway, gateway_ref,
current_period_start, current_period_end, grace_until, failed_at, blocked_at,
cancelled_at, cancel_reason, last_event_at, created_at, updated_at)` com
**uma assinatura por organização** (índice único em `organization_id`);
`billing_events(id, organization_id, gateway, event_ref, event_type, occurred_at,
received_at, applied, ignored_reason, payload)` com único `(gateway, event_ref)`;
`invoices(id, organization_id, subscription_id, period_start, period_end,
amount_cents, currency, status, due_at, paid_at, gateway_ref)`.

**Estados** (`subscriptions.status`) e transições — tabela única em
`src/billing/estados.ts`, espelhada no CHECK:

| De | Evento | Para | Efeito |
|---|---|---|---|
| — | cadastro self-service | `pending_payment` | sem uso operacional (D38) |
| — | criação pelo admin, seed, fixture, backfill | `active` | origem gravada |
| `pending_payment` | `payment_confirmed` | `active` | fatura `paid`; período = 30 dias |
| `active` | `payment_failed` | `past_due` | aviso; `grace_until = +BILLING_GRACE_DAYS` |
| `past_due` | `payment_confirmed` | `active` | reativa |
| `past_due` | `grace_until` vencido (job) | `blocked` | escrita negada; dados e cobrança preservados |
| `blocked` | `payment_confirmed` | `active` | reativa |
| `active`, `past_due`, `blocked` | cancelamento pelo `tenant_admin` | `cancelled` | dados preservados; reativação = novo checkout → `pending_payment` |
| `cancelled` | checkout | `pending_payment` | mesma linha, novo ciclo |

**Acesso** (`src/billing/acesso.ts`, um leitor para o layout, o `requireRole`
e o entitlement): `active`, `past_due` → `full`; `blocked` → `read_only`;
`pending_payment`, `cancelled` → `billing_only`; organização **sem linha** →
`full` com `reason=legacy_without_subscription`. A última regra existe pelas
organizações herdadas das suítes (centenas de `insert into organizations` nos
testes do Deskcomm); a garantia de D38 não depende dela: todo caminho que cria
organização nesta base (cadastro, admin, loader, fixture, backfill) cria a
assinatura, e a prova de F11-T04 mede que a falha da segunda escrita desfaz a
primeira. `orgs_without_subscription=0/N` é medido no staging pelo smoke.

**Gate de escrita.** `requireRole` (o guarda de toda rota `/api/v1`) nega com
`402 subscription_blocked` os métodos que não são `GET`/`HEAD`/`OPTIONS`
quando o acesso é `read_only` ou `billing_only`, exceto as rotas `/api/v1/billing/*`
e `/api/v1/auth/*` (a pessoa precisa pagar e sair). É a versão de D44 de
"bloquear novas operações preservando dados e acesso à cobrança".

**Defaults declarados, nunca fato** (D14, D44, D51): planos `PLAN_A/B/C` com
`name = code`, `price_cents = 0`, `source = 'placeholder'`; limites placeholder
por capability para que o caminho "limite atingido" seja exercitado —
`PLAN_A: users.invite=3, ai.reply=500/mês`; `PLAN_B: 10, 5000`; `PLAN_C: sem
limite`; `BILLING_GRACE_DAYS=7`; `BILLING_GATEWAY=mock` (único valor aceito
nesta fase); período de 30 dias. Cada um é linha na tabela `plans` ou variável
em `lib/env.ts`, e a tela do dono os mostra como "placeholder — decisão do
proprietário". Preço, nome, gateway real e carência continuam do proprietário.

**Uso por capability** (para `remaining`): `users.invite` = membros ativos;
`ai.reply`/`ai.summary`/`ai.embedding` = linhas de `ai_usage_events` da
operação no mês; `channel.whatsapp.send` = mensagens de saída no mês;
`knowledge.ingest` = materiais do acervo. Nada é contado duas vezes: são
leituras das tabelas que já existem.

### 4. Suporte (D39, D51): motivo, escopo, vencimento, só leitura

- `access_mode` da rota SaaS aceita só `support_readonly`; `full` devolve 422.
  O enum do banco conserva `full` (o kit herdado o usa em outra instalação),
  mas nenhuma sessão nova nesta base nasce `full`.
- `reason` obrigatório (10–500), `scope` obrigatório, `expires_in_minutes`
  1–60 (`IMPERSONATE_TTL_SECONDS` continua o teto). Os três vão para a linha
  da sessão, para `fn_support_context` e para a auditoria.
- Escopo: `all` = tudo (só leitura); `inbox` = `/api/v1/inbox/*`, `/api/v1/conversations/*`,
  `/api/v1/messages/*`; `crm` = `/api/v1/contacts/*`, `/api/v1/crm/*`, `/api/v1/catalog/*`;
  `settings` = `/api/v1/settings/*`; `billing` = `/api/v1/billing/*`. Rota fora
  do escopo → 403 `support_scope` (contada). Telas seguem as rotas que lêem.

### 5. §B11, §B15 e `size` (D51 d)

- **§B11**: `resolveSentryDsn` passa a devolver `undefined` para vazio; a
  comunidade vira `SENTRY_DSN=community` (opt-in explícito). O README do kit e
  `.env.example` dizem isso. Nenhuma instalação sem `SENTRY_DSN` exporta erro.
- **§B15**: `scripts/f02-fixture-writer.ts` — quando o `insert … on conflict
  do nothing` cria 0 linhas, a conferência passa a ser "existe linha com este
  id nesta organização" (idempotência por id, como o loader); a conferência
  byte a byte continua para a linha que acabou de nascer. `up.sh` volta a ser
  re-executável em staging tocado pelo smoke.
- **`size`**: sai dos três seeds, do tipo do loader e da asserção do teste; o
  loader não declara mais nada sobre tamanho (não há coluna, §5.21 já não o
  lista).

## Alternativas rejeitadas

- **Reaproveitar `organizations.status='suspended'` como inadimplência.** A
  suspensão herdada é bloqueio total pelo operador (nem leitura); D44 exige
  leitura e cobrança preservadas. São dois estados com dois donos.
- **Organização sem assinatura = bloqueada.** Reprovaria centenas de testes
  herdados que criam organização por SQL e nunca souberam de assinatura; e
  o ganho é nulo porque nenhum caminho de criação desta base deixa de criar
  a assinatura (medido em F11-T04). Fica `legacy_without_subscription`,
  visível no smoke.
- **Gateway real "atrás de flag".** D11/D51: sem gasto, sem provedor real.
  O mock tem a mesma forma (checkout, webhook assinado, evento com referência
  e instante) para que o adaptador real da F08+ seja uma classe, não um
  redesenho.
- **Escolher preços "provisórios" em reais.** Número em campo de preço vira
  fato. `price_cents=0` com `source='placeholder'` é o único valor que não
  mente.
- **Manter o modo `full` no suporte com motivo.** D51 diz "só leitura"; o
  motivo não compensa escrita em dado de cliente por quem não é da empresa.
- **Trigger em `organizations` criando a assinatura.** Faria toda organização
  de teste herdada nascer `pending_payment` e cair no gate; o custo do gate
  em `requireRole` seria pago por suítes que não são de cobrança.

## Consequências

- `src/billing/` é módulo novo e `src/entitlement/` ganha o resolver por plano;
  o invariante 1 de §5.3 (`grep plan|quota|credit|allowance` fora de
  `src/entitlement/` = 0) passa a excluir também `src/billing/`.
- `entitlement()` vira `async`; `withEntitlement` já era. Único chamador em
  produção (`src/ai/chamada.ts`) não muda de forma.
- Três eventos de notificação novos (`subscription.payment_failed`,
  `subscription.blocked`, `subscription.activated`) entram no enum e nos dois
  CHECKs de 9021 (por adição, sem estreitar).
- Duas specs de navegador novas e dez testes no inventário fechado; mutantes
  60–64 (`mutants_killed` sobe de 56 para 61).
- O staging ganha `plans` (3), uma assinatura por tenant (backfill declarado) e
  um `platform_admin` fictício; nada é produção.
- Continua do proprietário: preço/nome dos planos, gateway real, dias de
  carência, pro-rata, período do ciclo, `platform_admin` real (D12 item 7).

## Data

2026-09-13

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-030-F11-F12-administracao-entrada-guiada-e-assinatura.md`).
