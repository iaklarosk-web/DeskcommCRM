# ADR-039 — verify.sh v1.10: F14 no gate com a spec dos canais/agenda, a linha `channels:` e mutantes 73–76

Adendo a [ADR-005](ADR-005-verify-v1.md), [ADR-018](ADR-018-verify-v1.1.md),
[ADR-029](ADR-029-verify-v1.5-replicabilidade-por-tenant-e-loader-do-seed.md),
[ADR-031](ADR-031-verify-v1.6-F11-F12.md), [ADR-033](ADR-033-verify-v1.7-F08.md),
[ADR-035](ADR-035-verify-v1.8-F13.md) e [ADR-037](ADR-037-verify-v1.9-F15.md).
D25 permite mudança no `verify.sh` só por ADR; §8.3 manda acrescentar
campos, nunca remover. As decisões de produto da F14 estão em
[ADR-038](ADR-038-F14-chat-do-site-agenda-e-canais.md).

## Contexto

`current_phase: F14` cai no `*)` do `case` de `scripts/verify.sh` e sai
`NOT READY`. A F14 fecha DEPOIS da F15 (ADR-037 previu: "a F14, quando
fechar, entra na ordem por ADR própria"). O que ela entrega — chat do site,
agenda adotada com disponibilidade/fuso/conflito, IA que marca horário — não
é coberto por nenhum campo do bloco.

## Decisão

### 1. F14 entra em `GATED_PHASES` e no FIM de `CLOSING_ORDER`

`F14) CLOSED_E2E=1; EXPECTED_SPECS=15; REPLICABILITY_TENANTS="deka,demo2"`;
`REQUIRED_F14_E2E_SPECS = [...REQUIRED_F15_E2E_SPECS, "tests/e2e/f14-canais-e-agenda.spec.ts"]`;
`EXPECTED_F14_E2E_TESTS = EXPECTED_F15_E2E_TESTS + 7` (72).
`CLOSING_ORDER` recebe `F14` DEPOIS de `F15` (`…, "F13", "F15", "F14"`):
`admin`, `billing`, `crm` e `autonomy` continuam obrigatórios na F14; a
cláusula numérica de `closesAtOrAfter` (fase fora da ordem escrita com
número maior que a última) passa a apontar para `F14` como última — F16+
herdam tudo — e deixa de se SOMAR à posicional: fase NA ordem conta só pela
posição (senão a F15, de número maior, herdaria `channels:` de uma fase que
fechou depois dela). `papeisEsperados` continua 4.

### 2. Linha `channels:` obrigatória a partir da F14

Lida de `metrics/channels.line` (suíte `tests/integration/f14-canais-e-agenda.test.ts`),
`pending` antes da F14 e obrigatória quando `closesAtOrAfter(phase, "F14")`
(`requiresChannels`, marcador `// MUTANT: channels-required`). Campos e contrato:

| Campo | Contrato |
|---|---|
| `webchat_sessions=N` | N ≥ 3 |
| `identified=N/N`, `contacts_created=C/C`, `ai_replies=A/A`, `proposed=Q/Q` | cada um ≥ 1 e numerador = denominador |
| `messages_in=M` | M ≥ 3 |
| `ai_outside_window=1/1`, `handoff_queued=1/1`, `ip_limited=1/1`, `org_limited=1/1`, `flood_calls_capped=1/1`, `cross_org_denied=1/1`, `conflicts_blocked=1/1`, `revoked_blocked=1/1`, `tz_ok=1/1`, `approved=1/1`, `denied_by_policy=1/1` | exatos |
| `appointments=P` | P ≥ 2 |
| `roles_denied=D/D` | D ≥ 2, numerador = denominador |

A linha entra no bloco depois de `autonomy:`. `webchat_real:` NÃO é campo do
bloco (ADR-038 §4): vive no cabeçalho do BUILD-STATE como `ai_real:`.

### 3. Mutantes 73–76

- **73** `tests/mutants/73-f14-verify-channels-obrigatorio.sh`: desliga
  `requiresChannels` no `report.mjs`; o caso "missing channels line makes
  otherwise green F14 fail" de `tests/verify/gate.cases.mjs` tem de ficar vermelho.
- **74** `tests/mutants/74-f14-webchat-desligado-aceita-sessao.sh`: sabota
  `src/webchat/sessao.ts` (ignora `webchat.enabled=false`); a unit
  `tests/unit/f14-t01-webchat-sessao.test.ts` ("desligado recusa sessão") tem
  de ficar vermelha.
- **75** `tests/mutants/75-f14-freio-por-ip-ignorado.sh`: sabota
  `src/webchat/freios.ts` (limite por IP nunca bate); a unit
  `tests/unit/f14-t01-webchat-freios.test.ts` ("freio por ip bate") tem de
  ficar vermelha.
- **76** `tests/mutants/76-f14-conflito-de-agenda-ignorado.sh`: sabota
  `src/agenda/marcar.ts` (conflito não recusa); a unit
  `tests/unit/f14-t03-agenda-conflito.test.ts` ("conflito recusa") tem de
  ficar vermelha.

`mutants_killed` sobe de 69 para 73.

## Alternativas rejeitadas

- **`channels` como campos soltos no `autonomy:` ou no `handoff:`.** Cada
  linha mede uma entrega fechada (ADR-037, mesmo motivo).
- **F14 ANTES da F15 na ordem de fechamento (pelo número).** A ordem é a de
  fechamento real; F15 fechou em 15/09 e a F14 fecha depois — a F14 herda
  `autonomy:` e a F16 herda as duas.
- **Contar as 18 specs herdadas de agenda no inventário.** 6.186 linhas que
  nunca rodaram no gate e duas pulam sem Google; a F14 mede o que adotou
  pela spec própria e pela linha; as herdadas continuam no `e2e.yml`
  (fora do inventário, como as de suporte — D30: nenhuma apagada nem pulada).

## Consequências

- Gate da F14 = gate da F15 + 1 spec (7 testes × 2 tenants, ≈ +6 min) + 1
  suíte de integração + 4 mutantes; ≈ 125–135 min com a máquina livre.
- `EXPECTED_SPECS=15` e `EXPECTED_F14_E2E_TESTS=72` continuam duas
  afirmações independentes do inventário (ADR-018).

## Data

2026-09-18

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-039-verify-v1.10-F14.md`).
