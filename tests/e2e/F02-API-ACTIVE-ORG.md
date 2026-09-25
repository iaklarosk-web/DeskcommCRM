# F02/T04 — matriz HTTP da organização ativa

`f02-api-active-org.spec.ts` contém duas jornadas de organização ativa:
32 células de operações comerciais e quatro dos leitores C06/C07. Cada operação
é exercitada com A ativa e com B ativa pelo mesmo manager membro das duas organizações.

## O que a prova faz

A jornada cria por API um contato, uma empresa, um produto e uma tarefa legada
em cada organização. Em cada sentido ela confirma que:

- o recurso próprio nasce na organização ativa e pode ser lido, alterado e
  removido quando a operação permite;
- listas de empresas e tarefas contêm o recurso próprio e não contêm o da outra
  organização;
- GET por id da outra organização responde 404;
- PATCH e DELETE contra ids da outra organização respondem 404 e não alteram a
  linha nem acrescentam auditoria;
- cada DELETE próprio remove a linha e acrescenta exatamente uma auditoria;
- `DELETE /api/v1/products/[id]`, a operação P04 antes sem prova HTTP focal,
  remove o produto próprio e recusa o id da outra organização nos dois sentidos;
- o conjunto observado é exatamente `16 × 2 = 32` células, sem célula implícita.

As operações são C02–C05, E01–E05, P02–P04 e L01–L04 do
[matriz de APIs](../../docs/migration/evidence/f02-t04-api-matrix.md). P01 e as jornadas de pedidos, notas e tarefas vinculadas já têm
prova A/B própria e não são repetidas aqui. A segunda jornada cobra 200 com formato
de resposta válido para timeline e crm-summary do contato próprio e 404 para o
contato da outra organização, nos dois sentidos (quatro células C06/C07).

## Efeitos e isolamento

A spec usa exclusivamente `seedF02Orders()` e o client protegido por
`f02E2eSandbox()`. O helper recusa URL que não seja loopback, exige
`F02_E2E_SANDBOX_ID=f02-crm-cadastros-disposable` e cria usuários e organizações
com sufixo aleatório. As chamadas HTTP alcançam apenas o serviço local e não
disparam WhatsApp, IA, cobrança ou fila externa.

O `finally` de `cleanupF02Orders()` remove as duas organizações descartáveis e
os dois usuários. A prova exige `domain_tables_checked=12` e
`domain_rows_remaining=0` para pedidos, itens, eventos, receipts, tarefas,
notas, eventos/receipts de tarefas, empresas, contatos, produtos e memberships.
`api_audit_log` permanece append-only por desenho; ao excluir a organização sua
FK preserva a auditoria com `organization_id = NULL`. Os ids aleatórios permitem
distinguir essas linhas de qualquer outra execução.

## CI e execução

A promoção inclui a spec em `SPECS_PARTE_3` de `.github/workflows/e2e.yml`, no
mesmo job descartável das jornadas F02. A primeira jornada executou as 32 células reais com sucesso no sandbox local.
A segunda jornada foi acrescentada depois e aguarda execução; os registros do
checkpoint distinguem as provas executadas das preparadas.

A prova de suporte fica em `f02-support-readonly-api.spec.ts`. Ela abre e encerra
um acompanhamento readonly pela interface real, sem membership no tenant B;
exige leitura e isolamento nos quatro grupos comerciais e recusa uma escrita
válida em cada grupo. Estado, recibo e auditoria precisam permanecer iguais,
e o cleanup mede 12 tabelas sem resíduos. Esta jornada aguarda navegador.
