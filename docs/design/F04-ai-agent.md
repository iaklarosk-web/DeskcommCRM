# Desenho F04 — AI Agent + Knowledge/RAG + Action Policy + tools da Fase 1

Autoridade: `docs/DIRETRIZ.md` §5.8–§5.10, §7.5 e D17/D18/D19/D33/D34.
Decisões estruturais em [ADR-021](../decisions/ADR-021-agente-saas-sobre-o-motor-herdado.md).

## 0. O que já existe (medido no checkpoint da F03)

| Fato | Evidência |
|---|---|
| O motor ATIVO é `agent-engine`; o worker legado não responde | `lib/ai/agents/no-ar.ts:33-36` (sempre `false`), lido em `workers/ai-response-worker.ts:161` |
| Entrada de turno | `lib/agent-engine/agent/inbound-turn.ts:3765` (`createInboundTurnHandler`) → `runAgentTurn` (`:1297`) |
| Chamada ao provedor num só lugar | `lib/agent-engine/edge/llm/run-model-call.ts:311` |
| Credencial por organização (BYOK) com fallback de plataforma | `lib/agent-engine/edge/llm/credentials.ts:246-351` |
| Registro mock do provedor, sem rede | `lib/agent-engine/edge/llm/providers.ts:126-146` |
| 12 tools nativas, vocabulário de lead | `lib/agent-engine/agent/inbound-turn.ts:180-372` |
| 57 tools MCP catalogadas | `lib/mcp/tools/index.ts:90-156` |
| Política de risco só existe no modo preview | `lib/agent-engine/agent/preview.ts:131-228` |
| RAG com 1536 dimensões e busca por org + lista de fontes | `lib/ai/embeddings/chave.ts:58-59`; RPC em `supabase/baseline.sql:16619-16671` |
| `ai_knowledge_sources.agent_id` é `NOT NULL` (acervo por agente) | `supabase/baseline.sql:941` |
| Consumo gravado em `llm_calls` dentro da chamada | `lib/agent-engine/edge/llm/run-model-call.ts:478-502` |
| `ai_usage_events` existe e **não tem chamador de produção** | `src/entitlement/entitlement.ts:59-109`; só `tests/unit/entitlement.test.ts` |
| Duas tabelas de preço independentes | `lib/agent-engine/edge/llm/pricing.ts` e `src/entitlement/pricing.ts` |
| Handoff com `force_human`, silêncio infinito e item de inbox | `lib/agent-engine/agent/human-handoff.ts:118-150` |
| Não existe limiar de confiança no turno | saída é tool-call + texto, não JSON com `confidence` |
| Não existe `docs/ai-eval/`, nem `pnpm ai:eval` | glob vazio |

## 1. A escolha central: reusar o provedor, não a orquestração

O motor herdado orquestra um turno de **lead** (funil, checkpoint, promessas,
pacing). A Fase 1 precisa de um turno de **atendimento com pedido**, cujas nove
tools de D18 são de cliente, produto e pedido. Enxertar as nove no
`runAgentTurn` misturaria dois vocabulários num arquivo de 3,7 mil linhas; e
criar um motor inteiro do zero jogaria fora credencial por organização,
guardrails de envio, silêncio e mock de provedor já provados.

O recorte é: **`src/ai/` reusa a camada de PROVEDOR do herdado e escreve a sua
própria orquestração de turno.** Reusa `resolveOrgLlmConfig`, o registro de
provedores, o registro mock e `runModelCall`. Não reusa `runAgentTurn`,
`AGENT_TOOL_DEFS` nem o catálogo MCP.

## 2. Action Policy — um catálogo, um `execute()`

`src/actions/catalog.ts` nasceu na F03 com `send_message`. A F04 o completa em
**dez** entradas: as nove de D18 mais `resume_ai` (D34). `toolsFor(ctx, "ai")`
devolve exatamente nove — `resume_ai` é humana.

