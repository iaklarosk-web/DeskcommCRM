# F02 — Pedidos do dia: desenho para implementação futura

Data: 08/09/2026. **Desenho autorizado; implementação da F02 não iniciada por esta alteração.** Este documento detalha o [ADR-008](../decisions/ADR-008-F02-pedidos-do-dia.md) e deve permanecer coerente com as decisões sincronizadas em `docs/DIRETRIZ.md`. Tasks novas estão propostas abaixo, sem marcar entrega ou criar migrations.

## 1. Resultado e limites

O operador registra/confirma pedidos e obtém uma lista confiável do que produzir/separar e do que cada entrega leva. A F02 entrega o fluxo pela UI, com dados fictícios; WhatsApp, interpretação por IA e lembrete são integrações das F03–F05. A Deka usará WAHA nesta etapa, conforme resposta de 08/09/2026; não antecipar API oficial.

O destino comercial confirmado pelo proprietário nesta sessão é SaaS online: painel/login do administrador da plataforma, acesso de clientes após assinatura/pagamento e onboarding self-service de cadastro, contratação, conexão WhatsApp e configuração guiada de IA, com ajuda opcional. A primeira versão comercial inclui WhatsApp, chat do site, agenda integrada e e-mail transacional; Instagram e e-mail de entrada ficam para depois. CRM completo vem antes de ERP/adjacentes. A autonomia da IA é configurável por empresa/ação. Esse destino não amplia a execução autorizada desta F02 nem antecipa canais no piloto.

Entram clientes/empresas, catálogo, pedidos/itens, histórico, tarefas, notas, lista por produto e por entrega, impressão e conferência da separação. Não decorrem desse escopo estoque completo, baixa de matéria-prima, emissão fiscal, cobrança de pedidos, cálculo de frete, otimização de rota ou aplicativo de entregador.

## 2. Reaproveitamento e identidade

| Conceito de negócio | Desenho sobre a v1.17.0 | O que deve ser preservado |
|---|---|---|
| Cliente | Fachada de cliente sobre `contacts`; ampliar dados faltantes de empresa/recorrência | ID, telefone canônico, consentimento, anonimização, merge e vínculos de conversa/lead |
| Produto | Fachada sobre `catalog_products`; mapear `codigo/nome/preco_cents/moeda` ao vocabulário do contrato/seed | ID, SKU, importação, busca da IA, preço e moeda como uma fonte; ampliar tamanho/embalagem/unidade necessária |
| Pedido | Domínio de pedido interno e itens, com migração compatível do `orders` herdado a definir em F02-T02 | Registros/IDs existentes, leitores, exportação/anonimização, histórico e referências externas |
| Tarefa/nota/histórico | Adaptar `crm_tasks` e relações de atividades/notas compatíveis; inventariar vínculos que hoje exigem lead | Não inventar lead para permitir nota/tarefa de pedido; não perder a timeline herdada nem duplicar o mesmo evento |
| Conversa/IA/handoff | Um motor em `lib/agent-engine/`; preservar ciclo da conversa/demanda, `ServiceBoundary` e guardas de handoff | Pedido não vira estado da conversa; aprovação de texto assistido não confirma pedido; revisão antiga não autoriza escrita |

`customers` e `products` são nomes lógicos, não ordem para renomear tabelas. Adaptadores explícitos são preferíveis a views de compatibilidade sem prova de permissões. A estratégia física final de `orders` exige inventário atualizado; a ausência histórica de escritor não prova ausência de dados num banco instalado. Não apagar dados nem reutilizar status externos com interpretação silenciosa.

Evidência estática fixada em `db58c3fb3ef7acbf6ae9d0eaec278cb968958c5d`: `app/api/v1/contacts/_handler.ts:1`, `app/api/v1/products/route.ts:31`, `supabase/baseline.sql:1696`, `lib/ai/agents/no-ar.ts:33`, `lib/agent-engine/agent/preview.ts:130`, `lib/atendimento/fronteira.ts:2` e `lib/agent-engine/agent/human-handoff.ts:118`. O [target-state](../migration/target-state.md) registra o mapa completo e os limites dessa evidência.

## 3. Contrato mínimo do pedido — proposta técnica

Os nomes abaixo descrevem responsabilidades; o mapeamento físico é decidido na implementação e documentado sem criar fontes duplicadas.

