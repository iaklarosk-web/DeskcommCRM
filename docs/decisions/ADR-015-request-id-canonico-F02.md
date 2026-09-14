# ADR-015 — Identificador da requisição na F02

## Contexto

Na rechecagem do suporte somente leitura, a resposta HTTP e a auditoria da
mesma recusa devolveram identificadores diferentes. O proxy gerava um ID na
resposta, mas não o encaminhava à rota; os handlers geravam outro para o
envelope e a auditoria. O teste que correlaciona essas duas evidências falhou
em `f02-browser-repairs-04`, embora as duas recusas tenham sido persistidas.

## Decisão

O proxy resolve um UUID canônico, encaminha-o no header da requisição antes de
criar `NextResponse.next` e mantém o header de resposta já oferecido pelo
contrato herdado. Um helper compartilhado aceita UUID em formato canônico ou
gera um novo quando ausente/inválido. O valor é correlação, nunca autorização.

Os handlers do inventário F02 usam esse ID para seus envelopes e registros de
auditoria. Chamadas diretas de teste sem requisição continuam gerando UUID.
IDs de entidades, comandos e chaves de idempotência permanecem conceitos
independentes. A auditoria de recusas assíncronas é aguardada nos testes, com
ator, organização, recurso, sessão de suporte e identificador da requisição.

## Alternativas rejeitadas

Retirar a correlação do teste esconderia o defeito. Remover o header do proxy
para toda a API alteraria rotas legadas sem envelope próprio. Uma lista de
exceções por URL no proxy duplicaria o inventário de handlers. Reescrever toda
a API herdada ampliaria esta correção além da fase ativa.

## Consequências

A F02 conserva o header gerado ou ecoado e torna comprovável sua ligação com
a auditoria. Headers inválidos são substituídos por UUID; seu conteúdo não é
usado como identidade ou permissão. Um teste de encaminhamento e um mutante
que remove esse encaminhamento complementam a prova real do navegador.

A API fora do inventário F02 mantém seu comportamento de resposta e ainda
precisa adotar o helper onde gere identificadores locais independentes.
Essa migração restante integra a observabilidade da F06. Não se altera
migration aplicada, ambiente de produção, dado de cliente ou provedor real.
D47/D48 continuam vigentes: concluir F02 e pausar antes da próxima fase.

## Data

2026-09-09, America/Sao_Paulo (10/09 em UTC).

## Commit

Implementação: `5f3df2cf064e9c441d228ce3a956201e5403d692`. Decisão registrada antes da implementação. Unit focal34/34 e E2E integrado13/13 comprovaram a correlação; mutante30 (identificador, não denominador) foi detectado. O gate06 aprovou27/27 scripts mutantes, mas encerrou NOT READY com E2E12/13; o checkpoint `03ec6a3b56826ab882782efb1dd5185f47e52a8c` sincronizou a lista do viewer e passou A/B2/2. O gate integral07 desse checkpoint terminou com exit 0, E2E13/13, mutantes27/27, zero violações e `STATUS: READY (F02)`, conforme `.verify-logs/f02-final-07/orchestration.log:1-33` e a [evidência versionada T13](../migration/evidence/construction-f02-t13-20260909.txt). F02 está concluída no escopo técnico e pausa por D47; F03 não foi iniciada. Os limites de ambiente real descritos acima permanecem e não bloqueiam este fechamento por D48.
