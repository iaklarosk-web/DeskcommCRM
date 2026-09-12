/**
 * Tabela de preços versionada (stack.md §2: usage × pricing.ts → llm_calls.cost_cents).
 * ÚNICO lugar com preço de modelo no repo — e desde a F04-T08 isso deixou de ser
 * só uma frase. `src/entitlement/pricing.ts` tinha uma SEGUNDA tabela, com outra
 * unidade (cents por 1k) e outros modelos: a mesma chamada podia ser cotada por
 * duas fórmulas, e o orçamento lia só uma. Aquele arquivo agora é FACHADA desta
 * tabela (ADR-023).
 *
 * Fonte Claude: https://docs.claude.com/en/docs/about-claude/pricing (conferida
 * 2026-07); cache write cotado no TTL 1h (2× input) — o TTL adotado pela doutrina
 * de caching (CLAUDE.md regra 15); cache read = 0.1× input.
 *
 * Modelo fora da tabela → custo NULL (desconhecido): mais honesto que inventar 0 —
 * o budget soma coalesce(cost_cents, 0), então modelo sem preço não consome teto;
 * quem habilitar um modelo novo para uma org adiciona a linha de preço aqui.
 */

interface PrecoDoModelo {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite1h: number;
}

/**
 * Embedding da Fase 1 (ADR-002, 1536 dims). DUAS chaves porque o repo usa os dois
 * ids: `lib/ai/embeddings/chave.ts:58` fixa `openai/text-embedding-3-small` (com o
 * prefixo do gateway) e `recordUsage` recebe o id nu do provedor. Um preço, duas
 * chaves — nunca dois números.
 */
const EMBEDDING_3_SMALL: PrecoDoModelo = {
  input: 0.02,
  output: 0,
  cacheRead: 0.02,
  cacheWrite1h: 0.02,
};

/**
 * USD por MILHÃO de tokens; match pelo MAIOR prefixo do id (cobre sufixo de data
 * do vendor).
 *
 * As linhas OpenAI vieram de `src/entitlement/pricing.ts`, convertidas da unidade
 * de lá (cents por 1k) para esta (USD por 1M) — é a MESMA cotação: 0,015 cents/1k
 * = 0,15 USD/Mtok. A OpenAI não cobra a escrita de cache e desconta a leitura, mas
 * a Fase 1 NÃO modela tarifa de cache para ela: `cacheRead` e `cacheWrite1h`
 * repetem `input`, o que mantém o custo igual ao de uma chamada sem cache em vez
 * de inventar um desconto que ninguém mediu.
 */
const USD_PER_MTOK: Record<string, PrecoDoModelo> = {
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite1h: 6 },
  'claude-haiku-4': { input: 1, output: 5, cacheRead: 0.1, cacheWrite1h: 2 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite1h: 30 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.15, cacheWrite1h: 0.15 },
  'gpt-4o': { input: 2.5, output: 10, cacheRead: 2.5, cacheWrite1h: 2.5 },
  'openai/text-embedding-3-small': EMBEDDING_3_SMALL,
  'text-embedding-3-small': EMBEDDING_3_SMALL,
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Custo em CENTS (fracionário; coluna numeric) ou null se o modelo não tem preço
 * conhecido. `inputTokens` aqui é o TOTAL do usage do SDK — a parcela cacheada é
 * descontada e cobrada pela tarifa de cache.
 */
export function costCents(model: string, usage: TokenUsage): number | null {
  // MAIOR prefixo, não o primeiro: com `gpt-4o` e `gpt-4o-mini` na mesma tabela,
  // um `find` pela ordem de inserção cotaria o mini pelo preço do grande
  // (16× mais caro) sempre que a chave larga viesse antes — erro silencioso, que
  // só aparece na fatura. A ordem do objeto deixa de ser variável escondida.
  const priceKey = Object.keys(USD_PER_MTOK)
    .filter((prefix) => model.startsWith(prefix))
    .sort((a, b) => b.length - a.length)[0];
  if (priceKey === undefined) {
    return null;
  }
  const p = USD_PER_MTOK[priceKey];
  if (p === undefined) {
    return null; // inalcançável (key veio de Object.keys); satisfaz noUncheckedIndexedAccess
  }
  const noCacheInput = Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  const usd =
    (noCacheInput * p.input +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite1h +
      usage.outputTokens * p.output) /
    1_000_000;
  return usd * 100;
}
