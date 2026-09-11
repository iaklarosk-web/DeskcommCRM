/**
 * F04-T03 — o embutidor determinístico e o pino de dimensão (§5.10, ADR-002).
 *
 * Dimensão errada é a falha mais cara e mais silenciosa do RAG: não dá erro,
 * não aparece em log, só faz o acervo parecer vazio. Por isso o número tem pino
 * (`vector(1536)` no banco) e guarda contra divergência entre as duas cópias.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  comoVetorSql,
  conferirDimensao,
  DIMENSOES_DO_EMBEDDING,
  embutirDeterministico,
  MODELO_DE_EMBEDDING,
} from "@/src/knowledge";

const RAIZ = path.resolve(__dirname, "../..");

/** Produto interno; os vetores já saem normalizados em L2. */
function cosseno(a: readonly number[], b: readonly number[]): number {
  return a.reduce((soma, v, i) => soma + v * (b[i] ?? 0), 0);
}

describe("F04-T03: embedding determinístico", () => {
  it("mesmo texto → MESMO vetor, sem rede e sem chave", () => {
    // Arrange
    const texto = "qual é o prazo de entrega para Campinas?";

    // Act
    const primeiro = embutirDeterministico(texto);
    const segundo = embutirDeterministico(texto);

    // Assert
    expect(primeiro).toEqual(segundo);
    expect(cosseno(primeiro, segundo)).toBeCloseTo(1, 9);
  });

  it("tem exatamente 1536 dimensões e norma 1", () => {
    // Arrange + Act
    const vetor = embutirDeterministico("café torrado premium");

    // Assert
    expect(vetor).toHaveLength(DIMENSOES_DO_EMBEDDING);
    expect(DIMENSOES_DO_EMBEDDING).toBe(1536);
    expect(Math.sqrt(cosseno(vetor, vetor))).toBeCloseTo(1, 9);
    expect(conferirDimensao()).toBe(1536);
  });

  it("textos sem termo em comum não se parecem; com termo raro em comum, sim", () => {
    // Arrange
    const plantado = embutirDeterministico("o código do armazém é xilofonequantico");
    const pergunta = embutirDeterministico("xilofonequantico");
    const alheio = embutirDeterministico("horário comercial de segunda a sexta");

    // Act + Assert
    expect(cosseno(plantado, pergunta)).toBeGreaterThan(0.3);
    expect(cosseno(pergunta, alheio)).toBe(0);
  });

  it("acento não muda o termo (quem digita no WhatsApp não acentua)", () => {
    expect(embutirDeterministico("café")).toEqual(embutirDeterministico("cafe"));
  });

  it("pergunta vazia não vira vetor nulo (o operador <=> é indefinido nele)", () => {
    // Arrange + Act
    const vetor = embutirDeterministico("   ");

    // Assert
    expect(Math.sqrt(cosseno(vetor, vetor))).toBeCloseTo(1, 9);
  });

  it("conferirDimensao reprova embutidor de outra dimensão", () => {
    expect(() => conferirDimensao(() => new Array<number>(768).fill(0))).toThrow(
      /768 dimensões/,
    );
  });

  it("o literal de vetor é o que a pgvector aceita", () => {
    expect(comoVetorSql([1, 0.5, 0])).toBe("[1,0.5,0]");
  });
});

describe("F04-T03: as constantes não podem divergir da fonte", () => {
  it("modelo e dimensão batem com lib/ai/embeddings/chave.ts", () => {
    // Arrange — lido como TEXTO: importar aquele módulo validaria o ambiente
    // inteiro (ele importa @/lib/env no topo), e a guarda não pode custar isso.
    const fonte = readFileSync(path.join(RAIZ, "lib/ai/embeddings/chave.ts"), "utf8");

    // Act
    const modelo = /MODELO_DE_EMBEDDING\s*=\s*"([^"]+)"/.exec(fonte)?.[1];
    const dimensao = /DIMENSOES_DO_EMBEDDING\s*=\s*(\d+)/.exec(fonte)?.[1];

    // Assert
    expect(modelo, "lib/ai/embeddings/chave.ts não declara mais o modelo").toBe(
      MODELO_DE_EMBEDDING,
    );
    expect(Number(dimensao)).toBe(DIMENSOES_DO_EMBEDDING);
  });

  it("o banco continua sendo vector(1536) — o outro lado do mesmo mapa", () => {
    // Arrange
    const baseline = readFileSync(path.join(RAIZ, "supabase/baseline.sql"), "utf8");

    // Act
    const declarada = /"embedding" "public"\."vector"\((\d+)\) NOT NULL/.exec(baseline)?.[1];

    // Assert
    expect(Number(declarada)).toBe(DIMENSOES_DO_EMBEDDING);
  });
});
