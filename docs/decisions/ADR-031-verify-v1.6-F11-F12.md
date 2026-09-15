# ADR-031 — verify.sh v1.6: F11 e F12 no gate, campos `admin` e `billing`, duas specs no inventário

Adendo a [ADR-005](ADR-005-verify-v1.md), [ADR-018](ADR-018-verify-v1.1.md),
[ADR-022](ADR-022-verify-v1.2.md), [ADR-024](ADR-024-verify-v1.3.md),
[ADR-028](ADR-028-verify-v1.4-e-staging-nesta-vps.md) e
[ADR-029](ADR-029-verify-v1.5-replicabilidade-por-tenant-e-loader-do-seed.md).
D25 permite mudança no `verify.sh` só por ADR; §8.3 manda acrescentar campos,
nunca remover. As decisões de produto de F11/F12 estão em [ADR-030](ADR-030-F11-F12-administracao-entrada-guiada-e-assinatura.md).

## Contexto

`GATED_PHASES` termina em F07. D51 (a) manda construir F11 e F12 juntas e
fechá-las com `READY (staging)` dentro do staging. Sem gate, `verify.sh` com
`current_phase: F11` sai `NOT READY` por "fase ainda sem gate completo"; e
§8.3 não tem grafia para o que §7.9 pede de F11 ("suporte auditado e
limitado", "nenhum acesso operacional gratuito por falha no fluxo") nem de F12
("pagamento confiável ativa uma vez; eventos duplicados/fora de ordem não
duplicam acesso/cobrança; aviso/carência/bloqueio com dias definidos").

## Decisão

### 1. F11 e F12 entram em `GATED_PHASES`; cada uma acrescenta UMA spec

- `F11` → inventário de F07 (10 specs, 41 testes) **+**
  `tests/e2e/f11-admin-e-entrada.spec.ts` (6 testes: painel do dono e
  acompanhamento por tenant × 2; cadastro pendente e wizard × 1) = 11 specs,
  47 testes.
- `F12` → inventário de F11 **+** `tests/e2e/f12-assinatura.spec.ts`
  (4 testes: tela contra banco e ciclo cancelar → contratar → pagamento mock →
  ativação, por tenant × 2) = 12 specs, 51 testes.
- As duas rodam o navegador **por tenant do seed** (`E2E_TENANT=deka`, depois
  `demo2`) e medem `replicability` como a F07 (ADR-029 §1): as organizações A
  das fixtures novas vêm do loader, que grava a assinatura `seed`; B é
  fictícia com assinatura `fixture`.
- `verify.sh`: `F11) EXPECTED_SPECS=11`, `F12) EXPECTED_SPECS=12`, ambas com
  `REPLICABILITY_TENANTS="deka,demo2"`. A fase que o gate roda ao FECHAR as
  duas é `current_phase: F12` — o inventário de F12 contém o de F11 inteiro e
  os dois campos são obrigatórios; o BUILD-STATE registra o mesmo gate nas
  duas linhas. `.github/workflows/e2e.yml` recebe as duas specs.

### 2. Dois campos novos, gravados pelas suítes de integração

`gravarLinhaDoVerify` (ADR-005), `pending` antes da fase; obrigatório ausente
reprova (`metric()`), e um valor fora do contrato reprova com
`violation: admin fora do contrato…` / `violation: billing fora do contrato…`.

| Campo | Gravado por | Grafia | Contrato |
|---|---|---|---|
| `admin` (≥ F11) | `tests/integration/f11-entrada-e-suporte.test.ts` | `admin: tenants_listed=T/T support_sessions=S support_reason=S/S support_scope_denied=D/D support_writes_denied=W/W full_mode_rejected=1/1 signup_awaiting_payment=1/1 orgs_without_subscription=0/N` | `tenants_listed ≥ 2`, `support_sessions ≥ 2`, `support_reason = support_sessions`, `support_scope_denied ≥ 2`, `support_writes_denied ≥ 4`, `full_mode_rejected = 1`, `signup_awaiting_payment = 1`, `orgs_without_subscription = 0` |
| `billing` (≥ F12) | `tests/integration/f12-assinatura.test.ts` | `billing: plans=P events=E duplicates=1 out_of_order=1 activations=1/1 blocked_writes_denied=W/W grace_days=G reconciliation_mismatch=0/N cancellations=1/1 data_preserved=R/R` | `plans ≥ 3`, `events ≥ 4`, `duplicates ≥ 1`, `out_of_order ≥ 1`, `activations = 1`, `blocked_writes_denied ≥ 4`, `grace_days ≥ 1`, `reconciliation_mismatch = 0`, `cancellations = 1`, `data_preserved ≥ 1` |

O que cada número mede, e por que é o denominador certo:

- `support_reason = support_sessions`: TODA sessão de suporte da corrida tem
  motivo (D39). `full_mode_rejected = 1`: o caminho SaaS não produz modo de
  edição (D51). `orgs_without_subscription = 0/N`: nenhuma organização das
  fixtures ficou sem assinatura — é a garantia de D38 sobre o que a suíte
  criou, e o smoke repete a medida no staging.
- `duplicates = 1` e `out_of_order = 1` com `activations = 1/1`: as duas
  entregas que NÃO podem ativar de novo foram entregues e não ativaram — o
  "eventos duplicados/fora de ordem não duplicam acesso/cobrança" de §7.9
  com denominador. `blocked_writes_denied = W/W`: D44, escrita negada em toda
  rota de negócio testada. `data_preserved = R/R`: linhas contadas antes e
  depois do cancelamento, iguais. `grace_days`: o valor em vigor (7,
  placeholder — a linha o declara, não o decide).

O nome `signup_awaiting_payment` (e não `signup_pending`) é deliberado: `metric()`
trata qualquer `pending` na linha como campo não medido.

### 3. O que fica FORA do bloco, como nas fases anteriores

- `smoke:` ganha o passo de cobrança no staging (F12-T08): login do dono
  fictício, `subscriptions[deka]`/`[demo2]` e `orgs_without_subscription`.
  Continua no BUILD-STATE ao lado de `restore:` (ADR-028 §1).
- O gate de escrita da assinatura vale nas rotas que passam por `requireRole`
  (as rotas de escrita da base, §5.4 invariante 1); leituras herdadas que
  respondem só por RLS (ex.: `GET /api/v1/contacts`) não o consultam —
  são leituras, e D44 preserva leitura. Declarado, não escondido.
- Os testes de unidade recebem um dublê GLOBAL de `lib/auth/acesso-da-assinatura`
  e `lib/auth/assinatura-provisionada` (`tests/setup/vitest.setup.ts`):
  "organização sem assinatura = full". A suíte de unidade nunca teve banco; o
  guarda sob `blocked`/`pending`/erro é provado em
  `tests/unit/f12-t04-guarda-da-assinatura.test.ts` (que redeclara o mock), e o
  caminho real nas integrações e no navegador.

### 4. Mutantes 60–64 (`mutants_killed` sobe de 56 para 61)

| # | Sabotagem | O que fica vermelho |
|---|---|---|
| 60 | `requiresAdmin = () => false` em `report.mjs` | `missing admin line makes otherwise green F11 fail` |
| 61 | `rotaNoEscopo` responde sim para tudo (`lib/impersonate/escopo.ts`) | "escopo: rota fora do escopo é negada…" (`f11-entrada-e-suporte`) |
| 62 | `requiresBilling = () => false` | `missing billing line makes otherwise green F12 fail` |
| 63 | `on conflict … do update` no insert de `billing_events` (duplicata vira linha e reaplica) | "a segunda entrega do mesmo evento é duplicate…" (`f12-eventos-e-bloqueio`) |
| 64 | `blocked: "full"` em `MODO_POR_ESTADO` | "bloqueada por atraso é read_only…" (`f12-eventos-e-bloqueio`) |

Os casos de 63/64 vivem num arquivo AUTOCONTIDO (`f12-eventos-e-bloqueio`) de
propósito: `-t` do vitest roda só o caso, e um caso que dependesse da ordem
de `f12-assinatura.test.ts` ficaria vermelho pela dependência, não pela
sabotagem — mutante morto por acidente é mutante vivo.

## Alternativas rejeitadas

- **Um gate só, `F12`, sem `F11` em `GATED_PHASES`.** As duas fecham juntas,
  mas cada uma tem entrega e inventário próprios; `F11` no gate deixa a linha
  `admin` medível sozinha se a F12 precisar ser reaberta.
- **`admin`/`billing` medidos no navegador.** As contagens que importam
  (duplicata, fora de ordem, escrita negada com denominador, motivo em toda
  sessão) são de banco; o navegador prova a tela contra o banco, e é o que
  as specs fazem.
- **Gate de assinatura por trigger ou por leitura em toda rota herdada.**
  ADR-030 §3 rejeitou o trigger; ler em toda rota herdada de leitura seria
  negar leitura a quem D44 manda preservar.

## Consequências

- Gate da F12 = gate da F07 + 10 testes de navegador por tenant (≈ +6 min por
  execução) + duas suítes de integração (≈ 30 s).
- `EXPECTED_SPECS` e `EXPECTED_F11/F12_E2E_TESTS` são duas afirmações
  independentes do inventário (ADR-018): 11/47 e 12/51.
- As specs herdadas `suporte-temporario.spec.ts` e
  `agenda-presenca-recuperacao.spec.ts` (fora do inventário, no `e2e.yml`)
  passam a preencher o motivo; as asserções de MODO DE EDIÇÃO delas descrevem
  um modo que a rota SaaS não oferece — VARREDURA §B16, do proprietário.

## Data

2026-09-13

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-031-verify-v1.6-F11-F12.md`).
