/**
 * F01-T08 — entitlement (§5.3, D14), contra o módulo REAL com pool fake.
 *
 * DoD: capabilities=6 allowed=6/6 (derivado do enum, phase1_unlimited) e
 * entitlement: usage_events_written=2 (duas chamadas → duas linhas). Prova
 * também o caminho negado (resolver injetado, o seam que a Fase 2 troca):
 * EntitlementDenied ANTES de fn — o provedor nunca é chamado — e nada gravado.
 */
import { describe, expect, it } from "vitest";

import { gravarLinhaDoVerify } from "../lib/verify-metrics";

import {
  CAPABILITIES,
  entitlement,
  EntitlementDenied,
  estimatedCostCents,
  recordUsage,
  withEntitlement,
} from "@/src/entitlement";
import type { TenantCtx } from "@/src/tenant-context";

const ORG = "33333333-3333-4333-8333-333333333333";
const ctx: TenantCtx = { organization_id: ORG, source: "job" };

function fakePool() {
  const inserts: Array<{ text: string; values?: unknown[] }> = [];
  const client = {
    query: async (text: string, values?: unknown[]) => {
      if (text.includes("insert into public.ai_usage_events")) inserts.push({ text, values });
      return { rows: [] };
    },
    release: () => undefined,
  };
  return { pool: { connect: async () => client } as never, inserts };
}

describe("entitlement", () => {
  it("capabilities=6 allowed=6/6: toda capability responde phase1_unlimited", () => {
    // Arrange + Act — derivado do enum, nunca digitado
    const respostas = CAPABILITIES.map((c) => ({ c, r: entitlement(ctx, c) }));

    // Assert
    expect(CAPABILITIES).toHaveLength(6);
    for (const { c, r } of respostas) {
      expect(r, c).toEqual({ allowed: true, remaining: null, reason: "phase1_unlimited" });
    }
    console.log(`entitlement: capabilities=6 allowed=${respostas.filter((x) => x.r.allowed).length}/6`);
  });

  it("capability desconhecida quebra alto (ninguém inventa a pergunta)", () => {
    expect(() => entitlement(ctx, "ai.decolar" as never)).toThrow("capability desconhecida");
  });

  it("usage_events_written=2: duas chamadas de recordUsage = duas linhas, com custo local", async () => {
    // Arrange
    const fake = fakePool();

    // Act
    await recordUsage(
      ctx,
      { model: "gpt-4o-mini", operation: "chat", prompt_tokens: 100_000, completion_tokens: 10_000 },
      { pool: fake.pool },
    );
    await recordUsage(
      ctx,
      { model: "text-embedding-3-small", operation: "embedding", prompt_tokens: 50_000, completion_tokens: 0 },
      { pool: fake.pool },
    );

    // Assert
    expect(fake.inserts).toHaveLength(2);
    const linha = `entitlement: usage_events_written=${fake.inserts.length}`;
    console.log(linha);
    gravarLinhaDoVerify("entitlement", linha);
    // custo calculado LOCALMENTE (pricing.ts), na posição do estimated_cost_cents
    expect(fake.inserts[0]?.values?.[6]).toBe(estimatedCostCents("gpt-4o-mini", 100_000, 10_000));
    // 100k×0,015 + 10k×0,06 por 1k = 1,5 + 0,6 = 2,1 cents. A expectativa era
    // `2` porque `estimatedCostCents` arredondava — o próprio comentário de
    // antes registrava a conta certa e o valor errado ("1.5 + 0.6 → 2"). Desde
    // a F04-T08 o preço vem da tabela única do motor, a coluna é `numeric`
    // (migration 9018) e a projeção guarda o MESMO número de
    // `llm_calls.cost_cents`: 0,1 cent por chamada deixou de ser descartado.
    // Expectativa mais ESTREITA que a anterior, não mais frouxa.
    expect(fake.inserts[0]?.values?.[6]).toBeCloseTo(2.1, 9);
    expect(fake.inserts[1]?.values?.[3]).toBe("embedding");
  });

  it("modelo fora da tabela de preços custa 0 — mas a linha EXISTE (auditável, nunca silencioso)", async () => {
    // Arrange
    const fake = fakePool();

    // Act
    await recordUsage(
      ctx,
      { model: "modelo-que-ainda-nao-precificamos", operation: "summary", prompt_tokens: 999, completion_tokens: 9 },
      { pool: fake.pool },
    );

    // Assert
    expect(fake.inserts).toHaveLength(1);
    expect(fake.inserts[0]?.values?.[6]).toBe(0);
  });

  it("withEntitlement: permite → fn roda e o uso devolvido vira linha", async () => {
    // Arrange
    const fake = fakePool();

    // Act
    const resultado = await withEntitlement(
      ctx,
      "ai.reply",
      async () => ({
        result: "resposta",
        usage: { model: "gpt-4o-mini", operation: "chat" as const, prompt_tokens: 10, completion_tokens: 5 },
      }),
      { pool: fake.pool },
    );

    // Assert
    expect(resultado).toBe("resposta");
    expect(fake.inserts).toHaveLength(1);
  });

  it("withEntitlement: negado lança EntitlementDenied SEM chamar o provedor nem gravar", async () => {
    // Arrange — o resolver injetado é o seam que a Fase 2 troca por planos
    const fake = fakePool();
    let provedorChamado = false;

    // Act
    const promessa = withEntitlement(
      ctx,
      "channel.whatsapp.send",
      async () => {
        provedorChamado = true;
        return { result: "nunca" };
      },
      {
        pool: fake.pool,
        resolver: () => ({ allowed: false, remaining: 0, reason: "limite_do_plano" }),
      },
    );

    // Assert
    await expect(promessa).rejects.toBeInstanceOf(EntitlementDenied);
    expect(provedorChamado).toBe(false);
    expect(fake.inserts).toHaveLength(0);
  });
});
