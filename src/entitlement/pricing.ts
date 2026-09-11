/**
 * Preço por modelo (§5.3) — FACHADA, não tabela (F04-T08, ADR-023 decisão 1).
 *
 * Este arquivo tinha tabela própria: `Record<string, {prompt_cents,
 * completion_cents}>` em cents por 1k tokens, com três modelos OpenAI. O motor
 * herdado tinha a dele (`lib/agent-engine/edge/llm/pricing.ts`), em USD por
 * milhão, com três modelos Claude — e era ela que cotava `llm_calls.cost_cents`,
 * de onde o orçamento lê (`lib/ai/budget/check.ts:131-141`).
 *
 * Duas tabelas não são redundância inofensiva: no instante em que a MESMA
 * chamada passa a ter duas linhas (`llm_calls` e `ai_usage_events`), duas
 * tabelas de preço são dois números para um fato só, e nenhuma prova consegue
 * dizer qual está certo. A ADR-021 decisão 3 manda escolher UMA; a escolhida é
 * a do motor, porque já é a que o orçamento lê e a que casa por PREFIXO (o
 * vendor sufixa o id com a data). As três linhas OpenAI que viviam aqui mudaram
 * para lá, convertidas de unidade, com o mesmo valor.
 *
 * O que NÃO mudou: o custo continua calculado LOCALMENTE, nunca lido do
 * provedor — estimativa não pode depender de quem cobra.
 */
import { costCents } from "@/lib/agent-engine/edge/llm/pricing";

const SEM_TOKENS = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
} as const;

/**
 * Cents de USD, FRACIONÁRIOS — a mesma grandeza de `llm_calls.cost_cents`
 * (`numeric`). O `Math.round` de antes fazia a projeção divergir da fonte em
 * até meio cent por chamada, sempre para baixo (100k+10k tokens de gpt-4o-mini
 * custam 2,1 cents e viravam 2); desde a migration 9018 a coluna
 * `ai_usage_events.estimated_cost_cents` é `numeric` e guarda o valor exato.
 *
 * Modelo sem preço devolve 0, e a diferença em relação ao `null` do motor é
 * deliberada: `llm_calls.cost_cents` pode ser nulo ("não sei quanto custou"),
 * mas §5.3 quer uma LINHA por uso de qualquer jeito e a coluna do livro-razão é
 * `not null`. Zero silencioso seria mentira; zero COM linha é dado auditável —
 * e o orçamento já somava `coalesce(cost_cents, 0)` sobre exatamente esse caso.
 */
export function estimatedCostCents(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  return (
    costCents(model, {
      ...SEM_TOKENS,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
    }) ?? 0
  );
}

/** `false` = o motor não conhece o preço deste modelo (custo estimado = 0). */
export function modeloTemPreco(model: string): boolean {
  return costCents(model, SEM_TOKENS) !== null;
}
