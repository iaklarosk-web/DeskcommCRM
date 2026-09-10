# ADR-012 — Identidade dos cadastros e domínio dos pedidos operacionais

Status: decisão técnica para F02-T01/T02, 09/09/2026.

## Contexto

O inventário da v1.17.0 integrada (`c2fba8d2`) encontrou contatos e catálogo usados por UI, importação, Inbox e ferramentas. `organizations` representa a empresa assinante, não a empresa de um cliente. `orders` representa pedidos externos: exige identificadores/provedor e possui estados de e-commerce; seus leitores incluem resumo CRM, MCP e exportação LGPD. Não há escritor manual nem tabela de itens operacionais. O proprietário autorizou construir e confirmou que o pedido típico e suas regras permanecem pendentes com a Deka.

## Decisão

- `contacts` continua sendo a identidade do cliente. Acrescentar vínculo opcional a `crm_companies` e indicador de recorrência. Empresa-cliente é distinta do tenant. Nenhuma cópia de contatos nem rename físico.
- `catalog_products` continua sendo a fonte do produto/SKU/preço/moeda. Acrescentar `sale_unit` opcional, sem atribuir unidade aos produtos legados. Unidade é identificador configurado; conversão, fracionamento e embalagem não são inferidos por seu nome. Preservar importação, estoque e busca existentes.
- Relações novas entre entidades de tenant usam chaves compostas com `organization_id` e índices correspondentes. Validar constraints na criação sempre que os dados permitirem. Campos opcionais novos não justificam deixar uma constraint não validada. Policies de empresas permitem leitura de membro e escrita de `agent+`; suporte somente leitura continua sem escrita.
- A policy herdada de contatos permite escrita a membros em geral. Três policies **restritivas** adicionais exigem `agent+` para INSERT/UPDATE/DELETE; uma policy permissiva nova seria combinada por OR e não fecharia esse acesso. A leitura e a proteção de suporte são preservadas.
- O cadastro administrativo de empresas usa busca por razão social e paginação limitada (`page`, `limit`, padrão 50, máximo 100), ordenada por razão social e ID. `has_more` sinaliza a necessidade de continuar/refinar; nenhum seletor presume que a primeira página contém todos os vínculos.
- `crm_orders` e `crm_order_items` são a fonte única dos pedidos operacionais; `orders` mantém o contrato e os registros externos. Quando ambas as fontes forem apresentadas na ficha do cliente, a origem deve ser explícita. Não converter estados externos para D22 automaticamente. Exportação/LGPD do novo domínio precisa ser incluída antes de sua exposição operacional.
- Pedido operacional registra fonte (`ui`, `ai`, `automation`), ator, revisão e data de entrega informada explicitamente, distinta da criação e confirmação. Data ausente fica pendente. O nome da lista não pode afirmar programação da produção enquanto P-F02-01 estiver aberta.
- Itens mantêm o texto solicitado e permitem dados ainda não resolvidos no rascunho. Confirmação exige produto, quantidade, unidade, preço e moeda resolvidos. Snapshots preservam a descrição, unidade e condição comercial combinada; catálogo posterior não reescreve o pedido. Valores monetários são centavos inteiros; quantidades usam decimal exato, com representação canônica na API. Resultado fracionário de centavo fica pendente de uma regra explícita, sem arredondamento silencioso.
- Escrita de pedido/itens/total/revisão/evento é atômica no serviço da T02. Revisão vencida é conflito; idempotência não pode repetir efeito. Estados e restrições de ator seguem D22/D34. Conferência é vinculada à revisão e não altera a venda.
- Histórico/tarefas reaproveitam contratos compatíveis sem criar lead fictício. Notas de memória de IA e notas de conversa não serão tratadas silenciosamente como notas humanas do pedido. A adaptação concreta e suas policies pertencem à F02-T03.

### Escrita atômica e histórico

As tabelas operacionais novas têm leitura autorizada e escrita pelo serviço único, dentro de `withTenant`; `authenticated` não recebe INSERT/UPDATE/DELETE direto que permita contornar total, revisão e estados. `withTenant` resolve a transação/escopo, não substitui a autorização do ator. A autorização é revalidada antes de executar ou devolver um replay.

