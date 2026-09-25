/**
 * F24-T01/T00 — `GET/PATCH /api/v1/settings/webchat` ganha o modo de fila e o
 * prazo de retorno, e o link direto / código de embed que a tela mostra saem
 * da MESMA origem pública que o script usa (defeito 0a: uma origem só).
 *
 * Guardas, auditoria e `tenant_settings` são dublados: o que se mede aqui é o
 * contrato da rota — o que ela aceita, o que recusa e o que devolve.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as ModuloDeSettings from "@/src/tenant-config/settings";

const estado = vi.hoisted(() => ({ settings: new Map<string, unknown>(), auditorias: [] as unknown[] }));

vi.mock("@/lib/api/request-id", () => ({ getRequestId: () => "req-1" }));
vi.mock("@/lib/audit", () => ({ audit: async (linha: unknown) => void estado.auditorias.push(linha) }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ ok: true, user: { id: "u1" }, org: { orgId: "org-1", role: "admin" } }),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/src/crm/permissao-da-rota", () => ({
  ctxDaRota: () => ({ organization_id: "org-1", user_id: "u1", role: "admin", source: "session" }),
  negarSemPermissao: () => null,
}));
vi.mock("@/src/tenant-context/db", () => ({
  getServicePool: async () => ({ query: async () => ({ rows: [{ slug: "suporte-crm-os" }] }) }),
}));
vi.mock("@/src/tenant-config/settings", async (original) => {
  const real = await original<typeof ModuloDeSettings>();
  const { entradaDoSchema } = await import("@/src/tenant-config/schema");
  const { validar } = await import("@/src/tenant-config/validators");
  return {
    ...real,
    getSetting: async (_ctx: unknown, key: string) => (estado.settings.has(key) ? estado.settings.get(key) : entradaDoSchema(key)?.default),
    setSetting: async (_ctx: unknown, key: string, value: unknown) => {
      const entrada = entradaDoSchema(key);
      if (!entrada) throw new real.UnknownSettingError(key);
      const motivo = validar(entrada, value);
      if (motivo !== null) throw new real.InvalidSettingError(key, motivo);
      estado.settings.set(key, value);
    },
  };
});

import { GET, PATCH } from "@/app/api/v1/settings/webchat/route";

const PROXY = { "x-forwarded-proto": "https", "x-forwarded-host": "crm.kntecnologia.app", host: "crm.kntecnologia.app" };

function patch(corpo: unknown, headers: Record<string, string> = PROXY): Request {
  return new NextRequest("http://0.0.0.0:3000/api/v1/settings/webchat", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(corpo),
  });
}

beforeEach(() => {
  estado.settings.clear();
  estado.auditorias.length = 0;
});

describe("F24-T01 — modo de fila e prazo de retorno pela rota", () => {
  it("a leitura nasce com o padrão: atendente, `1 dia útil`", async () => {
    const res = await GET(new NextRequest("http://0.0.0.0:3000/api/v1/settings/webchat", { headers: PROXY }));
    const { data } = await res.json();
    expect(data.handoff_mode).toBe("atendente");
    expect(data.return_deadline_text).toBe("1 dia útil");
  });

  it("PATCH grava os dois e devolve a leitura nova, auditada", async () => {
    const res = await PATCH(patch({ handoff_mode: "retorno", return_deadline_text: "2 horas úteis" }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.handoff_mode).toBe("retorno");
    expect(data.return_deadline_text).toBe("2 horas úteis");
    expect(estado.settings.get("webchat.handoff_mode")).toBe("retorno");
    expect(estado.settings.get("webchat.return_deadline_text")).toBe("2 horas úteis");
    expect(estado.auditorias).toHaveLength(1);
  });

  it("modo fora do vocabulário e prazo vazio ou longo demais são 422", async () => {
    expect((await PATCH(patch({ handoff_mode: "telegram" }))).status).toBe(422);
    expect((await PATCH(patch({ return_deadline_text: "" }))).status).toBe(422);
    expect((await PATCH(patch({ return_deadline_text: "x".repeat(81) }))).status).toBe(422);
    expect(estado.settings.size).toBe(0);
  });

  it("o que já existia continua: ligar o chat e origens", async () => {
    const res = await PATCH(patch({ enabled: true, allowed_origins: ["https://app.one-desk.app"] }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.enabled).toBe(true);
    expect(data.allowed_origins).toEqual(["https://app.one-desk.app"]);
  });
});

describe("F24-T00 — o link direto e o código de embed usam a origem pública", () => {
  it("atrás do proxy: o domínio público; nunca 0.0.0.0", async () => {
    const res = await GET(new NextRequest("http://0.0.0.0:3000/api/v1/settings/webchat", { headers: PROXY }));
    const { data } = await res.json();
    expect(data.chat_url).toBe("https://crm.kntecnologia.app/chat/suporte-crm-os");
    expect(data.embed_snippet).toContain('src="https://crm.kntecnologia.app/embed/suporte-crm-os.js"');
  });
});
