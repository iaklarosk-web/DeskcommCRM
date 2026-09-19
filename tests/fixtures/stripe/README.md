# Fixtures do Stripe (F19, ADR-042 §2)

Payloads de webhook no FORMATO do Stripe (objeto `event` com `data.object`,
`livemode`, `created`, `type`; API `2025-08-27.basil`), em modo TEST, BRL,
ids fictícios com o sufixo `F19Fixture`. `subscription.trialing.json` é a
resposta de `GET /v1/subscriptions/{id}` que o adapter busca (regra 4: o
estado vem do provedor).

Regra 13 (AGENTS §5): fixture de webhook = payload real do provedor. Estes
foram MODELADOS sobre a forma documentada dos objetos — sem chave, não há
como capturar do provedor. Quando a prova real da T05 rodar (`stripe listen
--print-json`), os eventos capturados substituem estes arquivos, com os ids
reais de teste, e este parágrafo sai.

| Arquivo | O que o receptor faz com ele |
|---|---|
| `checkout.session.completed.json` | acha a organização por `client_reference_id`, busca a subscription, `trialing` → `payment_confirmed` com `trial_ends_at` |
| `invoice.paid.json` | `payment_confirmed` (renova) |
| `invoice.payment_failed.json` | `payment_failed` → `past_due` + carência |
| `customer.subscription.updated.json` | busca a subscription; `active` + preço do PLAN_B → renova e sincroniza `plan_code` |
| `customer.subscription.deleted.json` | `cancelled`, dados preservados |