| Informação | Regra do desenho |
|---|---|
| Identidade | Pedido, contato, empresa, itens e vínculos pertencem ao mesmo `organization_id`; referência a ID de outra empresa é rejeitada também na escrita |
| Momento e origem | Distinguir criação, confirmação e data prevista de entrega; registrar ator/origem da escrita (`ui`, `ai`, `automation`) separadamente do canal que trouxe o pedido. Pedido digitado de uma ligação não vira WhatsApp só por usar o mesmo cadastro |
| Data/entrega | Data de entrega explícita no fuso da empresa, informada pelo humano na F02. Não derivar do dia em que foi digitado. Destinatário/endereço/referência/janela necessária são dados a confirmar, com snapshot do combinado no pedido; não calcular rota |
| Itens | Produto/SKU, descrição e embalagem/unidade vendida, quantidade, preço unitário e moeda registrados no pedido. Alterar catálogo depois não reescreve o valor ou a descrição de pedido confirmado |
| Quantidades e valores | Aritmética decimal exata para quantidades e dinheiro em centavos; preservar tipos inteiros monetários herdados. Não somar embalagens/unidades distintas nem converter caixa em unidades sem fator cadastrado e confirmado. Arredondamento de venda fracionada fica pendente até a regra comercial |
| Revisão | Pedido possui versão/revisão para detectar gravação concorrente; operação com revisão vencida pede recarga, não sobrescreve. Itens, total e evento de alteração são consistentes na mesma operação |
| Recorrência | `period_key` permite localizar o contexto recorrente; idempotência do lembrete não significa que só possa existir um pedido ou entrega por cliente na semana |
| Confirmação/conferência | Registrar ator, instante e revisão aprovada/conferida. Confirmar venda, conferir separação e entregar são atos distintos |

RLS deve cobrir tabelas novas e relações que a lista consulta; joins e escrita validam também vínculo de empresa. Índices devem acompanhar filtros de empresa/data/status e chaves de relação, com plano de consulta observado quando implementados. Lista, impressão e conferência usam o mesmo contrato autorizado; nenhuma recebe acesso privilegiado só por ser relatório. Caso uma view seja necessária, sua execução deve respeitar RLS e ter teste de acesso direto, conforme a [documentação Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).

## 4. Estados e exceções

Preservar D22/D34 para o pedido: `draft → confirmed → in_production → delivered`; cancelamento humano alcançável de `draft`, `confirmed` e `in_production`; `delivered` e `cancelled` terminais. A conferência não acrescenta estados à máquina de pedidos. A IA só cria/edita rascunho; a política de confirmação de D33 continua aplicável quando integrada na F04.

| Situação | Comportamento exigido ou pendência explícita |
|---|---|
| Rascunho, sem confirmação | Aparece como pendência; não é somado à lista de pedidos confirmados para separação |
| Confirmado/em produção com data de entrega | Integra o recorte operacional daquela entrega; total por produto deriva desses itens |
| Sem data/destinatário necessário | Aparece em pendências, com motivo; não desaparece nem recebe data/endereço presumido |
| Cancelado ou entregue | Fora da lista ativa de separação; permanece no histórico e nos filtros correspondentes |
| Pedido alterado após conferência/impressão | Nova revisão invalida a conferência anterior para a versão atual e sinaliza necessidade de reimpressão. O registro antigo permanece auditável; papel impresso não pode ser atualizado remotamente |
| Duas pessoas editam/conferem | A segunda operação com revisão vencida é rejeitada; leitura atual é oferecida antes de repetir |
| Item desconhecido, quantidade ambígua, caixa sem fator, preço PJ não definido | Não inventar item/preço/conversão; manter pendência para o operador |
| Depois do corte, mudança de pedido confirmado/em produção, entrega incompleta | Regra comercial ainda pendente. Mostrar exceção e exigir decisão humana; não prometer mesmo dia/próxima rota, desconto, taxa, substituição ou cancelamento automático |
| Falta produto ou há divergência física | Registrar item não conferido e observação; nunca marcar conferência completa por inferência. A política de liberar entrega parcial/sob exceção precisa da resposta da Deka |

**Corte da produção não é timeout do lembrete.** `orders.recurring_reminder.cutoff_hours` hoje mede quanto esperar sem resposta antes de criar tarefa. A F05 terá regra explícita para o fechamento de produção/entrega; isso depende de dia, fuso, janela e exceções informados. A F02 guarda a data combinada e permite operação manual, sem embutir regras de quinta/sexta nem prazos supostos.

## 5. Lista do dia, impressão e conferência

