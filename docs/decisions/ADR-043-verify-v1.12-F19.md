# ADR-043 — verify.sh v1.12: F19 no gate com a spec da cobrança real, a linha `stripe:` e mutantes 81–85

Adendo a [ADR-005](ADR-005-verify-v1.md), [ADR-018](ADR-018-verify-v1.1.md),
[ADR-029](ADR-029-verify-v1.5-replicabilidade-por-tenant-e-loader-do-seed.md),
[ADR-031](ADR-031-verify-v1.6-F11-F12.md), [ADR-033](ADR-033-verify-v1.7-F08.md),
[ADR-035](ADR-035-verify-v1.8-F13.md), [ADR-037](ADR-037-verify-v1.9-F15.md),
[ADR-039](ADR-039-verify-v1.10-F14.md) e [ADR-041](ADR-041-verify-v1.11-F18.md).
D25 permite mudança no `verify.sh` só por ADR; §8.3 manda acrescentar campos,
nunca remover. As decisões de produto da F19 estão em
[ADR-042](ADR-042-F19-cobranca-real-por-stripe.md).

## Contexto

`current_phase: F19` cai no `*)` do `case` de `scripts/verify.sh` e sai
`NOT READY`. O que a F19 entrega — um webhook que recusa assinatura inválida,
evento `live` em instalação de teste e preço fora da lista; estado lido do
provedor; trial mapeado; Portal; as cinco ações do painel; o cockpit por
token — não é coberto por nenhum campo do bloco: `billing:` mede a máquina
de estados com o gateway mock (duplicata, fora de ordem, ativação, carência,
cancelamento) e não sabe dizer se o webhook REAL foi verificado.

## Decisão

### 1. F19 entra em `GATED_PHASES` e no FIM de `CLOSING_ORDER`

`F19) CLOSED_E2E=1; EXPECTED_SPECS=17; REPLICABILITY_TENANTS="deka,demo2"`;
`REQUIRED_F19_E2E_SPECS = [...REQUIRED_F18_E2E_SPECS, "tests/e2e/f19-cobranca-stripe.spec.ts"]`;
`EXPECTED_F19_E2E_TESTS = EXPECTED_F18_E2E_TESTS + 7` (86).
`CLOSING_ORDER` recebe `F19` depois de `F18`: `admin`, `billing`, `crm`,
`autonomy`, `channels` e `engine` continuam obrigatórios. A cláusula
posicional de `closesAtOrAfter` não muda.

### 2. Linha `stripe:` obrigatória a partir da F19

Lida de `metrics/stripe.line` (suíte `tests/integration/f19-cobranca-stripe.test.ts`),
`pending` antes da F19 e obrigatória quando `closesAtOrAfter(phase, "F19")`
(`requiresStripe`, marcador `// MUTANT: stripe-required`). O nome entra nas
TRÊS listas do `report.mjs` — contrato, leitura (`metrics[name]`) e render —
porque linha gravada e não lida sai `pending` com a suíte verde (lição da
F18). Campos e contrato:

| Campo | Contrato |
|---|---|
| `signature_rejected` | `1/1` — webhook sem `Stripe-Signature` válida responde 401 e não grava |
| `livemode_mismatch` | `1/1` — evento `livemode` ≠ `STRIPE_MODE` responde 422 e não grava |
| `price_outside_list` | `1/1` — `price.id` fora de `STRIPE_PRICE_IDS` responde 422 e não grava |
| `checkout_created` | `1/1` — `POST /api/v1/billing/checkout` cria a sessão no Stripe com `client_reference_id` = organização e devolve a URL |
| `activated` | `1/1` — `checkout.session.completed` leva `pending_payment` → `active` |
| `trialing_mapped` | `1/1` — subscription `trialing` chega como `active` com `trial_ends_at` |
| `duplicates` | ≥ 1 — o mesmo `event.id` duas vezes é recusado pelo índice, sem segunda ativação |
| `out_of_order` | ≥ 1 — evento com `created` anterior ao último aplicado é contado, não aplicado |
| `state_from_provider` | `1/1` — payload diz `active`, o provedor diz `past_due`: o CRM grava `past_due` |
| `past_due` | `1/1` — `invoice.payment_failed` → `past_due` com aviso |
| `blocked_after_grace` | `1/1` — a varredura da carência bloqueia depois de `BILLING_GRACE_DAYS` |
| `cancelled_preserved` | `N/N` — `customer.subscription.deleted` → `cancelled` e as N tabelas da organização mantêm as linhas |
| `portal_link` | `1/1` — "Gerenciar assinatura" cria a sessão do Portal e devolve a URL |
| `admin_actions` | `5/5` — suspender, reativar, estender trial, provisionar na mão, abrir no Stripe |
| `summary_ok` | `1/1` — `GET /api/admin/summary` com o token responde os itens; sem token, 401; token vazio na instalação, 503 |

### 3. Mutantes 81–85

| # | Mutante | Quem mata |
|---|---|---|
| 81 | `claude-sonnet-5` sem preço na tabela (§B23 b) | unit "claude-sonnet-5 é cotado a 2/10 USD por milhão — nunca zero" |
| 82 | `requiresStripe` sempre `false` | régua do report: "missing stripe line makes otherwise green F19 fail" |
| 83 | webhook aceita assinatura inválida | `signature_rejected` |
| 84 | `livemode` ignorado | `livemode_mismatch` |
| 85 | estado lido do payload em vez do provedor | `state_from_provider` |

### 4. O gate roda com `BILLING_GATEWAY=stripe` contra o Stripe falso

`.env.e2e` (sandbox, staging e from-scratch) passa a trazer `BILLING_GATEWAY=stripe`,
`STRIPE_MODE=test`, chaves fictícias rotuladas como tais, `STRIPE_PRICE_IDS`
dos três planos e `STRIPE_API_BASE=http://127.0.0.1:<E2E_PORT+1000>`. O
`playwright.config.ts` ganha um segundo `webServer` (`tests/e2e/utils/stripe-falso.mjs`).
As specs herdadas `f11-admin-e-entrada` e `f12-assinatura` percorrem o
checkout pelo helper `pagarNoCheckout(page)`, que declara no log qual gateway
exercitou (ADR-042 §4). Campo novo por isso: nenhum — `e2e` e `billing:` já
medem o resultado.

### 5. Smoke +1

`webhook_stripe_unsigned_rejected=1/1`: `POST /api/v1/webhooks/stripe` sem
assinatura responde 401 (gateway `stripe`) ou 503 (gateway `mock`, sem
segredo) — nunca 200. Vale em staging e produção.

## Consequências

- `EXPECTED_SPECS` 16 → 17 e `e2e` 79 → 86 por passe; o gate ganha ~6 min.
- Fase futura que mexer na cobrança herda `stripe:` sem ADR novo (posicional).
- O gate deixa de exercitar a página `mock-checkout` pelo navegador; o
  gateway mock continua medido pela integração (`billing:`) — e é o que a
  produção roda até o proprietário registrar o webhook (ADR-042 §7).

## Data

2026-09-19.
