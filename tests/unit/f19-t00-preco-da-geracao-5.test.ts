/**
 * F19-T00 — o custo do modelo em uso é precificado (VARREDURA §B23 b; ADR-042 §1).
 *
 * O achado, medido na produção na jornada da F18: `claude-sonnet-5` é o padrão
 * da organização (`ai_models.is_default_for_provider`), o turno rodou nele
 * 5 vezes (61.154 tokens de entrada, 3.640 de saída) e `llm_calls.cost_cents`
 * ficou NULO — a tabela de preço em código só conhecia a geração 4 por
 * prefixo (`claude-sonnet-4`, `claude-opus-4`). `estimatedCostCents` devolve 0
 * para modelo sem preço, o livro-razão grava 0, e a tela de uso de IA mostra
 * ZERO para quem usa o modelo padrão. O teto diário (F15) conta turnos, então
 * o freio continuava; o que não existia era a conta em dinheiro.
 *
 * O contrato é o do skill `claude-api` (tabela cacheada em 2026-06-24), a
 * mesma de `OS-Template/custo/precos.json`: Opus 5 = 5/25, Sonnet 5 = 2/10,
 * Haiku 4.5 = 1/5 USD por milhão; cache read 0,1× e cache write (1 h) 2× a
 * entrada. Os números aqui são os da tabela, não coerência entre modelos
 * (G-35: comparar com o registro-fonte, nunca com o texto).
 */
import { describe, expect, it } from "vitest";

import { costCents } from "@/lib/agent-engine/edge/llm/pricing";
import { estimatedCostCents, modeloTemPreco } from "@/src/entitlement";

const SEM_CACHE = { cacheReadTokens: 0, cacheWriteTokens: 0 } as const;

describe("F19-T00: a geração 5 da Anthropic tem preço", () => {
  it("claude-sonnet-5, claude-opus-5 e claude-haiku-4-5 têm preço (modeloTemPreco=3/3)", () => {
    // Arrange
    const modelos = ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"];

    // Act
    const comPreco = modelos.filter((m) => modeloTemPreco(m));

    // Assert
    expect(comPreco, `modeloTemPreco=${comPreco.length}/${modelos.length}`).toEqual(modelos);
    console.info(`f19-t00-preco: modeloTemPreco=${comPreco.length}/${modelos.length}`);
  });

  it("claude-sonnet-5 é cotado a 2/10 USD por milhão — nunca zero", () => {
    // Arrange + Act — 1M de entrada + 1M de saída = 12 USD = 1200 cents
    const cents = estimatedCostCents("claude-sonnet-5", 1_000_000, 1_000_000);

    // Assert — a asserção que o §B23 pede: custo do modelo padrão NÃO é zero
    expect(cents).toBeGreaterThan(0);
    expect(cents).toBeCloseTo(1200, 6);
  });

  it("claude-opus-5 é cotado a 5/25 USD por milhão", () => {
    expect(estimatedCostCents("claude-opus-5", 1_000_000, 1_000_000)).toBeCloseTo(3000, 6);
  });

  it("claude-haiku-4-5 é cotado a 1/5 USD por milhão, pela linha explícita", () => {
    expect(estimatedCostCents("claude-haiku-4-5", 1_000_000, 1_000_000)).toBeCloseTo(600, 6);
  });

  it("a jornada da F18 (61.154 entrada / 3.640 saída em sonnet-5) custaria 15,87 cents, não zero", () => {
    // Arrange — os números da evidência construction-f18-20260918.txt
    const usage = { inputTokens: 61_154, outputTokens: 3_640, ...SEM_CACHE };

    // Act
    const cents = costCents("claude-sonnet-5", usage);

    // Assert — (61.154 × 2 + 3.640 × 10) / 1e6 USD × 100 = 15,8708 cents
    expect(cents).not.toBeNull();
    expect(cents).toBeCloseTo(15.8708, 4);
  });

  it("cache read e cache write (1 h) do sonnet-5 seguem a regra 0,1× e 2× da entrada", () => {
    // Arrange — 1M lidos do cache + 1M escritos, sem saída
    const usage = { inputTokens: 2_000_000, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 };

    // Act
    const cents = costCents("claude-sonnet-5", usage);

    // Assert — 0,2 + 4 USD = 420 cents
    expect(cents).toBeCloseTo(420, 6);
  });
});