- **Recorte explícito:** empresa, data de entrega e situação operacional. O resumo por produto responde "quanto há nos pedidos desta entrega"; não afirma que a fabricação acontece nessa mesma data. Se produção e entrega tiverem dias diferentes, a entrevista define o recorte necessário antes de apresentar o resumo como programação da fábrica.
- **Por produto:** SKU, descrição/embalagem, unidade e quantidade total; somente itens compatíveis são agregados. A soma é rastreável aos pedidos participantes. Sem inferir litros de matéria-prima, estoque disponível ou capacidade de produção.
- **Por entrega/pedido:** destinatário, referência de entrega acordada, pedido, itens/quantidades, observações pertinentes e situação de conferência. Ordem pode ser por identificação explícita; não vender ordenação de tela como rota otimizada. Visibilidade de preço na via do entregador é decisão pendente.
- **Completude:** paginação da tela não limita a soma ou a impressão aos registros carregados. Lista vazia, erro de consulta e atualização concorrente têm estados distintos; falha não é exibida como zero pedidos.
- **Impressão:** mesma fonte/recorte da lista; cabeçalho com empresa, data de entrega, emissão e identificação/revisão dos pedidos. Reimprimir não confirma, entrega ou duplica pedido. A via é operacional, não documento fiscal. Sem imprimir automaticamente para equipamento ou pessoa real nesta fase.
- **Conferência:** registrar checagem por item da revisão atual, responsável e instante. Exibir pendente/parcial/conferido/desatualizado como projeção desses registros, sem segunda fonte manual de status. Correção/desmarcação fica auditável; repetição da mesma operação não duplica evento. Conferir não altera quantidade vendida, preço ou status comercial.

## 6. Pendências da entrevista e efeito no desenho

| ID | Falta confirmar | Impacto; não preencher por estimativa do agente |
|---|---|---|
| P-F02-01 | Lista rege dia da produção, entrega ou ambos? Quem usa cada via? O proprietário decidiu em 08/09/2026 manter essa definição pendente até confirmar com a Deka | Recorte, campos e nomes da tela/impressão; pendência consciente, sem default comercial presumido |
| P-F02-02 | Embalagens, unidade vendida, múltiplos, fração permitida e fator por caixa | Validação de item, parser e agrupamento; não usar conversão padrão |
| P-F02-03 | Preços PJ/balcão, condição por cliente, descontos, frete e arredondamento | Seleção de preço e total. Implementar só modalidades confirmadas; não inferir tabela comercial |
| P-F02-04 | Corte, janelas/dias por cliente/região, atrasos e alterações | Política F05; F02 não atribui automaticamente a próxima entrega |
| P-F02-05 | Quem confirma, quem confere e substituto; liberação com falta/parcial | Permissões operacionais, pendências e aceite visual |
| P-F02-06 | Formato da notinha atual e dados/preços necessários à fábrica/entregador | Impressão e compatibilidade com processo existente; não presumir integração fiscal |
| P-F02-07 | Proporção de áudio/foto e exemplos de pedido | Escopo da interpretação F03/F04; receber mídia não comprova transcrição correta |
| P-F02-08 | Pedidos antes do corte, erros e tempo do dono: baseline, meta, período e responsável | Instrumentação e D27; métricas de ausência de handoff não substituem resultado do pedido |

Pedidos e clientes de teste são fictícios. Respostas da entrevista viram configuração/contrato com origem identificada, e não texto hardcoded. Pendência que mudar o modelo é resolvida antes da task dependente; as restantes podem ser mantidas explícitas sem afirmar que o piloto está pronto.

## 7. Tasks e ordem propostas

T01–T09 mantêm identidade e finalidade originais; os ajustes de contrato abaixo devem ser sincronizados à DIRETRIZ. T10–T13 são acréscimos propostos estáveis, não execução já iniciada. Números de tabelas/asserções são derivados dos artefatos implementados e dos cenários aprovados, não de nomes lógicos como se toda entidade exigisse tabela nova.

