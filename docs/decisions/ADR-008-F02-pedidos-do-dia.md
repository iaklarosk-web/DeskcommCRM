# ADR-008 — F02 operacional e reaproveitamento da v1.17.0

Status: desenho autorizado em 08/09/2026; tasks adicionais propostas para sincronização à DIRETRIZ. Nenhuma implementação F02, alteração de schema ou regra comercial pendente é aprovada por inferência neste ADR.

## Contexto

O proprietário autorizou atualizar o desenho da F02 para pedidos do dia, sem construí-la agora, e confirmou WAHA para a Deka nesta etapa. O resultado final confirmado é SaaS online com painel do administrador da plataforma, acesso dos clientes após assinatura/pagamento e onboarding self-service completo, incluindo configuração guiada da IA e ajuda opcional. A primeira versão comercial abrange WhatsApp, chat do site e agenda integrada, além do e-mail transacional; Instagram/e-mail de entrada são posteriores. Autonomia da IA é por empresa/ação. A F02 sustenta esse caminho por configuração; ERP/adjacentes não entram por inferência.

A auditoria F00 partiu de `c85f7d72eebe33649812fe5cae174b7dd80e0e9f`. A release v1.17.0, `db58c3fb3ef7acbf6ae9d0eaec278cb968958c5d`, oferece evidência nova: `lib/ai/agents/no-ar.ts:33` desabilita resposta normal do worker legado; `lib/agent-engine/agent/preview.ts:130` aplica política de simulação às ferramentas; `lib/atendimento/fronteira.ts:2` identifica tenant/contato/conversa/demanda/revisões; `lib/agent-engine/agent/human-handoff.ts:118` implementa passagem humana com guardas. Isso justifica rever o destino REFAZER de IA/handoff, sem afirmar que a integração foi validada.

Contatos e catálogo já são usados pelos handlers (`app/api/v1/contacts/_handler.ts:1`, `app/api/v1/products/route.ts:31` no mesmo commit). O `orders` de `supabase/baseline.sql:1696` tem contrato de e-commerce. Trocar nomes físicos por conformidade textual pode romper vínculos e exige prova de compatibilidade, não só migration de rename.

## Decisão

1. **F02 entrega domínio operacional de pedidos:** lista por produto e entrega, impressão e conferência por item, além do CRM mínimo. Detalhe no [desenho F02](../design/F02-pedidos-do-dia.md).
2. **Preservar identidade do legado:** `contacts`, `catalog_products`, tarefas e histórico compatíveis são adaptados; os nomes lógicos `customers/products` não exigem renomear tabelas nem duplicar cadastros. Pedido/itens exigem estratégia de migração explícita com preservação de registros e referências.
3. **Adaptar um único motor:** rever IA/handoff para ADAPTAR, conservando ciclo de conversa/demanda, proveniência de trabalho, silêncio e revisão humana. Complementar D16–D19 e o catálogo de ações nesse caminho. Aprovar resposta sugerida não confirma pedido.
4. **Operação verificável:** lista e impressão derivam de pedidos e itens autorizados, com recorte/data explícitos; conferência se refere à revisão do pedido e perde validade quando essa revisão muda. Conferir separação não muda a venda.
5. **Separar prazo comercial de timeout:** `cutoff_hours` do lembrete significa ausência de resposta; fechamento de produção e janela de entrega recebem regra própria na F05, com dados confirmados. Data de criação não define data de entrega.
6. **Manter pendências explícitas:** unidades/caixas, preços PJ, arredondamento, datas, atrasos/alterações, entrega parcial, operadores, layout da notinha e áudio não são inferidos. A lista de pendências e o efeito em tasks vivem no desenho.
7. **Preservar IDs:** F02-T01…T09 permanecem; propor T10 lista do dia, T11 impressão, T12 conferência e T13 validação integrada. T09 atualiza a auditoria depois das entregas; detalhes e critérios na seção 7 do desenho. Nenhuma task é marcada como executada por este ADR.
8. **Canal desta etapa:** Deka usa WAHA; Meta Cloud não bloqueia o desenho/piloto nem é antecipada. Demais autorizações de serviços reais/produção seguem as decisões vigentes e as instruções do proprietário.

## Alternativas rejeitadas

- Refazer o motor de IA/handoff usando a avaliação da base antiga: a release tem guardas e supervisão que devem ser preservadas e adaptadas.
- Renomear `contacts/catalog_products` e criar nova máquina de conversa sem inventário de dependências: cria migração e risco sem entregar a lista operacional.
- Mostrar só CRUD ou um total sem pedidos participantes: não permite conferir o que a fábrica/separação precisa preparar.
- Fixar quinta-feira, próxima rota, caixa de 12, preço PJ ou regra de atraso sem resposta da Deka: transformaria ausência de dado em regra comercial falsa.
- Usar `cutoff_hours` do lembrete como fechamento da fábrica: espera por resposta e prazo de produção são decisões distintas.

## Consequências

- `target-state.md` passa a distinguir auditoria histórica, revisão estática da release e provas ainda necessárias da integração/F02.
- DIRETRIZ e critérios de aceite precisam refletir entidades lógicas sobre o schema herdado e as quatro tasks propostas; contar tabelas reais pelo catálogo substitui pressupor uma tabela nova por conceito.
- Alterações físicas, chamadas reais, numeração de migrations e comandos de verificação serão definidos/executados nas tasks autorizadas; migrations aplicadas e dados instalados são preservados.
- A F02 pode ser demonstrada com UI e fixtures de dois tenants; isso não valida provedor real, operação da Deka nem SaaS comercial completo.

## Data

2026-09-08.

## Commit

Arquivo criado durante a integração sobre nossa F01 `960a46907449fcd4a7e773e40016742c25c0a09d`, com referência upstream `db58c3fb3ef7acbf6ae9d0eaec278cb968958c5d`. O commit da entrega será o que adicionar este arquivo (`git log --format=%h -1 -- docs/decisions/ADR-008-F02-pedidos-do-dia.md`); nenhum hash de commit futuro é presumido.