O serviço reserva um recibo por tenant/operação/chave idempotente, confere o hash do comando e retorna o resultado persistido em replay exato. Reuso da chave com conteúdo diferente é conflito. Recibo é consultado antes de rejeitar revisão vencida, permitindo repetir uma resposta perdida após commit. Comando novo bloqueia o pedido por tenant/id, confere revisão e grava itens, total, revisão, evento e recibo na mesma transação. Nenhum request PostgREST separado é tratado como parte dessa atomicidade.

O evento canônico do pedido é um journal append-only, gravado pelo mesmo `TenantDb`, e a ficha do cliente agrega origens explicitamente. A inspeção mostrou que `crm_lead_activities` exige lead e herda sua visibilidade; torná-lo nullable exigiria alterar policies, emitter, relatórios e leitores. Preservar esse contrato evita expor atividades de negócios restritos ou perder eventos por falta de lead. A união autorizada reutiliza a apresentação compatível e mantém identidade/origem/cursor, sem copiar eventos entre tabelas. Notas humanas e vínculo de tarefa são definidos na T03.

### Privacidade, correção de cliente e concorrência

O contato do pedido fica fixo após a criação nesta primeira versão. Correção de cliente exige cancelar e recriar; editar campos comerciais não pode reassociar dados pessoais e histórico a outro contato. O campo de contato em um comando de edição só aceita o mesmo ID. Essa restrição técnica será revista se surgir necessidade comercial confirmada de transferência com proveniência dos dados.

O serviço usa o mesmo mutex de contato da anonimização existente, antes de bloquear o contato, reservar o recibo e bloquear o pedido. Reconferir o vínculo após obter o bloqueio evita aplicar um comando sobre uma associação que mudou durante a espera. Autoridade é reconferida antes de replay; o mutex não concede permissão.

A migration 9007 inclui pedidos na transação de anonimização de `contacts`, pelos caminhos humano e de worker. Um trigger privado remove textos pessoais de cabeçalho, itens, eventos e respostas de recibos; mantém IDs, revisões, autoria, quantidades e valores. É uma exceção estreita à imutabilidade do journal, sem conceder UPDATE nem uma RPC nova ao cliente ou ao serviço. Repetição do recibo anonimizado retorna 410; não devolve seu conteúdo anterior.

A exportação operacional usa uma consulta consistente por organização/contato, incluindo itens e conteúdo histórico do titular. Não aplica o limite silencioso de 500 linhas do contrato legado. Snapshots de outro contato são excluídos defensivamente. A resposta pessoal preservada nos recibos é exportada por projeção explícita dos campos do pedido e de seus itens, com data de gravação e checagem conjunta de organização, contato e pedido. Identidade do recibo, ator, hashes, chaves idempotentes e campos não previstos da resposta não entram no pacote. A tabela privada continua sem acesso direto pelo cliente. Falha na leitura impede declarar a exportação completa. A validação em banco cobre isolamento, repetição e rollback da redação.

## Alternativas rejeitadas

Renomear/duplicar contatos e catálogo rompería referências sem ganho operacional. Relaxar `orders` para pedidos manuais misturaria duas máquinas de estado e contratos de origem. Preencher todos os produtos com `un`, converter caixas ou estabelecer preço PJ inventaria regras ausentes. Uma união de fontes sem origem visível ocultaria diferenças de status e revisão.

## Consequências e prova

T01 é aditiva e preserva IDs e colunas existentes. Nova migration e apêndice idempotente no baseline seguem o manifesto; a prova precisa partir de registros anteriores e reaplicar a alteração. RLS/grants, relações entre empresas, papéis e suporte são testados em banco descartável. O número de tabelas é medido; não se presume uma tabela física por nome lógico.

T02/T03/T04 precisam coordenar transação, autorização e timeline antes de expor escrita. O parecer de inventário fica em `docs/design/F02-inventario-contratos.md`. Nenhuma task é encerrada por este ADR. Configurações e exemplos fictícios não substituem a entrevista ou o aceite real da Deka.

## Data e commit

2026-09-09. Base inspecionada: `c2fba8d260432af43ca2f6b9a22295b39c1c9477`. O commit deste ADR é identificável por `git log -1 -- docs/decisions/ADR-012-contratos-crm-operacional.md`; nenhum hash futuro é presumido.
