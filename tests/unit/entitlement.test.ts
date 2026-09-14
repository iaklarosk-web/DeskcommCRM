/**
 * F01-T08 — entitlement (§5.3, D14), contra o módulo REAL com pool fake.
 *
 * DoD (F01): entitlement: usage_events_written=2 (duas chamadas → duas linhas)
 * e o caminho negado (resolver injetado): EntitlementDenied ANTES de fn — o
 * provedor nunca é chamado — e nada gravado. Desde a F12-T02 (ADR-030 §3) o
 * resolver padrão é o por PLANO: o primeiro caso mede os três estados que
 * negam, o limite do plano e o `remaining` — `phase1_unlimited` acabou.
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

/**
 * Pool fake com a ASSINATURA e o USO que o resolver por plano (F12-T02) lê:
 * responde ao `select … from public.subscriptions`, ao `select … from
 * public.plans` e à contagem de uso; grava os inserts de `ai_usage_events`.
 */
function fakePoolComAssinatura(cenario: {
  status: "pending_payment" | "active" | "past_due" | "blocked" | "cancelled" | null;
  limite?: number | null;
  usado?: number;
}) {
  const inserts: Array<{ text: string; values?: unknown[] }> = [];
  const query = async (text: string, values?: unknown[]) => {
    if (text.includes("insert into public.ai_usage_events")) {
      inserts.push({ text, values });
      return { rows: [] };
    }
    if (text.includes("from public.subscriptions")) {
      return {
        rows: cenario.status === null ? [] : [{
          status: cenario.status, plan_code: "PLAN_A", grace_until: null,
          current_period_start: "2026-09-01T00:00:00.000Z", current_period_end: "2026-10-01T00:00:00.000Z",
        }],
      };
    }
    if (text.includes("from public.plans")) {
      const limits = cenario.limite === undefined || cenario.limite === null ? {} : { "ai.reply": cenario.limite, "users.invite": cenario.limite };
      return { rows: [{ code: "PLAN_A", name: "PLAN_A", price_cents: 0, currency: "BRL", period_days: 30, limits, active: true, source: "placeholder" }] };
    }
    if (text.includes("count(*)")) return { rows: [{ n: cenario.usado ?? 0 }] };
    return { rows: [] };
  };
  const client = { query, release: () => undefined };
  return { pool: { connect: async () => client, query } as never, inserts };
}

describe("entitlement", () => {
  it("F12-T02: resolver por plano — capabilities=6 resolved=6/6 denied_by_status=3/3 denied_by_limit=1/1 remaining_measured=1/1", async () => {
    // Arrange — seis capabilities do enum, nunca digitadas.
    expect(CAPABILITIES).toHaveLength(6);

    // Act 1 — assinatura ATIVA sem limite: as seis respondem sim, reason=ok.
    const ativa = fakePoolComAssinatura({ status: "active", limite: null });
    const resolvidas = await Promise.all(CAPABILITIES.map(async (c) => ({ c, r: await entitlement(ctx, c, { pool: ativa.pool }) })));

    // Act 2 — os três estados que NEGAM (D44/D38): pending_payment, blocked, cancelled.
    const negadosPorEstado = await Promise.all(
      (["pending_payment", "blocked", "cancelled"] as const).map(async (status) => ({
        status,
        r: await entitlement(ctx, "ai.reply", { pool: fakePoolComAssinatura({ status }).pool }),
      })),
    );
    // past_due continua permitindo (aviso antes de bloquear, D44).
    const emCarencia = await entitlement(ctx, "ai.reply", { pool: fakePoolComAssinatura({ status: "past_due" }).pool });

    // Act 3 — limite do plano: 500 com 500 usados nega; 500 com 120 usados sobra 380.
    const noLimite = await entitlement(ctx, "ai.reply", { pool: fakePoolComAssinatura({ status: "active", limite: 500, usado: 500 }).pool });
    const comSobra = await entitlement(ctx, "ai.reply", { pool: fakePoolComAssinatura({ status: "active", limite: 500, usado: 120 }).pool });

    // Act 4 — organização herdada, sem assinatura: permitida, declarada.
    const herdada = await entitlement(ctx, "ai.reply", { pool: fakePoolComAssinatura({ status: null }).pool });

    // Assert
    for (const { c, r } of resolvidas) expect(r, c).toEqual({ allowed: true, remaining: null, reason: "ok" });
    for (const { status, r } of negadosPorEstado) {
      expect(r.allowed, status).toBe(false);
      expect(r.reason, status).toBe(`subscription_${status}`);
    }
    expect(emCarencia).toEqual({ allowed: true, remaining: null, reason: "ok" });
    expect(noLimite).toEqual({ allowed: false, remaining: 0, reason: "limit_reached" });
    expect(comSobra).toEqual({ allowed: true, remaining: 380, reason: "ok" });
    expect(herdada).toEqual({ allowed: true, remaining: null, reason: "legacy_without_subscription" });
    console.log(
      `entitlement-plano: capabilities=6 resolved=${resolvidas.filter((x) => x.r.allowed).length}/6 ` +
        `denied_by_status=${negadosPorEstado.filter((x) => !x.r.allowed).length}/3 past_due_allowed=1/1 ` +
        `denied_by_limit=${noLimite.allowed ? 0 : 1}/1 remaining_measured=${comSobra.remaining === 380 ? 1 : 0}/1 legacy_allowed=1/1`,
    );
  });

  it("capability desconhecida quebra alto (ninguém inventa a pergunta)", async () => {
    await expect(entitlement(ctx, "ai.decolar" as never)).rejects.toThrow("capability desconhecida");
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
