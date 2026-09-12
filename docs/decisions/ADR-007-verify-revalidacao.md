# ADR-007 — verificação com resultados estruturados e revalidação explícita

## Contexto

Na integração de v1.17.0, a fase corrente é F02, mas a fundação concluída que precisa de revalidação é F01. O verificador anterior imprimia exclusões, skips e métricas ausentes sem reprovar; contava `.skip(` até em comentários e fixtures. As métricas ignoravam `VERIFY_LOG_DIR` e um mutante podia sobrescrever a evidência da execução saudável. Evidência anterior: `scripts/verify.sh:28–31,40,57–69 @ 960a4690` e `tests/lib/verify-metrics.ts:13 @ 960a4690`.

## Decisão

- `./scripts/verify.sh --revalidate F01` exige que F01 conste como concluída no BUILD-STATE. Reexecuta a bateria da fundação sem mudar a fase corrente. Seu resultado nunca declara F02 nem staging prontos.
- O modo normal exige ausência de violações e dívida para emitir READY. A revalidação pode informar `REVALIDATED WITH DEBT (F01)` apenas para identidades exatas de dívida herdada presentes em `c85f7d72`: o skip do rate limit em `webhooks-inbound`, e os dois `it.fails` de agenda em andamento e opt-out de acompanhamento pausado. A lista não é um orçamento intercambiável: qualquer nova identidade reprova. Falha real, erro de suíte, relatório ausente e teste não concluído sempre reprovam.
- Um reporter que estende o JSON do Vitest marca `options.fails`. Contagens vêm de resultados executados, incluindo skipped/pending/todo e falhas esperadas. `unit/db/integration` mostram sucessos funcionais/total; falhas esperadas ficam separadas e nunca viram sucesso funcional. `tests_skipped` passa a ser runtime; a contagem textual anterior continua visível como `skip_only_occurrences`, sem confundir comentário e execução. `--allowOnly=false` impede execução seletiva acidental.
- O N0 integral permanece impresso. Na F01, que ainda não executa E2E, a comparação usa exclusivamente os componentes unit e db declarados no mesmo `baseline_detail`. A comparação do N0 completo continua pendente com o E2E; não se soma um resultado antigo a uma corrida nova.
- Todas as métricas obrigatórias da fase precisam existir, ser numéricas e cumprir seus limites; exclusão de testes, marca do tenant em `src`, segredos, mutante vivo, relatório inconsistente e redução do baseline comparável reprovam. Cada execução cria um diretório novo sob `VERIFY_LOG_DIR`; os mutantes recebem subdiretórios separados.
- A suíte do próprio gate usa dados e processos locais, sem banco ou serviços. Um mutante remove a recusa de métrica ausente e precisa provocar a falha da asserção correspondente, não apenas qualquer erro de execução.

## Adendo de 09/09/2026

Adendo de 09/09/2026 (F02, D45/ADR-011): a allowlist vigente passa a vazia com o saneamento das três dívidas nominais. Provas focais e mutantes exigem que elas não reapareçam, inclusive em revalidação. A confirmação pela bateria completa pertence ao fechamento no BUILD-STATE; a evidência de 08/09 continua histórica e não é reescrita. Este adendo não abre o gate F02 nem reduz seus requisitos.

## Alternativas rejeitadas

- Trocar `current_phase` para F01: faria o documento de estado mentir sobre o trabalho corrente.
- Declarar READY apesar de dívida herdada: confundiria ausência de regressão com conclusão do DoD.
- Contar só o rodapé ou permitir uma quantidade genérica de skips: esconderia mudanças de identidade e falhas de infraestrutura.
- Somar os 259 E2E antigos ao resultado novo: misturaria árvores e execuções diferentes.

## Consequências

Revalidação com dívida é evidência limitada de compatibilidade da fundação, não aceite do piloto. A dívida continua nomeada no relatório JSON e no resumo; o modo normal segue sem READY enquanto ela existir. F02+ exige evolução própria do verificador antes de declarar uma fase pronta. Esta decisão corrige a definição operacional de `tests_skipped`; a redação da DIRETRIZ deve distinguir resultado runtime de ocorrências textuais.

Uma repetição de etapa isolada não apaga a tentativa que falhou. Na integração, `test:shell` detectou que a fixture legada de seleção do provedor herdava `AI_PROVIDER=mock` do verificador: o ambiente substituía a condição que o teste pretendia medir. O bloco `provedor_ok` é idêntico em `960a4690` e `db58c3fb`; a correção remove apenas essa variável da chamada da fixture, mantendo as asserções e todos os serviços dublados. O alvo `AI_PROVIDER=mock WHATSAPP_MODE=mock bash hostgator-setup-kit/test-validators.sh` foi repetido antes da bateria shell completa.

Para recompor uma evidência após corrigir exclusivamente essa fixture: (1) esperar a corrida principal terminar; (2) preservar `shell.log` e `shell.exit` como `shell.initial-failed.log` e `shell.initial-failed.exit`, e preservar `summary.json`/resumo inicial se já emitidos; (3) registrar comando, horários, arquivos alterados e caminho do log da nova execução de `AI_PROVIDER=mock WHATSAPP_MODE=mock pnpm test:shell`; (4) copiar seu log e seu exit **observados** para os nomes consumidos pelo agregador; (5) executar `node scripts/verify/report.mjs report "$PWD" "$DIRETORIO_DA_CORRIDA" F01` e guardar o resumo reavaliado. Isso é uma composição de execuções documentadas, nunca uma declaração de que a primeira corrida inteira passou. Só etapas demonstravelmente não afetadas pela mudança podem ser conservadas; alteração em aplicação/schema exige repetir suas provas afetadas.

A primeira execução unitária também reportou `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending`, atribuída à fixture `desfecho-de-agenda-e-sobre-o-passado`: seus quatro testes passaram, mas duas auditorias reais terminaram com `fetch failed` após os testes. Em `db58c3fb`, o handler passou a disparar `void audit` nos caminhos de desfecho e alteração sem transição; a fixture upstream foi adaptada ao RPC de revisão, mas não isolou esse novo efeito externo. A correção simula a auditoria com promessa resolvida e verifica que não é chamada nas duas recusas, além de exigir ação, ator, organização, recurso, request e revisão nos dois sucessos. Não altera a aplicação nem ignora erros do Vitest: a tentativa original permanece reprovada.

Essa correção foi gravada às `2026-09-08T22:19:50Z`; o nome do arquivo ainda não constava no log de `.verify-logs/rerun-unit.aonGONZi` imediatamente antes e depois da edição. A prova independente `AI_PROVIDER=mock WHATSAPP_MODE=mock CI=1 pnpm exec vitest run tests/unit/desfecho-de-agenda-e-sobre-o-passado.test.ts --maxWorkers=1 --allowOnly=false --reporter=default --reporter=./scripts/verify/reporter.mjs --outputFile="$DIRETORIO_DO_ALVO/unit.json"` passou 4/4 com exit 0, sem erro não tratado, em `.verify-logs/audit-fixture.yFiKvtmh`. O lint do alvo terminou com exit 0 e uma advertência preexistente de `consistent-type-imports` na linha 46. A evidência unitária final deve usar o relatório e o exit reais da repetição completa, preservando `unit.initial-failed.log`, `.json` e `.exit`; os quatro testes do alvo não substituem nem são somados aos resultados da suíte completa.

## Data

2026-09-08.

## Commit

Commit da integração que adicionar este ADR; base inspecionada `960a4690`, release integrada `db58c3fb` (v1.17.0).
