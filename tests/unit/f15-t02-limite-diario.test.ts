/**
 * F15-T02 — limite diário de turnos (ADR-036 §2 T02, D54 c), sem banco.
 *
 * O que se mede aqui: a janela do dia no fuso da organização (meia-noite
 * local em UTC, inclusive com horário de verão), e o resolver de Entitlement
 * com o limite por cima do plano — negado com `daily_limit_reached` quando os
 * turnos do dia chegam ao teto, intacto abaixo dele e sem teto em 0.
 *
 * Alvo do mutante 71 (contagem do dia sempre 0): o caso "ao bater o limite não
 * chama o provedor" abaixo.
 */
import { describe, expect, it } from "vitest";

import { janelaDoDia, MOTIVO_LIMITE_DIARIO, resolverComLimiteDiario, SEM_LIMITE } from "@/src/ai/limite";
import type { Resolver } from "@/src/entitlement";
import type { TenantCtx } from "@/src/tenant-context";

const ORG = "f1500002-0000-4000-8000-0000000000aa";
const ctx: TenantCtx = { organization_id: ORG, source: "job" };

/** Dublê do banco: o limite da organização, o fuso e a contagem do dia. */
function fakePool(limite: number, turnosHoje: number, timezone = "America/Sao_Paulo") {
  const queries: string[] = [];
  const client = {
    query: async (text: string) => {
      queries.push(text);
      if (text.includes("from public.tenant_settings")) return { rows: [{ value: limite }] };
      if (text.includes("from public.organizations")) return { rows: [{ timezone }] };
      if (text.includes("from public.ai_usage_events")) return { rows: [{ n: String(turnosHoje) }] };
      return { rows: [] };
    },
    release: () => {},
  };
  return { pool: { connect: async () => client } as never, queries };
}

const planoQuePermite: Resolver = async () => ({ allowed: true, remaining: null, reason: "ok" });
const planoQueNega: Resolver = async () => ({ allowed: false, remaining: 0, reason: "limit_reached" });

describe("F15-T02 — a janela do dia no fuso da organização", () => {
  it("meia-noite local vira UTC certo em São Paulo (UTC-3) e em Lisboa no verão (UTC+1)", () => {
    const sp = janelaDoDia(new Date("2026-09-14T02:30:00.000Z"), "America/Sao_Paulo"); // 23:30 do dia 13 em SP
    expect(sp.day).toBe("2026-09-13");
    expect(sp.desde.toISOString()).toBe("2026-09-13T03:00:00.000Z");
    expect(sp.ate.toISOString()).toBe("2026-09-14T03:00:00.000Z");
    const lx = janelaDoDia(new Date("2026-07-01T12:00:00.000Z"), "Europe/Lisbon");
    expect(lx.day).toBe("2026-07-01");
    expect(lx.desde.toISOString()).toBe("2026-06-30T23:00:00.000Z");
    const invalido = janelaDoDia(new Date("2026-09-14T12:00:00.000Z"), "Marte/Olympus");
    expect(invalido.day).toBe("2026-09-14");
    console.info(`f15-t02-janela: casos=3/3`);
  });
});

describe("F15-T02 — o resolver com limite diário", () => {
  // Título curto DE PROPÓSITO: é o alvo do mutante 71 (`-t` exato).
  it("ao bater o limite não chama o provedor", async () => {
    // Arrange — limite 2, dois turnos já gravados hoje.
    const { pool, queries } = fakePool(2, 2);
    const resolver = resolverComLimiteDiario(planoQuePermite, () => new Date("2026-09-14T15:00:00.000Z"));
    // Act
    const resposta = await resolver(ctx, "ai.reply", { pool });
    // Assert — negado ANTES do provedor, com o motivo próprio (o motivo vem
    // primeiro: é o que o mutante 71 tem de derrubar com nome).
    expect(resposta.reason, "esperava daily_limit_reached").toBe(MOTIVO_LIMITE_DIARIO);
    expect(resposta).toEqual({ allowed: false, remaining: 0, reason: MOTIVO_LIMITE_DIARIO });
    expect(queries.some((q) => q.includes("from public.ai_usage_events") && q.includes("operation = 'chat'"))).toBe(true);
    console.info(`f15-t02-resolver: denied_at_limit=1/1 reason=${resposta.reason}`);
  });

  it("abaixo do teto permite e informa o que resta; 0 é sem teto; o plano negado prevalece; outras capabilities passam", async () => {
    const abaixo = await resolverComLimiteDiario(planoQuePermite)(ctx, "ai.reply", { pool: fakePool(5, 3).pool });
    expect(abaixo).toEqual({ allowed: true, remaining: 2, reason: "ok" });
    const semTeto = await resolverComLimiteDiario(planoQuePermite)(ctx, "ai.reply", { pool: fakePool(SEM_LIMITE, 999).pool });
    expect(semTeto).toEqual({ allowed: true, remaining: null, reason: "ok" });
    const planoNegado = await resolverComLimiteDiario(planoQueNega)(ctx, "ai.reply", { pool: fakePool(5, 0).pool });
    expect(planoNegado.reason).toBe("limit_reached");
    const { pool, queries } = fakePool(1, 5);
    const outra = await resolverComLimiteDiario(planoQuePermite)(ctx, "ai.embedding", { pool });
    expect(outra.allowed).toBe(true);
    expect(queries).toHaveLength(0);
    console.info(`f15-t02-resolver-casos: casos=4/4`);
  });
});
