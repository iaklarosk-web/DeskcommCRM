# F02 — notas e tarefas CRM em navegador

`f02-crm-work.spec.ts` executa duas jornadas independentes, uma para cada
organização fictícia A/B criada pela fixture de pedidos. O pedido vazio é uma
precondição criada pela API já coberta pela T02; toda a interação nova de
notas e tarefas acontece pela interface real.

Cada jornada registra uma nota ligada ao contato e ao pedido, repete o mesmo
UUID para provar idempotência e cria uma tarefa vinculada sem fabricar lead.
A tarefa é editada e passa por andamento, conclusão, cancelamento e reabertura,
com snapshots das revisões 1–6 no histórico. O roteiro também recusa revisão
antiga com 409 e, após trocar de organização, recusa leituras e comando com 404. A jornada A comprova ainda que PATCH/DELETE legados não alteram tarefa de
pedido, que a lista oferece **Gerenciar no pedido** sem edição ou exclusão e
que uma tarefa independente continua podendo ser criada, editada e excluída.

O viewer da organização A consulta a nota e o histórico sem controles de
escrita. Para esse papel, a tela não carrega a lista interna de integrantes;
quando o nome do autor não pode ser resolvido, exibe **Autor registrado**. O
identificador auditável continua presente na resposta da API. Esse fallback é
intencional e evita ampliar a leitura de dados da equipe.

O relatório Playwright anexa, para cada lado, uma captura de página inteira do
pedido preenchido com nota, tarefa e histórico e outra captura do perfil do
cliente na aba de notas. Os nomes, textos, e-mails e datas usados são
exclusivamente fictícios. As capturas não incluem DevTools nem credenciais de
autenticação.

A execução deve usar o sandbox local exclusivo: API Supabase em `55421`, banco
em `55422` e aplicação em `3102`. O runner injeta as credenciais desse ambiente
descartável e exige a guarda abaixo; o teste não lê `.env.local` e não chama
WhatsApp, IA, e-mail, cobrança ou qualquer provedor externo.

```bash
F02_E2E_SANDBOX_ID=f02-crm-cadastros-disposable \
  E2E_PORT=3102 \
  pnpm exec playwright test tests/e2e/f02-crm-work.spec.ts --workers=1
```

A fixture remove somente as duas organizações e os dois usuários cujos IDs
guardou. Depois da cascata, confere zero resíduos em doze tabelas do domínio:
pedidos, itens, eventos e recibos de pedido; tarefas, notas, eventos e recibos
de tarefa; empresas, contatos, produtos e vínculos de usuários. Auditoria
append-only não é apagada por esse cleanup. O relatório anexa
`domain_tables_checked: 12` e
`domain_rows_remaining: 0`; qualquer erro ou resíduo reprova a jornada. O
sandbox local e o runner de CI são descartados ao final da validação.

Esta especificação está registrada na parte 3 da matriz E2E. A preparação
estática não executa navegador, banco nem build; a prova real cabe ao runner
isolado com as portas acima.
