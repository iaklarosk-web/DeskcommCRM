/**
 * F04-T08 — uma chamada, um registro, um preço (§5.3, D14; ADR-021 decisão 3).
 *
 * O risco que estes casos existem para prender é dupla contagem, e ele é
 * INVISÍVEL no caminho feliz: o agente responde, a tela não muda, e a única
 * consequência é a organização aparecer consumindo o dobro do que consumiu.
 * Por isso as asserções são sobre a FORMA do que foi escrito — quantos
 * statements, qual statement — e não sobre o texto da resposta.
 *
 * Banco é fake de propósito: aqui se mede o contrato entre `chamarModelo`,
 * `withEntitlement` e `runModelCall`. A contagem contra Postgres de verdade
 * está em `tests/integration/f04-t08-consumo-unico.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";

import { costCents } from "@/lib/agent-engine/edge/llm/pricing";
import { createFakeRegistry } from "@/lib/agent-engine/edge/llm/providers";
import { chamarModelo } from "@/src/ai";
import { EntitlementDenied, estimatedCostCents } from "@/src/entitlement";
import type { TenantCtx } from "@/src/tenant-context";

const ORG = "44444444-4444-4444-8444-444444444444";
const CONVERSA = "44444444-4444-4444-8444-4444444444c0";
const ctx: TenantCtx = { organization_id: ORG, source: "job" };

/** Chave FICTÍCIA — não é credencial de lugar nenhum e nada aqui lê `.env`. */
const CHAVE_FICTICIA = "chave-ficticia-de-teste-f04-t08-nunca-real";
const cfg = { anthropicApiKey: CHAVE_FICTICIA, cacheTtl: "1h" as const };

/**
 * Pool falso que GUARDA cada statement. Tem `connect` além de `query` porque é
 * assim que `recordUsage` escreveria se alguém devolvesse `usage` ao
 * `withEntitlement` — sem ele, a dupla contagem apareceria como TypeError em vez
 * de como a contagem errada que ela é.
 */
function poolQueGuarda() {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    statements.push({ sql, params });
    if (sql.includes("settings->'llm'")) {
      return {
        rows: [
          {
            llm: {
              provider: "anthropic",
              default_model: "claude-sonnet-4-de-teste",
              params: {},
              enabled_models: [],
              monthly_budget_cents: null,
            },
          },
        ],
      };
    }
    if (sql.includes("from ai_purpose_bindings")) return { rows: [] };
    if (sql.includes("from ai_provider_credentials")) return { rows: [] };
    if (sql.includes("insert into llm_calls")) return { rows: [{ id: "chamada-1" }] };
    return { rows: [] };
  });
  const pool = {
    query,
    connect: async () => ({ query, release: () => undefined }),
  } as never;
  return { pool, statements };
}

interface Statement {
  sql: string;
  params: unknown[];
}

const gravacoesDeConsumo = (statements: Statement[]): Statement[] =>
  statements.filter((s) => s.sql.includes("insert into public.ai_usage_events"));

