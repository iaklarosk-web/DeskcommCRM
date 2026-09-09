# F02 — pedidos operacionais em navegador

`f02-crm-orders.spec.ts` executa duas jornadas independentes, uma por empresa.
Cada jornada cria suas próprias duas organizações fictícias, um manager
membro de ambas, um viewer da organização A, empresas clientes, contatos e
produtos. Requer o sandbox exclusivo e as guardas descritas em
[F02-CRM-CADASTROS.md](F02-CRM-CADASTROS.md), com as migrations 9005–9009 (9009 é pré-requisito da 9008 pelo timestamp).

O teste dispara autenticação local, consultas e gravações de cadastros e
pedidos no banco descartável. Não chama WhatsApp, IA, e-mail externo ou
cobrança. O servidor deve usar o bundle recém-construído com o ambiente do
sandbox; um build anterior aos pedidos não serve como prova desse código.

```bash
pnpm e2e:build
pnpm exec playwright test tests/e2e/f02-crm-orders.spec.ts --workers=1
```

O roteiro cria um pedido de `2 cx` por R$12,50 cada, confirma, altera o preço
do catálogo e muda apenas a quantidade do pedido para `3 cx`. O total esperado
continua usando o preço combinado: R$37,50. Confere revisões, recusa alteração
com revisão antiga, inicia produção e registra entrega. Também cancela um
rascunho incompleto, verifica o replay da criação e consulta o histórico com
paginação. Depois troca de empresa e exige recusa de leitura/escrita cruzada;
na jornada A, um viewer consulta sem poder gravar.

A data `2026-09-10` é um valor fictício informado como entrega. Não define a
regra dos “pedidos do dia” da Deka. O teste não valida lista por produto,
impressão, conferência da separação, tarefas/notas, provedores reais ou aceite
do operador.

A fixture encerra removendo somente as organizações cujos IDs registrou e
seus usuários próprios. A cascata é necessária para o domínio com histórico e
chaves restritivas. O cleanup verifica ausência de registros em doze tabelas
do domínio e anexa suas contagens ao relatório do Playwright. Qualquer falha
de limpeza reprova a jornada; não há exclusão por prefixo/e-mail nem procura
por dados de terceiros. Resultados observados ficam no BUILD-STATE, sem
transformar este roteiro em declaração de aprovação.

O denominador do cleanup são essas doze tabelas de domínio, e não todo o
banco. Registros de auditoria seguem a retenção append-only do produto;
não se remove essa proteção para limpar uma fixture. O sandbox local é
descartado ao encerrar a validação, e o runner de CI é descartável. Uma sonda
local em transação confirmou a cascata no recorte então existente de oito
tabelas com `service_role`,
incluindo itens, recibos e eventos; o `ROLLBACK` deixou zero organizações da
sonda. A fixture compartilhada agora repete a verificação para esse recorte e
para tarefas, notas, eventos de tarefa e recibos de comando, totalizando doze
tabelas.
