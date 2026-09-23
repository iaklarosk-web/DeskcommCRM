# ADR-037 — verify.sh v1.9: F15 no gate com a spec da automação/autonomia, a linha `autonomy:` e mutantes 69–72

Adendo a [ADR-005](ADR-005-verify-v1.md), [ADR-018](ADR-018-verify-v1.1.md),
[ADR-029](ADR-029-verify-v1.5-replicabilidade-por-tenant-e-loader-do-seed.md),
[ADR-031](ADR-031-verify-v1.6-F11-F12.md), [ADR-033](ADR-033-verify-v1.7-F08.md)
e [ADR-035](ADR-035-verify-v1.8-F13.md). D25 permite mudança no `verify.sh`
só por ADR; §8.3 manda acrescentar campos, nunca remover. As decisões de
produto da F15 estão em [ADR-036](ADR-036-F15-automacao-e-autonomia-de-ia.md).

## Contexto

`current_phase: F15` cai no `*)` do `case` de `scripts/verify.sh` e sai
`NOT READY` ("fase ainda sem gate completo"). O que a F15 entrega (política
por ação, limite/pausa, handoff por rodízio, regras sobre o catálogo,
conhecimento incremental) não é coberto por nenhum campo do bloco: `ai_eval`
mede o dataset com o dublê de Entitlement, `handoff` mede resumo/notificação
sem atribuição, `crm` mede a fila de oportunidades. A fase precisa de (1)
inventário de navegador próprio, (2) uma linha medida com denominador e (3)
lugar na ordem de fechamento (a F14 não fechou: `closesAtOrAfter` conta as
fases fora da ordem escrita pelo número, e F15 > F13).

## Decisão

### 1. F15 entra em `GATED_PHASES` com uma spec nova

`F15) CLOSED_E2E=1; EXPECTED_SPECS=14; REPLICABILITY_TENANTS="deka,demo2"`;
`REQUIRED_F15_E2E_SPECS = [...REQUIRED_F13_E2E_SPECS, "tests/e2e/f15-automacao-e-autonomia.spec.ts"]`;
`EXPECTED_F15_E2E_TESTS = EXPECTED_F13_E2E_TESTS + 7` (65). Por tenant do
seed, `replicability` medido como a F07. `CLOSING_ORDER` recebe `F15` depois
de `F13`: `admin`, `billing` e `crm` continuam obrigatórios; a cláusula
numérica de `closesAtOrAfter` passa a usar a ÚLTIMA fase da ordem escrita
(`F15`), para que F16+ herdem tudo e a F14, quando fechar, entre na ordem por
ADR própria.

### 2. Linha `autonomy:` obrigatória a partir da F15

Lida de `metrics/autonomy.line` (gravada pela suíte de integração
`tests/integration/f15-automacao-e-autonomia.test.ts` via `gravarLinhaDoVerify`),
impressa `pending` antes da F15 e obrigatória quando `closesAtOrAfter(phase, "F15")`
(`requiresAutonomy`, com marcador `// MUTANT: autonomy-required`). Campos e contrato:

| Campo | Contrato |
|---|---|
| `policy_modes=4/4` | numerador = denominador = 4 (allow, approve, block, transfer exercitados por executor `ai`) |
| `ai_task_created=1/1` | exato (§B5/§C6 fechado) |
| `limit_hits=1/1` | exato |
| `calls_after_limit=0/K` | numerador 0, K ≥ 3 (turnos tentados depois do limite) |
| `paused=1/1`, `resumed=1/1` | exatos |
| `handoffs=H` | H ≥ 3 |
| `balanced=1` | max − min de handoffs por atribuído ≤ 1 |
| `assignees_distinct=K` | K ≥ 2 |
| `rules=R` | R ≥ 4 (uma por gatilho) |
| `runs=R/R` | numerador = denominador = `rules` |
| `replays=P` | P ≥ `rules` (cada evento redespachado ao menos uma vez) |
| `duplicate_runs=0` | exato — o índice 9027 recusa a segunda run |
| `outside_catalog_denied=1/1` | exato |
| `reindexed=N/N`, `unchanged_skipped=M/M`, `sources_cited=S/S` | cada um ≥ 1 e numerador = denominador |
| `roles_denied=D/D` | D ≥ 3, numerador = denominador |

A linha entra no bloco depois de `crm:` (ordem de §8.3, campos só
acrescentados). `ai_real:` NÃO é campo do bloco (ADR-036 §3): vive no
cabeçalho do BUILD-STATE como `prod:`/`smoke:`.

### 3. Mutantes 69–72

- **69** `tests/mutants/69-f15-verify-autonomy-obrigatorio.sh`: desliga
  `requiresAutonomy` no `report.mjs`; o caso "missing autonomy line makes
  otherwise green F15 fail" de `tests/verify/gate.cases.mjs` tem de ficar vermelho.
- **70** `tests/mutants/70-f15-politica-block-ignorada.sh`: sabota
  `src/actions/politica.ts` (`block` tratado como `allow`); a unit
  `tests/unit/f15-t01-politica-por-acao.test.ts` ("block nega e audita") tem
  de ficar vermelha.
- **71** `tests/mutants/71-f15-limite-nao-conta.sh`: sabota
  `src/ai/limite.ts` (contagem do dia sempre 0); a unit
  `tests/unit/f15-t02-limite-diario.test.ts` ("ao bater o limite não chama o
  provedor") tem de ficar vermelha.
- **72** `tests/mutants/72-f15-regra-fora-do-catalogo-aceita.sh`: sabota o
  validador de `automation-rules` (aceita qualquer `actions[].type`); a unit
  `tests/unit/f15-t04-regras-sobre-o-catalogo.test.ts` ("ação fora do catálogo
  é recusada") tem de ficar vermelha.

`mutants_killed` sobe de 65 para 69.

## Alternativas rejeitadas

- **`autonomy` como campos soltos no `ai_eval:` ou no `handoff:`.** Cada
  linha mede uma entrega fechada; misturar esconderia o que a F15 entregou e
  mudaria contratos de fases já READY.
- **`ai_real:` dentro do bloco.** O bloco roda com mock por desenho; uma
  métrica real no bloco seria produzida fora do gate e colada — exatamente o
  que §8.5 chama de fechamento preguiçoso.
- **Contar a F14 na ordem de fechamento agora.** Ela não tem ADR nem gate;
  entra quando fechar, pela sua ADR.

## Consequências

- Gate da F15 = gate da F13 + 1 spec (7 testes × 2 tenants, ≈ +6 min) + 1
  suíte de integração + 4 mutantes; ≈ 115–120 min com a máquina livre.
- `EXPECTED_SPECS=14` e `EXPECTED_F15_E2E_TESTS=65` continuam duas afirmações
  independentes do inventário (ADR-018).

## Data

2026-09-14

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-037-verify-v1.9-F15.md`).