describe("F04-T08: um registro de consumo", () => {
  it("a chamada grava llm_calls e ai_usage_events no MESMO statement", async () => {
    // Arrange
    const { pool, statements } = poolQueGuarda();

    // Act
    await chamarModelo(
      ctx,
      "ai.reply",
      { messages: [{ role: "user", content: "bom dia" }], conversationId: CONVERSA },
      { pool, cfg, registry: createFakeRegistry() },
    );

    // Assert
    const consumo = gravacoesDeConsumo(statements);
    expect(
      consumo.length,
      "o consumo da chamada foi gravado mais de uma vez (dupla contagem)",
    ).toBe(1);
    const chamadas = statements.filter((s) => s.sql.includes("insert into llm_calls"));
    expect(chamadas).toHaveLength(1);
    expect(
      consumo[0]?.sql,
      "o uso foi gravado por um statement diferente do llm_calls — não é a mesma transação",
    ).toBe(chamadas[0]?.sql);
  });

  it("a projeção leva a conversa e a operação de §5.3", async () => {
    // Arrange
    const { pool, statements } = poolQueGuarda();

    // Act
    await chamarModelo(
      ctx,
      "ai.reply",
      { messages: [{ role: "user", content: "oi" }], conversationId: CONVERSA },
      { pool, cfg, registry: createFakeRegistry() },
    );

    // Assert — $16 conversa, $17 operação (posições 15 e 16 do array)
    const consumo = gravacoesDeConsumo(statements)[0];
    expect(consumo?.params?.[15]).toBe(CONVERSA);
    expect(consumo?.params?.[16]).toBe("chat");
  });

  it("compaction vira operation=summary, não um vocabulário novo", async () => {
    // Arrange
    const { pool, statements } = poolQueGuarda();

    // Act
    await chamarModelo(
      ctx,
      "ai.summary",
      { messages: [{ role: "user", content: "resuma" }], purpose: "compaction" },
      { pool, cfg, registry: createFakeRegistry() },
    );

    // Assert
    expect(gravacoesDeConsumo(statements)[0]?.params?.[16]).toBe("summary");
  });

  it("saldo negado: nada sai para o provedor e nada é gravado (D36)", async () => {
    // Arrange — o dublê é o seam que a Fase 2 troca pelo resolvedor de verdade
    const { pool, statements } = poolQueGuarda();
    let provedorChamado = 0;
    const registryQueConta = createFakeRegistry(async () => {
      provedorChamado += 1;
      return {
        content: [{ type: "text" as const, text: "nunca" }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      };
    });

    // Act — três tentativas iguais, como manda G-15/D36
    const erros: unknown[] = [];
    for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
      try {
        await chamarModelo(
          ctx,
          "ai.reply",
          { messages: [{ role: "user", content: "bom dia" }] },
          {
            pool,
            cfg,
            registry: registryQueConta,
            resolver: () => ({ allowed: false, remaining: 0, reason: "sem_saldo" }),
          },
        );
      } catch (erro) {
        erros.push(erro);
      }
    }

    // Assert
    expect(erros).toHaveLength(3);
    for (const erro of erros) expect(erro).toBeInstanceOf(EntitlementDenied);
    expect(provedorChamado, "o provedor foi chamado com saldo negado").toBe(0);
    expect(gravacoesDeConsumo(statements)).toHaveLength(0);
    expect(statements.filter((s) => s.sql.includes("insert into llm_calls"))).toHaveLength(0);
    console.log(`consumo: provider_calls_at_zero_balance=0 attempts=${erros.length}`);
  });
});

describe("F04-T08: um preço", () => {
  it("o custo do entitlement é o MESMO número do motor", () => {
    // Arrange
    const casos = [
      { model: "gpt-4o-mini", prompt: 100_000, completion: 10_000 },
      { model: "claude-sonnet-4-20260101", prompt: 1_000, completion: 500 },
      { model: "text-embedding-3-small", prompt: 50_000, completion: 0 },
    ];

    // Act + Assert
    for (const c of casos) {
      expect(estimatedCostCents(c.model, c.prompt, c.completion), c.model).toBe(
        costCents(c.model, {
          inputTokens: c.prompt,
          outputTokens: c.completion,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
      );
    }
  });

  it("gpt-4o-mini NÃO é cotado pelo preço de gpt-4o (maior prefixo vence)", () => {
    // Arrange + Act
    const mini = estimatedCostCents("gpt-4o-mini-2026-01-01", 1_000_000, 0);
    const grande = estimatedCostCents("gpt-4o-2026-01-01", 1_000_000, 0);

    // Assert — 0,15 USD/Mtok vs 2,50 USD/Mtok
    expect(mini).toBeCloseTo(15, 6);
    expect(grande).toBeCloseTo(250, 6);
  });

  it("modelo sem preço: o motor não sabe (null), o livro-razão registra 0", () => {
    // Arrange + Act + Assert
    const semPreco = "modelo-que-ainda-nao-precificamos";
    expect(
      costCents(semPreco, {
        inputTokens: 999,
        outputTokens: 9,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBeNull();
    expect(estimatedCostCents(semPreco, 999, 9)).toBe(0);
  });
});
