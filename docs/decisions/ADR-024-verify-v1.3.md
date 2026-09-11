# ADR-024 — verify.sh v1.3: campos `handoff` e `reminder`, gate de F05

Adendo a [ADR-005](ADR-005-verify-v1.md), [ADR-018](ADR-018-verify-v1.1.md) e
[ADR-022](ADR-022-verify-v1.2.md). D25 permite mudança no `verify.sh` só por
ADR; §8.3 exige acrescentar campos e nunca remover. F05-T10 nomeia esta versão.

## Contexto

Depois da ADR-022 o gate reconhece F00–F04 e mede `webhook` e `ai_eval`. §8.3
torna `handoff` e `reminder` obrigatórios a partir de F05, e §7.6 acrescenta a
tela de uso de IA (F05-T09) ao inventário de navegador.

A grafia de §8.3 para o campo de handoff é
`handoff: ai_msgs_after_handoff=… summary=… assignee=… notify=…` — quatro
campos. Falta ali o **denominador**: `ai_msgs_after_handoff=0` é verdade num
sistema que não produziu handoff nenhum, e "zero sem denominador não é
resultado" (G-03, D24).

## Decisão

1. **F05 entra na lista de fases com gate completo**, herdando todos os
   controles fechados das fases anteriores.
2. **`handoff` ganha um quinto campo, `handoffs`**, que é o denominador. §8.3
   diz que cada versão ACRESCENTA campos; acrescentar o denominador é o que
   torna os outros quatro legíveis. Contrato validado:
   `handoffs ≥ 3`, `ai_msgs_after_handoff = 0`, `summary = 7/7`,
   `assignee = handoffs` e `notify = handoffs`.
3. **`reminder` exige `runs=2 sent=1 duplicates=0`** — o job rodado duas vezes
   no mesmo período, uma mensagem só, duplicatas somadas nas tabelas tocadas
   (G-57).
4. Os dois são lidos de `.verify-logs/metrics/`, gravados pelas próprias suítes
   via `gravarLinhaDoVerify` (ADR-005). Em F00–F04 seguem `pending` sem
   reprovar, preservando as provas já fechadas.
5. **Inventário de F05** = o de F04 mais `f05-ai-usage.spec.ts`, com quatro
   testes (duas jornadas nas duas organizações fictícias). Nenhuma spec
   anterior sai do conjunto.

## Alternativas rejeitadas

- **Manter os quatro campos de §8.3 sem denominador.** `ai_msgs_after_handoff=0`
  passaria numa suíte sem handoff — exatamente o verde vazio que D24 proíbe.
  Acrescentar campo é permitido; deixar a prova ambígua, não.
- **Aceitar `assignee`/`notify` menores que `handoffs`.** Seriam handoffs sem
  responsável ou sem aviso, que é o defeito que F05-T03/T05 existem para
  impedir.
- **Medir `reminder` por uma execução só.** A idempotência do lembrete só é
  observável na SEGUNDA execução do mesmo período; `runs=1` não prova nada.

## Consequências

O gate de F05 custa o de F04 mais a suíte de handoff/lembrete e a spec nova.
F06 e F07 continuam sem campo próprio; `full_n0` segue `pending` até o E2E
integral do upstream. O mutante `48-f05-verify-handoff-obrigatorio.sh` prova
que apagar a exigência deixa a asserção nominal vermelha.

## Data

2026-09-11

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-024-verify-v1.3.md`).
