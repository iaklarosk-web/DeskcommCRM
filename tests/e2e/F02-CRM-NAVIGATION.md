# F02 — ficha do cliente, empresa do pedido e catálogo completo

`f02-crm-navigation.spec.ts` percorre a mesma jornada nas organizações fictícias
A e B. A ficha mostra pedidos, diferencia ausência de registros de falha de
leitura e permite iniciar um pedido para o contato aberto. A empresa vinculada
é uma sugestão que exige escolha explícita; o nome comercial e o canal declarado
são conferidos na resposta persistida e na tela do pedido. Nenhum canal é inferido
do telefone nem define a data operacional dos pedidos do dia.

O catálogo de teste contém mais de 500 produtos. A busca usa a API real e precisa
encontrar um produto que ficou fora do limite herdado, respeitando a organização
ativa. A jornada confere paginação e termos com asterisco, porcentagem, sublinhado,
aspas, barras e sintaxe parecida com um filtro: esses caracteres fazem parte do
nome procurado. Os resultados não podem ampliar o filtro nem alcançar B a partir
de A. A tela usa páginas de 50 registros e mantém a busca aplicada ao paginar.

Uma sessão viewer consulta ficha e catálogo, sem criar, editar ou importar.
Capturas do pedido, da ficha e da busca são anexadas ao relatório. As fixtures
são exclusivamente fictícias; as datas e unidades usadas não são decisões da
Deka. O caso de erro de leitura usa uma resposta 503 sintética; a recarga seguinte
consulta o servidor e o banco locais reais.

A execução requer o sandbox F02 exclusivo, o marcador
`F02_E2E_SANDBOX_ID=f02-crm-cadastros-disposable`, Supabase em `55421/55422` e
aplicação em `3102`. A fixture remove somente as duas organizações e os dois
usuários que criou e exige zero resíduos nas 12 tabelas de domínio. Auditoria
append-only permanece até o descarte do sandbox. Não há chamada de provedor real.

A spec está registrada na parte 3 do E2E. Resultados observados e limitações do
checkpoint ficam no BUILD-STATE e na evidência de construção, separados deste
roteiro; este arquivo por si só não declara a jornada aprovada.
