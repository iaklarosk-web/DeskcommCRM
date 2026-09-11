# ADR-022 — verify.sh v1.2: campo `ai_eval` e gate de F04

Adendo à [ADR-005](ADR-005-verify-v1.md), [ADR-007](ADR-007-verify-revalidacao.md)
e [ADR-018](ADR-018-verify-v1.1.md). D25 permite mudança no `verify.sh` só por
ADR; §8.3 exige que cada versão acrescente campos e nunca remova. F04-T11 nomeia
esta versão.

## Contexto

Depois da ADR-018 o gate reconhece F00–F03, mede `webhook` e monta o inventário
de specs por fase. §8.3 torna `ai_eval` obrigatório a partir de F04 e move o
piso de `entitlement` de "≥2" para "≥ casos normais do dataset", que são seis
(§7.5, F04-T07). A tela de IA do tenant_admin (F04-T10) acrescenta uma spec.

## Decisão

1. **F04 entra na lista de fases com gate completo**, herdando integralmente os
   controles fechados de F02/F03 — sandbox descartável, snapshot SHA-256 dos
   inputs, inventário por `--list` e execução em chromium, um worker, zero
   retries.
2. **`ai_eval` deixa de ser literal `pending`** e passa a ser lido de
   `.verify-logs/metrics/ai-eval.line`, gravado pela própria suíte via
   `gravarLinhaDoVerify` — o mecanismo da ADR-005. Contrato validado:
   `cases ≥ 30`, `pass = cases`, `unknown = 6`, `injection = 10`,
   `cross_tenant = 5` e `provider_calls_at_zero_balance = 0`. Em F00–F03
   continua `pending` sem reprovar, preservando as provas já fechadas.
3. **O nome do arquivo diverge do nome do campo, e só aqui.**
   `gravarLinhaDoVerify` aceita `[a-z0-9-]` no nome do arquivo (underscore
   reprova), enquanto §8.3 fixa o rótulo do campo como `ai_eval`. O mapa
   `ARQUIVO_DA_METRICA` é o único lugar onde essa diferença existe; inventar um
   segundo rótulo no bloco seria pior.
4. **Piso de `entitlement` sobe a partir de F04** para seis — os casos normais
   do dataset. Antes de F04 o piso segue sendo dois.
5. **Inventário de specs de F04** = o de F03 mais `f04-ai-settings.spec.ts`,
   com dez testes (cinco jornadas nas duas organizações fictícias). Nenhuma
   spec de F02/F03 sai do conjunto.

## Alternativas rejeitadas

- **Deixar `ai_eval` literal e conferir à mão.** É o campo decorativo que §8.3
  proíbe: obrigatório a partir de F04 significa medido pelo gate.
- **Aceitar `pass < cases` como "quase lá".** Caso de avaliação que não bate com
  o banco é caso reprovado; a linha existe para medir isso, não para arredondar.
- **Não validar `provider_calls_at_zero_balance`.** É o único campo que separa
  "o agente respeita o entitlement" de "o entitlement nunca disse não" — sem ele
  a prova de D36 vira enfeite.
- **Renomear o campo para `ai-eval` no bloco** para casar com o arquivo.
  Mudaria a grafia que §8.3 fixa, e §8.3 prevalece sobre qualquer outra grafia
  do bloco.

## Consequências

O gate de F04 custa o de F03 mais a suíte de avaliação e a spec nova. Fases
seguintes (F05 `handoff`/`reminder`) continuam `pending` e reprovariam se
declaradas sem mecanismo, como já acontece. O mutante
`41-f04-verify-ai-eval-obrigatorio.sh` prova que apagar a exigência deixa a
asserção nominal vermelha.

## Data

2026-09-11

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-022-verify-v1.2.md`).
