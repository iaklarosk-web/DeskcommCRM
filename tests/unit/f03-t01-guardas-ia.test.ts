/**
 * F03-T01 — as duas guardas de IA de §5.6 não são sinônimas.
 *
 * A tabela D16 escreve a guarda de `inbound.message` como "`ai.enabled` E
 * `entitlement(ai.reply).allowed`" e a de `human.return_to_ai` como só
 * `ai.enabled`. Na Fase 1 o resolvedor de entitlement responde sim para tudo
 * (D14), então as duas COINCIDEM EM VALOR e um teste que só observasse o
 * resultado não distinguiria "a metade do entitlement existe" de "ninguém a
 * perguntou". Por isso a prova usa um dublê `allowed=false`, do mesmo jeito
 * que D36 provou `provider_calls_at_zero_balance`: com o dublê negando, a
 * guarda de entrada tem de virar falsa E a de retorno tem de continuar
 * verdadeira. Só assim as duas linhas ficam distinguíveis.
 */
import { describe, expect, it, vi } from "vitest";

const settingsLidos: Array<{ key: string }> = [];

vi.mock("@/src/tenant-config/settings", () => ({
  getSetting: vi.fn(async () => undefined),
  getStoredSetting: vi.fn(async (_ctx: unknown, key: string) => {
    settingsLidos.push({ key });
    return { present: true, value: true };
  }),
}));

import { resolverDeGuardasF03, type GuardConversation } from "@/src/conversation/guards";
import type { EntitlementResposta } from "@/src/entitlement/capability";
import type { TenantCtx } from "@/src/tenant-context";

const CTX: TenantCtx = {
  organization_id: "f0300001-0000-4000-8000-000000000001",
  source: "session",
} as TenantCtx;

const CONVERSA: GuardConversation = {
  id: "f0300001-0000-4000-8000-0000000000c1",
  status: "open",
  saas_state: "open",
  saas_state_entered_at: new Date("2026-09-10T00:00:00Z"),
  last_outbound_at: null,
  service_revision: "0",
  contact_id: "f0300001-0000-4000-8000-0000000000a1",
};

function entitlementQueNega(): EntitlementResposta {
  return { allowed: false, remaining: 0, reason: "teste_saldo_zero" };
}
function entitlementQueLibera(): EntitlementResposta {
  return { allowed: true, remaining: null, reason: "phase1_unlimited" };
}

describe("F03-T01 — ai_available pergunta ao entitlement; ai_enabled não", () => {
  it("com o entitlement liberando, as duas guardas são verdadeiras", async () => {
    // Arrange
    const guardas = resolverDeGuardasF03({ entitlementResolver: entitlementQueLibera });

    // Act
    const entrada = await guardas("ai_available", CTX, CONVERSA);
    const retorno = await guardas("ai_enabled", CTX, CONVERSA);

    // Assert — é o estado em que a Fase 1 vive; sozinho ele não prova nada.
    expect(entrada).toBe(true);
    expect(retorno).toBe(true);
  });

  it("com o dublê negando ai.reply, só a guarda de entrada vira falsa", async () => {
    // Arrange — ai.enabled continua gravado como true; muda só o entitlement.
    const guardas = resolverDeGuardasF03({ entitlementResolver: entitlementQueNega });

    // Act
    const entrada = await guardas("ai_available", CTX, CONVERSA);
    const retorno = await guardas("ai_enabled", CTX, CONVERSA);

    // Assert — a conversa que chega vai para waiting_human (toWhenGuardFails),
    // e o resume_ai humano continua permitido: são guardas diferentes.
    expect(entrada, "ai_available ignorou entitlement(ai.reply)").toBe(false);
    expect(retorno, "ai_enabled não deveria consultar entitlement").toBe(true);
    console.log("f03-t01-guardas: ai_available=false ai_enabled=true denied_by=entitlement 2/2");
  });

  it("sem linha de ai.enabled gravada, as duas guardas são falsas", async () => {
    // Arrange — na F03 ausência de linha é "IA não configurada" (ADR-016).
    const settings = await import("@/src/tenant-config/settings");
    vi.mocked(settings.getStoredSetting).mockResolvedValueOnce({ present: false, value: undefined });
    vi.mocked(settings.getStoredSetting).mockResolvedValueOnce({ present: false, value: undefined });
    const guardas = resolverDeGuardasF03({ entitlementResolver: entitlementQueLibera });

    // Act
    const entrada = await guardas("ai_available", CTX, CONVERSA);
    const retorno = await guardas("ai_enabled", CTX, CONVERSA);

    // Assert
    expect(entrada).toBe(false);
    expect(retorno).toBe(false);
  });
});
