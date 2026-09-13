# ADR-018 — verify.sh v1.1: campo `webhook`, gate de F03 e specs de inbox

Adendo à [ADR-005](ADR-005-verify-v1.md) e à [ADR-007](ADR-007-verify-revalidacao.md).
D25 permite mudança no `verify.sh` só por ADR; §8.3 exige que cada versão
acrescente campos e nunca remova. F03-T10 nomeia esta versão.

## Contexto

O gate atual fecha F02: `evaluate()` só reconhece `F00|F01|F02`
(`scripts/verify/report.mjs:71`), os controles de sandbox, snapshot de inputs e
E2E fechado estão presos a `context.phase === "F02"` (`:88-113`), a lista de
specs obrigatórias é literal com sete arquivos e treze testes
(`scripts/verify/f02-e2e.mjs:6-15`) e a linha `webhook:` é uma string literal
`pending` no `render()` (`scripts/verify/report.mjs:231`). §8.3 torna `webhook`
obrigatório a partir de F03 e §7.4 acrescenta `inbox` ao `e2e`.

## Decisão

1. **F03 entra na lista de fases com gate completo.** Os controles hoje presos
   a `F02` passam a valer para F02 **e** F03 — sandbox descartável, snapshot
   SHA-256 dos inputs antes/depois, `e2e-plan` por `--list` e execução fechada
   em chromium, um worker, zero retries. Nada é afrouxado: F03 herda todos os
   controles de F02 e acrescenta os seus.
2. **`webhook` deixa de ser literal.** Passa a ser lida de
   `.verify-logs/metrics/webhook.line`, gravada pela própria suíte via
   `gravarLinhaDoVerify` — o mesmo mecanismo de `isolation`, `rls-coverage`,
   `rbac` e `entitlement` (ADR-005, decisão 1). `webhook` entra na lista de
   métricas de `collect()` e ganha validação de contrato em `evaluate()`:
   `stored=1`, `replay ≥ 2` e `tables_checked ≥ 4`. Ausência da linha imprime
   `pending` e reprova a partir de F03; em F00–F02 continua `pending` sem
   reprovar, preservando as provas já existentes.
3. **Inventário de specs por fase.** A lista literal de F02 vira o conjunto
   obrigatório de F02; F03 acrescenta as specs de inbox ao conjunto, com seu
   próprio número esperado de testes. O denominador de F02 não diminui: as sete
   specs e os treze testes continuam obrigatórios dentro do conjunto de F03.
4. **Mutantes.** O contrato de `tests/mutants/*.sh` não muda. F03 acrescenta os
   seus; `mutants_killed=Q/Q` cresce com Q. Entre eles, o mutante de F03-T10:
   remover a chave de idempotência de entrada faz `stored=2` e o gate sai 1.

## Alternativas rejeitadas

- **Deixar `webhook` literal e conferir à mão.** É exatamente o campo
  decorativo que §8.3 proíbe: obrigatório a partir de F03 significa medido pelo
  gate, não afirmado no texto.
- **Trocar o conjunto de specs de F02 pelo de F03.** Reduziria o denominador já
  provado; §8.3 diz que cada versão acrescenta e nunca remove.
- **Rodar o gate de F03 sem sandbox/inputs.** F03 escreve em banco e fila; sem
  o snapshot de inputs e o sandbox fechado o resultado não é reprodutível.
- **Relaxar `tables_checked` para a lista escrita à mão das tabelas tocadas.**
  G-26 exige descoberta em tempo de teste; lista à mão envelhece em silêncio.

## Consequências

O gate de F03 custa o de F02 mais as suítes e specs novas; nesta VPS de dois
núcleos ele continua em série, com um worker. O `verify.sh` passa a ter dois
conjuntos de specs obrigatórias e um campo a mais validado. Fases futuras
(F04 `ai_eval`, F05 `handoff`/`reminder`) seguem `pending` e reprovariam se
declaradas sem mecanismo, como já acontece hoje.

## Data

2026-09-10

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-018-verify-v1.1.md`).