| ID | Entrega futura | Dependências | Critério de saída futuro |
|---|---|---|---|
| F02-T01 | Inventário final de entidades, extensão de contato/empresa e catálogo/unidades, mapeamento dos nomes lógicos; migrations compatíveis quando construído | Integração/F01 revalidada; P-F02-02/03 no que afetar schema | IDs e leitores herdados preservados; grants/RLS e relações de empresa comprovados; unidade/preço têm fonte única |
| F02-T02 | Pedido/itens, data de entrega, origem/canal, snapshots, revisão e transições; plano de compatibilidade do `orders` legado | T01; P-F02-01/03 e exceções que mudem o contrato | Instalação limpa e atualização preservam registros; transições legais passam e ilegais são recusadas; concorrência não perde atualização |
| F02-T03 | Histórico, tarefas e notas vinculados a cliente/pedido | T01/T02 | Escrita autorizada produz evento único e rastreável; sem lead fictício e sem perda da timeline |
| F02-T04 | Contratos/API autorizados das entidades, sem duplicar handlers compatíveis | T01–T03 | Matriz de operações/papéis passa nos dois tenants; ID cruzado e escrita de suporte somente leitura recusados |
| F02-T05 | Telas de clientes/empresas e perfil com histórico | T04 | Cadastro/edição/busca/histórico preservam vínculos; estados vazio/erro distinguíveis |
| F02-T06 | Telas de catálogo e pedidos, confirmação humana e exceções | T04; P-F02-02/03/05 | Operador registra pedido completo, confere itens/total e muda estado legalmente; dado faltante vira pendência |
| F02-T07 | Seeds fictícios com produtos, clientes e cenários de pedidos; mapeamento para tabelas herdadas | T01–T03 | Duas execuções não duplicam registros; fixtures cobrem duas empresas e não incluem dados reais |
| F02-T08 | Configuração de dados comerciais confirmados/identidade e exibição de pendências | T04; respostas pertinentes da entrevista | Valor validado escrito é o lido; alteração de configuração não muda snapshot de pedido confirmado |
| F02-T10 | Consulta e tela da lista do dia por produto e entrega, com pendências e recorte explícito | T02/T04/T06/T07; P-F02-01 | Todos os itens elegíveis entram uma vez; totais batem com a fonte inclusive além da primeira página; cancelados/rascunhos não contaminam soma |
| F02-T11 | Via operacional para impressão e reimpressão da lista/pedido | T10; P-F02-06 | Conteúdo corresponde ao recorte/revisões da tela; quebras de página não perdem itens; imprimir não causa escrita comercial |
| F02-T12 | Conferência por item/revisão e invalidação por alteração | T02/T04/T06/T10; P-F02-05 | Completar/parcial/desmarcar/repetir/alterar/conferir com revisão antiga produzem resultados auditáveis e corretos; sem alterar venda |
| F02-T09 | Atualizar auditoria/matriz com implementação e commits reais | T01–T08/T10–T12 | Cada afirmação nova tem arquivo:linha/commit e prova; decisões pendentes continuam identificadas |
| F02-T13 | Validar jornada completa F02 e incorporar critérios ao verificador por ADR | Todas anteriores | Matriz da seção 8 passa nos dois tenants; controles obrigatórios passam; validação visual e serviços não executados ficam explícitos |

Ordem: T01 → T02 → T03 → T04; T05–T08 conforme dependências; T10 → T11/T12 → T09 → T13. Alterações no mesmo arquivo são seriadas. A automação F05 só entra depois de F03/F04; F02 não precisa enviar WhatsApp nem chamar modelo real para demonstrar pedidos e lista.

## 8. Matriz mínima de aceite a implementar

| Cenário | Resultado a demonstrar |
|---|---|
| Pedido manual com produtos de embalagens distintas | Quantidade/preço/total corretos; agrupamentos não misturam SKUs ou unidades |
| Mesmos produtos em vários pedidos e além da primeira página | Totais por produto iguais à soma de todos os itens elegíveis; cada pedido consta uma vez |
| Rascunho/cancelado/entregue/sem data | Classificação correta entre lista ativa, histórico e pendência; nenhuma omissão silenciosa |
| Catálogo alterado após confirmação | Snapshot do pedido anterior permanece; novo rascunho usa regra atual confirmada |
| Impressão/reimpressão | Mesmos itens/recorte/revisões, sem perda em páginas e sem confirmar/entregar por efeito colateral |
| Conferência parcial, completa, desfeita e repetida | Estado projetado confere com checagens da revisão; eventos únicos, ator/instante rastreáveis |
| Alteração após conferência e duas gravações concorrentes | Conferência antiga não valida nova versão; revisão vencida é recusada |
| ID de contato/produto/pedido de outro tenant; acesso direto à lista/impressão | Nenhuma leitura ou escrita cruzada; mesmo contrato de autorização em todos os caminhos |
| Ligação digitada, WhatsApp humano e futuro WhatsApp IA | Canal de origem e autor da escrita não se confundem nas métricas |
| Instalação limpa e atualização do legado | Registros, IDs, vínculos, LGPD, catálogo e invariantes de atendimento preservados |

A implementação definirá os comandos nos runners existentes e registrará as contagens observadas. Não foram escritos testes de produto nem declarados resultados nesta entrega documental. A validação com operador, os provedores reais e a operação Deka continuam sendo etapas próprias; lista impressa de fixture não comprova êxito do piloto.
