/**
 * Preço por modelo (§5.3): custo ESTIMADO calculado localmente, nunca lido do
 * provedor — a estimativa não pode depender de quem cobra. Valores em cents
 * de USD por 1k tokens. Tabela PROVISÓRIA como o ADR-002: os modelos reais da
 * Fase 1 fecham com D02/E5 (decisão do dono); modelo fora da tabela custa 0 e
 * conta — zero silencioso seria mentira, zero COM linha em ai_usage_events é
 * dado auditável que a Fase 2 corrige com a tabela cheia.
 */

interface PrecoPor1k {
  prompt_cents: number;
  completion_cents: number;
}

/** cents de USD por 1.000 tokens (fonte: tabela pública da OpenAI, 2026-09). */
const PRECOS: Record<string, PrecoPor1k> = {
  // ADR-002: embedding provisório da Fase 1 (1536 dims).
  "text-embedding-3-small": { prompt_cents: 0.002, completion_cents: 0 },
  "gpt-4o-mini": { prompt_cents: 0.015, completion_cents: 0.06 },
  "gpt-4o": { prompt_cents: 0.25, completion_cents: 1.0 },
};

export function estimatedCostCents(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const preco = PRECOS[model];
  if (!preco) return 0;
  const bruto =
    (promptTokens / 1000) * preco.prompt_cents +
    (completionTokens / 1000) * preco.completion_cents;
  return Math.round(bruto);
}

export function modeloTemPreco(model: string): boolean {
  return model in PRECOS;
}
