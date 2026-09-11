# ADR-021 — Agente SaaS sobre a camada de provedor herdada, com um só registro de consumo

## Contexto

§7.5 pede um agente que responda só com o contexto do tenant e aja por um
catálogo único de dez ações (D17/D18), com avaliação de 30 casos. O herdado tem
um motor ATIVO e provado, mas de outro domínio:

- `runAgentTurn` (`lib/agent-engine/agent/inbound-turn.ts:1297`) orquestra um
  turno de LEAD: funil, checkpoint durável, tabela de promessas, pacing.
- A superfície de ferramentas é de lead: 12 nativas
  (`inbound-turn.ts:180-372`) e 57 MCP (`lib/mcp/tools/index.ts:90-156`).
  Nenhuma é de cliente, produto ou pedido.
- Política de risco/confirmação **não existe em produção**: o que se parece com
  ela (`applyPreviewPolicy`, `lib/agent-engine/agent/preview.ts:131-228`) só
  roda no modo preview.
- O consumo é gravado em `llm_calls` dentro de `runModelCall`
  (`lib/agent-engine/edge/llm/run-model-call.ts:478-502`), e o orçamento
  (`ai_budgets`) lê dali.
- A F01 criou `ai_usage_events` e `withEntitlement`
  (`src/entitlement/entitlement.ts:59-109`) — e nenhum caminho de produção os
  chama. São duas contabilidades e duas tabelas de preço independentes.
- O acervo é por AGENTE: `ai_knowledge_sources.agent_id NOT NULL`
  (`supabase/baseline.sql:941`), enquanto §5.10 quer acervo da organização.

## Decisão

1. **Reusar o provedor, escrever a orquestração.** `src/ai/` usa
   `resolveOrgLlmConfig`, o registro de provedores, o registro mock e
   `runModelCall`. Não usa `runAgentTurn`, `AGENT_TOOL_DEFS` nem o catálogo MCP.
2. **Um catálogo para o turno SaaS.** `src/actions/catalog.ts` chega a dez
   entradas (nove de D18 + `resume_ai`); `execute()` é o único caminho de efeito
   do agente SaaS. As 12 nativas e as 57 MCP continuam sendo a superfície do
   agente de lead e ficam fora do turno SaaS.
3. **Um registro de consumo.** `runModelCall` continua o único lugar que fala
   com o provedor e passa a gravar `llm_calls` **e** `ai_usage_events` na mesma
   transação, dos mesmos números e da mesma fonte de preço.
   `src/entitlement/pricing.ts` deixa de ter tabela própria. `ai_usage_events`
   é projeção multi-tenant de `llm_calls`, não uma segunda cobrança.
4. **Acervo do tenant.** `ai_knowledge_sources.agent_id` passa a aceitar nulo
   (nulo = acervo da organização) e a busca do turno SaaS aceita "todas as
   fontes ativas da organização". O filtro de `organization_id` da RPC não muda.
5. **Confirmação por risco usa a máquina da F03.** `ai.confirmation_requested`,
   `confirmation.approved/rejected/timeout` são eventos D16 já na tabela: a
   F04 lhes dá executor, não uma segunda máquina.

## Alternativas rejeitadas

- **Enxertar as nove tools de D18 no `runAgentTurn`.** Misturaria dois
  vocabulários num arquivo de 3,7 mil linhas e faria a política de pedido
  herdar pacing, promessas e funil de lead, que não a governam.
- **Escrever um motor do zero.** Jogaria fora credencial por organização com
  BYOK, allowlist de egress, guardrails de envio, silêncio e o registro mock —
  tudo provado por 56 arquivos de teste.
- **Ligar `withEntitlement` por fora de `runModelCall`.** Contaria a MESMA
  chamada duas vezes, em duas tabelas, com duas fórmulas de preço, e deixaria o
  orçamento cego ao segundo registro. É o defeito que o target-state nomeia:
  "sem registrar duas cobranças ou divergir sobre uma mesma chamada".
- **Absorver as 57 tools MCP no catálogo agora.** F04-T01 mede
  `catalog_total=10`; absorver 69 entradas quebraria a prova e trocaria uma
  superfície provada por outra sem prova. É trabalho de F13/F15.
- **Tornar o acervo do tenant apagando `agent_id`.** A coluna tem leitores;
  torná-la anulável preserva o acervo por agente que já existe e acrescenta o
  do tenant.

## Consequências

Passam a existir, declaradamente, dois turnos de IA: o de lead (herdado, ativo)
e o de atendimento com pedido (SaaS, novo). Unificá-los é trabalho de F13/F15,
com inventário de leitores. Até lá, `elegivelParaWorkerLegado` continua `false`
e nenhuma conversa recebe duas respostas — isso precisa de prova própria na
F04, não de confiança.

`AI_PROVIDER=openai` real continua item humano com orçamento (D12): a fase
fecha com mock e `NOT VALIDATED (real)`.

## Data

2026-09-11

## Commit

O commit que adiciona este arquivo
(`git log --format=%h -1 -- docs/decisions/ADR-021-agente-saas-sobre-o-motor-herdado.md`).
