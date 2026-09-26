/**
 * F24-T04 (Suporte KN, 25/09/2026) — `ai.forbidden_topics` ganha tela em
 * `/app/settings/tenant/ia`. A chave já existia no schema e o turno SaaS já a
 * lia (`src/ai/turno.ts`, gatilho `tenant_rule`); só dava para gravar por API.
 * Fase 1 do suporte KN põe preço, desconto, cobrança e dados de conta nos
 * temas proibidos — que viram repasse ao humano — e o fundador precisa fazer
 * isso pela tela, uma organização por produto.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as ModuloDeTenantConfig from "@/src/tenant-config";

const estado = vi.hoisted(() => ({ settings: new Map<string, unknown>() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/lib/api/request-id", () => ({ getRequestId: () => "req-1" }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ ok: true, user: { id: "u1" }, org: { orgId: "org-1", role: "admin" } }),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/src/tenant-config", async (original) => {
  const real = await original<typeof ModuloDeTenantConfig>();
  const { entradaDoSchema } = await import("@/src/tenant-config/schema");
  const { validar } = await import("@/src/tenant-config/validators");
  return {
    ...real,
    getSetting: async (_ctx: unknown, key: string) => (estado.settings.has(key) ? estado.settings.get(key) : entradaDoSchema(key)?.default),
    getStoredSetting: async (_ctx: unknown, key: string) => ({ present: estado.settings.has(key), value: estado.settings.get(key) }),
    setSetting: async (_ctx: unknown, key: string, value: unknown) => {
      const entrada = entradaDoSchema(key);
      if (!entrada) throw new real.UnknownSettingError(key);
      const motivo = validar(entrada, value);
      if (motivo !== null) throw new real.InvalidSettingError(key, motivo);
      estado.settings.set(key, value);
    },
  };
});

import { GET, PATCH } from "@/app/api/v1/settings/ai/route";
import { FormularioDeIa } from "@/app/app/settings/tenant/ia/_form";
import { CHAVES_DA_TELA_DE_IA, lerConfiguracaoDeIa } from "@/lib/settings/ia-do-tenant";

const ctx = { organization_id: "org-1", user_id: "u1", role: "admin" as const, source: "session" as const };

function patch(corpo: unknown): Request {
  return new NextRequest("http://localhost:3000/api/v1/settings/ai", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

beforeEach(() => {
  estado.settings.clear();
});

describe("F24-T04 — a lista fechada da tela de IA inclui os temas proibidos", () => {
  it("CHAVES_DA_TELA_DE_IA tem ai.forbidden_topics e a leitura devolve a lista", async () => {
    expect(CHAVES_DA_TELA_DE_IA).toContain("ai.forbidden_topics");
    estado.settings.set("ai.forbidden_topics", ["preço", "cobrança"]);
    const lida = await lerConfiguracaoDeIa(ctx);
    expect(lida["ai.forbidden_topics"]).toEqual(["preço", "cobrança"]);
  });

  it("sem linha gravada, a lista é vazia (o gatilho nunca dispara — comportamento de sempre)", async () => {
    expect((await lerConfiguracaoDeIa(ctx))["ai.forbidden_topics"]).toEqual([]);
  });
});

describe("F24-T04 — PATCH /api/v1/settings/ai grava os temas", () => {
  it("aceita a lista, apara, descarta linha em branco e devolve a leitura", async () => {
    const res = await PATCH(patch({ "ai.forbidden_topics": [" preço ", "", "   ", "dados da conta"] }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data["ai.forbidden_topics"]).toEqual(["preço", "dados da conta"]);
    expect(estado.settings.get("ai.forbidden_topics")).toEqual(["preço", "dados da conta"]);
  });

  it("lista vazia limpa os temas", async () => {
    estado.settings.set("ai.forbidden_topics", ["preço"]);
    const res = await PATCH(patch({ "ai.forbidden_topics": [] }));
    expect(res.status).toBe(200);
    expect(estado.settings.get("ai.forbidden_topics")).toEqual([]);
  });

  it("recusa o que não é lista de textos curtos (422) e não grava nada", async () => {
    expect((await PATCH(patch({ "ai.forbidden_topics": "preço" }))).status).toBe(422);
    expect((await PATCH(patch({ "ai.forbidden_topics": ["x".repeat(121)] }))).status).toBe(422);
    expect((await PATCH(patch({ "ai.forbidden_topics": Array.from({ length: 51 }, (_, i) => `t${i}`) }))).status).toBe(422);
    expect(estado.settings.has("ai.forbidden_topics")).toBe(false);
  });

  it("GET devolve a lista junto das quatro chaves antigas", async () => {
    estado.settings.set("ai.forbidden_topics", ["cobrança"]);
    const { data } = await (await GET()).json();
    expect(Object.keys(data).sort()).toEqual(["ai.confidence_threshold", "ai.enabled", "ai.forbidden_topics", "ai.system_prompt", "ai.unknown_answer"]);
  });
});

describe("F24-T04 — a tela mostra e grava os temas, um por linha", () => {
  const inicial = { enabled: true, system_prompt: "", unknown_answer: "", confidence_threshold: 0.6, forbidden_topics: ["preço", "cobrança"] };

  it("o campo nasce com os temas gravados, um por linha", () => {
    render(<FormularioDeIa inicial={inicial} acervo={[]} />);
    const campo = screen.getByTestId("ia-temas-proibidos") as HTMLTextAreaElement;
    expect(campo.value).toBe("preço\ncobrança");
  });

  it("salvar envia a lista (linhas aparadas, sem vazias) no PATCH da rota de IA", async () => {
    const chamadas: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({ url, body: JSON.parse(String(init?.body)) });
        return { ok: true, json: async () => ({ data: {} }) };
      }),
    );
    render(<FormularioDeIa inicial={inicial} acervo={[]} />);
    fireEvent.change(screen.getByTestId("ia-temas-proibidos"), { target: { value: " preço \n\n dados da conta \n" } });
    fireEvent.click(screen.getByTestId("ia-salvar"));

    await waitFor(() => expect(chamadas).toHaveLength(1));
    expect(chamadas[0]!.url).toBe("/api/v1/settings/ai");
    expect((chamadas[0]!.body as Record<string, unknown>)["ai.forbidden_topics"]).toEqual(["preço", "dados da conta"]);
    vi.unstubAllGlobals();
  });
});
