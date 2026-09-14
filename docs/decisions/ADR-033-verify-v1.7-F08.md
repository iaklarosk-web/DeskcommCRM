# ADR-033 — verify.sh v1.7: F08 no gate com o inventário de F12, ordem de fechamento para `admin`/`billing`, régua do compose de produção e mutante 65

Adendo a [ADR-005](ADR-005-verify-v1.md), [ADR-018](ADR-018-verify-v1.1.md),
[ADR-028](ADR-028-verify-v1.4-e-staging-nesta-vps.md),
[ADR-029](ADR-029-verify-v1.5-replicabilidade-por-tenant-e-loader-do-seed.md)
e [ADR-031](ADR-031-verify-v1.6-F11-F12.md). D25 permite mudança no `verify.sh`
só por ADR; §8.3 manda acrescentar campos, nunca remover. As decisões de
produto da F08 estão em [ADR-032](ADR-032-F08-servicos-reais-e-producao-inicial.md).

## Contexto

`GATED_PHASES` termina em F12 e `verify.sh` não tem caso para `F08`: com
`current_phase: F08` o gate sai `NOT READY` por "fase ainda sem gate
completo". A F08 (produção inicial) não acrescenta tela de tenant — o que ela
prova é provedor real e stack de produção, que o gate NÃO pode tocar
(`AI_PROVIDER=mock`, `WHATSAPP_MODE=mock`, D12). E `requiresAdmin`/
`requiresBilling` decidiam por NÚMERO da fase (`>= 11`, `>= 12`): a F08, que
fecha DEPOIS de F11+F12 e herda o código delas, ficaria sem os dois campos
obrigatórios — o oposto de "nunca remover".

## Decisão

### 1. F08 entra em `GATED_PHASES` com o inventário de F12

`F08) CLOSED_E2E=1; EXPECTED_SPECS=12; REPLICABILITY_TENANTS="deka,demo2"` —
`REQUIRED_F08_E2E_SPECS = REQUIRED_F12_E2E_SPECS` (12 specs, 51 testes), por
tenant do seed, com `replicability` medido como a F07. Nenhum campo novo no
bloco. No staging o rótulo continua `READY (staging)`; a produção é medida
pela linha `prod:` FORA do bloco (ADR-032 §4), ao lado de `restore:`/`smoke:`.

### 2. `admin` e `billing` obrigatórios pela ORDEM DE FECHAMENTO

`CLOSING_ORDER = [F00 … F07, F11, F12, F08]`; `closesAtOrAfter(phase, ref)`
substitui `phaseNumber(phase) >= phaseNumber(ref)` nos dois campos de
ADR-031 (fases > F12 continuam obrigadas por número). Mutantes 60 e 62
reapontados para a linha nova (`f04`-style: alvo desatualizado é mutante vivo).

### 3. Régua estática do compose de produção + mutante 65

`tests/unit/f08-t01-compose-de-producao.test.ts` lê `compose.prod.yml` e
cobra, com contagem: 14 serviços e nenhum dublê (`waha-mock`, `mailpit`);
`mem_limit`/`restart`/`logging`/rede/`container_name` em 14/14; 6 portas,
todas em `127.0.0.1` ou `${PROD_BIND_IP}` e só 3300/56431/56432; app e 3
workers com `WHATSAPP_MODE=waha`, `AI_PROVIDER=anthropic`, `APP_NAME=${PLATFORM_NAME}`,
`env_file` de produção e sem override de `SENTRY_DSN`; nenhum valor de
`environment` com `mock|placeholder|staging|example.test|localhost|mailpit`;
GoTrue pela Resend por SMTP e `GOTRUE_DISABLE_SIGNUP=true` enquanto o
BLOCKER-PROD estiver aberto (D13); WAHA com tag pinada, dashboard desligado,
HMAC e chave hasheada; e os 19 arquivos que o compose/runbook citam existem
(`documentacao-aponta-para-o-que-existe`).

Mutante 65 (`tests/mutants/65-f08-compose-de-producao-com-mock.sh`): troca
`AI_PROVIDER: anthropic` por `mock` no app numa CÓPIA do compose
(`F08_COMPOSE_PROD`); o caso "provedores REAIS" tem de ficar vermelho.
`mutants_killed` sobe de 61 para 62.

### 4. Fora do gate, como nas fases anteriores

`prod:` (ADR-032 §4) é gravada por `scripts/prod/prova.sh` contra o stack de
pé, com denominador em cada campo; `prod_stack:` por `scripts/prod/status.sh`.
As duas ficam no BUILD-STATE. `docs/ops/prod-jornadas.log` (versionado) guarda
o id do provedor de cada jornada real — nunca o corpo.

## Alternativas rejeitadas

- **`prod:` dentro do bloco, medida por uma suíte.** O gate roda com mocks
  por decisão (D12) e em máquina que não é a produção; uma suíte que
  "medisse" produção leria um arquivo — prova de papel.
- **`requiresAdmin` por número com exceção `phase === "F08"`.** A ordem de
  fechamento é o fato; codificá-la evita a próxima exceção (F09, F10).
- **Spec de navegador para a produção.** Navegador contra produção é
  jornada humana (teste visual do proprietário); o gate não pode logar como
  o dono real.

## Consequências

- Gate da F08 = gate da F12 (≈ 105 min com a máquina livre) + a régua
  estática (< 1 s) + 1 mutante (≈ 10 s).
- `EXPECTED_SPECS=12` e `EXPECTED_F08_E2E_TESTS=51` continuam duas afirmações
  independentes do inventário (ADR-018).

## Data

2026-09-14

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-033-verify-v1.7-F08.md`).
