# ADR-011 — Construção autorizada por fases e medição de consumo

Status: autorizado pelo proprietário em 09/09/2026; execução iniciada em F02.

## Contexto

A integração da v1.17.0 está publicada no PR #1 do fork e seu CI passou. O proprietário autorizou construir por fases, preferindo modelos mais fortes no planejamento e modelos mais econômicos na execução, com escolha de modelo e esforço dos subagentes pelo agente principal. Pediu também o custo observado da construção, embora utilize assinatura.

## Decisão

1. D45 amplia a autorização de D42: implementar a sequência aprovada, começando pela F02. Os aceites técnicos e dependências comerciais continuam valendo. Uma task terminada não fecha a fase; uma fase técnica não equivale ao SaaS comercial completo.
2. Planejamento e revisão de contratos, isolamento, cobrança, automações e recuperação usam Astra/Sol com esforço alto. Execuções delimitadas usam Terra Medium ou Sol Medium; elevar a Sol High quando o risco ou um defeito exigir. Não repetir inventários completos em cada subagente. O modelo principal desta tarefa não é trocado automaticamente; o roteamento ocorre nas delegações disponíveis.
3. Cada delegação recebe escopo, arquivos, critério de aceite e limites. Trabalho independente pode ocorrer em paralelo; alterações de schema, aplicação de baseline e verificações pesadas são coordenadas. Escolher modelos não reduz a exigência dos testes.
4. A dívida nominal herdada é saneada antes de READY F02. Preservar evidências históricas. A F02 continua exigindo seu gate próprio, fluxo integrado, isolamento entre duas empresas e provas de repetição/revisão.
5. O proprietário confirmou em 09/09 que produto/unidade/quantidade/preço/entrega do pedido típico permanecem **pendentes com a Deka**. Seguir com exemplos fictícios e campos configuráveis. Não inferir conversão de caixas, preço PJ, frete, arredondamento nem a data que organiza os pedidos do dia. Aceite técnico com fixtures não valida essas regras na empresa real.
6. Medir a construção a partir de `2026-09-09T15:07:45.023Z`, identificando a tarefa principal e somente subagentes de vínculo comprovado. Registrar entrada, cache e saída por modelo/esforço conforme os contadores disponíveis. Deduplicar contadores e tratar resets; raciocínio já integra a saída.
7. O relatório distingue consumo observado, valor equivalente pela API e cobrança da assinatura. Sem fatura por tarefa, o equivalente pela API não pode ser chamado de gasto efetivamente cobrado. Modelos/tarifas desconhecidos, lacunas de telemetria e adicionais não observados devem aparecer como limitações, nunca como zero.

## Entrega e limites

Código fica na branch `codex/f02-crm-pedidos`, iniciada em `c2fba8d2`, no worktree de integração. O checkout original F01 permanece como referência. O planejamento e o relatório de consumo ficam no repositório CRM-OS. Custos de operação da IA dos clientes são separados do consumo dos agentes de construção.

Regras comerciais pendentes bloqueiam somente a implementação que depende delas e o respectivo aceite. Serviços reais, produção, contratação de infraestrutura e mensagens a terceiros continuam sujeitos à autorização aplicável; construir e testar localmente com dados fictícios está autorizado.

## Alternativas rejeitadas

Usar o modelo mais caro em todas as tarefas contrariaria a preferência de custo/qualidade. Trocar para modelos menores sem contratos e revisão tornaria a economia impossível de avaliar. Apresentar o equivalente de API como cobrança real da assinatura confundiria duas modalidades comerciais.

## Consequências

Cada fechamento registra o que foi implementado e comprovado, o próximo passo e o consumo coberto pela telemetria. Recursos indisponíveis ou limites de agentes podem restringir o roteamento; o relatório usa os modelos observados, sem alegar uma troca que não ocorreu.

## Data e commit

2026-09-09. Base da construção: `c2fba8d260432af43ca2f6b9a22295b39c1c9477`. O commit do ADR é identificado por `git log -1 -- docs/decisions/ADR-011-construcao-por-fases-e-consumo.md`.