| name | risk | executors | confirmation |
|---|---|---|---|
| `get_customer` | low | human, ai, automation | none |
| `search_products` | low | human, ai, automation | none |
| `get_orders` | low | human, ai, automation | none |
| `create_order` | medium | human, ai | by_risk |
| `update_order_quantity` | medium | human, ai | by_risk |
| `create_task` | low | human, ai, automation | none |
| `transfer_to_human` | low | human, ai | none |
| `request_confirmation` | low | human, ai | none |
| `send_message` | medium | human, ai, automation | none |
| `resume_ai` | low | human | none |

`execute()` é o único caminho de efeito do agente. As 12 tools nativas e as 57
MCP do motor herdado **continuam fora** deste catálogo e fora do turno SaaS: são
a superfície do agente de lead, e a ADR-021 registra por que absorvê-las é
trabalho de F13/F15, não de F04.

Confirmação `by_risk` (D33): ação com `risk ≥ tenant_settings.actions.confirm_from_risk`
(default `medium`) pedida pela IA vira pendência e a conversa vai para
`waiting_confirmation` pelo evento D16 `ai.confirmation_requested` — a mesma
`transition()` da F03, sem máquina nova. Timeout vira `confirmation.timeout`.

## 3. Consumo: uma chamada, um registro, um preço

O risco medido é dupla contagem: `runModelCall` grava `llm_calls`, e ligar
`withEntitlement` por fora gravaria `ai_usage_events` para a MESMA chamada, com
uma segunda tabela de preço — e o orçamento (`ai_budgets`) continuaria lendo só
`llm_calls`, cego ao resto.

A F04 fecha assim: **`runModelCall` continua o único lugar que fala com o
provedor e passa a gravar os dois registros na mesma transação, a partir dos
mesmos números e da mesma fonte de preço.** `ai_usage_events` deixa de ser uma
segunda contabilidade e passa a ser a projeção multi-tenant de `llm_calls`.
`src/entitlement/pricing.ts` deixa de ter tabela própria e passa a ler a do
motor. Prova: para N chamadas ao provedor mock,
`llm_calls = N`, `ai_usage_events = N`, e o custo das duas linhas confere.

A guarda de saldo continua sendo `withEntitlement`: com o dublê `allowed=false`,
`runModelCall` não é alcançado e a conversa vai para `waiting_human`
(`provider_calls_at_zero_balance=0`).

## 4. Knowledge/RAG por organização

O RAG herdado é por AGENTE: `ai_knowledge_sources.agent_id NOT NULL` e busca
por lista explícita de `source_ids`. §5.10 quer acervo da ORGANIZAÇÃO.
A migration da F04 torna `agent_id` anulável (`null` = acervo do tenant) e a
busca do turno SaaS passa a aceitar "todas as fontes ativas da organização"
além da lista por agente. O filtro de `organization_id` da RPC não muda — ele
já é a garantia de isolamento e tem prova comportamental.

Dimensão 1536 e `text-embedding-3-small` ficam (ADR-002). Embedding mock é
determinístico: mesmo texto, mesmo vetor, sem rede.

## 5. Guardrails e handoff

Reusa os gates de `before-send` herdados. Acrescenta o que não existe:
resposta fora da base usa `tenant_settings.ai.unknown_answer` e, na segunda vez,
`handoff.requested` (D19); injeção de prompt não produz dado do tenant nem ação
fora do catálogo; limiar de confiança passa a existir porque o turno SaaS
devolve JSON estruturado com `confidence`, ao contrário do turno herdado.

Handoff reusa `performHumanHandoff` (silêncio, `force_human`, item de inbox) e
acrescenta motivo enum e o resumo de sete campos de D19.

## 6. `pnpm ai:eval` e os 30 casos

`docs/ai-eval/cases.yaml` nasce aqui: 6 desconhecido, 10 injeção, 5
cross-tenant (fato plantado no seed do demo2 e perguntado do deka), 6 normais,
3 handoff. O script roda com `AI_PROVIDER=mock`, compara `expected` com o
BANCO (G-35: nunca com a coerência do texto) e imprime a linha `ai_eval:` do
VERIFY SUMMARY.

## 7. Limites declarados

`AI_PROVIDER=openai` real é item humano com orçamento (D12): a fase fecha com
mock e `NOT VALIDATED (real)`. O motor de lead herdado, suas 12 tools e as 57
MCP não são absorvidos aqui. Nenhuma mensagem sai para pessoa real.
