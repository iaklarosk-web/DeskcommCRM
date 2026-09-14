# ADR-035 — verify.sh v1.8: F13 no gate com a spec do CRM comercial, a linha `crm:`, `rbac: roles=4` e mutantes 66–68

Adendo a [ADR-005](ADR-005-verify-v1.md), [ADR-018](ADR-018-verify-v1.1.md),
[ADR-029](ADR-029-verify-v1.5-replicabilidade-por-tenant-e-loader-do-seed.md),
[ADR-031](ADR-031-verify-v1.6-F11-F12.md) e [ADR-033](ADR-033-verify-v1.7-F08.md).
D25 permite mudança no `verify.sh` só por ADR; §8.3 manda acrescentar
campos, nunca remover. As decisões de produto da F13 estão em
[ADR-034](ADR-034-F13-crm-comercial-completo.md).

## Contexto

`current_phase: F13` cai no `*)` do `case` de `scripts/verify.sh` e sai
`NOT READY` ("fase ainda sem gate completo"). O que a F13 entrega (fila de
oportunidades, campos por organização, papel `manager`, relatório conferido
com a origem) não é coberto por nenhum campo do bloco: `rbac` conta papéis
(e o contrato diz `roles=3`), `admin`/`billing` medem outra coisa. A fase
precisa de (1) inventário de navegador próprio, (2) uma linha medida com
denominador e (3) um contrato de `rbac` que aceite o quarto papel.

## Decisão

### 1. F13 entra em `GATED_PHASES` com uma spec nova

`F13) CLOSED_E2E=1; EXPECTED_SPECS=13; REPLICABILITY_TENANTS="deka,demo2"`;
`REQUIRED_F13_E2E_SPECS = [...REQUIRED_F12_E2E_SPECS, "tests/e2e/f13-crm-comercial.spec.ts"]`;
`EXPECTED_F13_E2E_TESTS = EXPECTED_F12_E2E_TESTS + 7` (58). Por tenant do
seed, `replicability` medido como a F07. `CLOSING_ORDER` recebe `F13` depois
de `F08`: `admin` e `billing` continuam obrigatórios.

### 2. Linha `crm:` obrigatória a partir da F13

Lida de `metrics/crm.line` (gravada pela suíte de integração
`tests/integration/f13-crm-comercial.test.ts` via `gravarLinhaDoVerify`),
impressa `pending` antes da F13 e obrigatória quando `closesAtOrAfter(phase, "F13")`
(`requiresCrm`, com marcador `// MUTANT: crm-required`). Campos e contrato:

| Campo | Contrato |
|---|---|
| `fields_defined=F` | F ≥ 4 |
| `values_rejected=R/R` | R ≥ 3, numerador = denominador |
| `values_preserved=V/V` | V ≥ 1, numerador = denominador |
| `queue_size=Q` | Q ≥ 3 |
| `distributed=Q/Q` | numerador = denominador = `queue_size` |
| `balanced=1` | max − min de oportunidades por dono ≤ 1 |
| `second_claim_rejected=1/1` | exato |
| `history_types=H` | H ≥ 3 (tipos gravados pelo módulo de oportunidades: `owner_assigned`, `owner_claimed`, `order_linked`; os herdados são conferidos pela spec) |
| `orders_linked=1/1` | exato |
| `cross_org_link_denied=1/1` | exato |
| `report_indicators=K/K` | K ≥ 8, numerador = denominador |
| `roles_denied=D/D` | D ≥ 3, numerador = denominador |

A linha entra no bloco depois de `billing:` (ordem de §8.3, campos só
acrescentados).

### 3. `rbac: roles=4` a partir da F13, pela fase ATIVA da árvore

`rbac.roles !== 3` vira `rbac.roles !== papeisEsperados(context.active)`, com
`papeisEsperados = (fase) => closesAtOrAfter(fase, "F13") ? 4 : 3`. A fase
ativa (`current_phase` do BUILD-STATE), não a fase pedida: a matriz é uma
propriedade da ÁRVORE, e `--revalidate F01` numa árvore com quatro papéis
tem de aceitar quatro — o contrário reprovaria a revalidação por um papel
que a própria ADR-034 acrescentou. A unit `rbac-matriz.test.ts` passa a
imprimir `roles=${PAPEIS_D15.length}`, não um literal.

### 4. Mutantes 66–68

- **66** `tests/mutants/66-f13-verify-crm-obrigatorio.sh`: desliga
  `requiresCrm` no `report.mjs`; o caso "missing crm line makes otherwise
  green F13 fail" de `tests/verify/gate.cases.mjs` tem de ficar vermelho.
- **67** `tests/mutants/67-f13-campo-obrigatorio-ignorado.sh`: sabota
  `src/crm/campos/validar.ts` (campo `required` sem valor passa); a unit
  `tests/unit/f13-t01-campos-configuraveis.test.ts` ("obrigatório sem valor é
  recusado") tem de ficar vermelha.
- **68** `tests/mutants/68-f13-rodizio-sempre-o-primeiro.sh`: sabota
  `src/crm/oportunidades/distribuicao.ts` (o rodízio escolhe sempre o
  primeiro elegível); a unit `tests/unit/f13-t03-fila-de-oportunidades.test.ts`
  ("rodízio equilibra") tem de ficar vermelha.

`mutants_killed` sobe de 62 para 65.

## Alternativas rejeitadas

- **`rbac.roles >= 3`.** Afrouxa o contrato para toda fase; o número exato
  por fase é o que prova que ninguém acrescentou papel sem ADR.
- **`crm` como campos soltos no `admin:`.** `admin` mede a plataforma (dono,
  suporte); misturar a operação comercial do tenant ali esconderia o que a
  F13 entregou.
- **Spec de funil herdada (`pipelines-gestao.spec.ts`) no inventário.** Ela
  depende de `.e2e-creds.json` e de um seed próprio fora da fixture por
  tenant (ADR-029); o inventário é fechado por fase e por tenant do seed.

## Consequências

- Gate da F13 = gate da F12 + 1 spec (7 testes × 2 tenants, ≈ +6 min) + 1
  suíte de integração + 3 mutantes; ≈ 110 min com a máquina livre.
- `EXPECTED_SPECS=13` e `EXPECTED_F13_E2E_TESTS=58` continuam duas afirmações
  independentes do inventário (ADR-018).

## Data

2026-09-14

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-035-verify-v1.8-F13.md`).
