/**
 * F12-T04 — o guarda `requireRole` pergunta à ASSINATURA o que a rota pode
 * (ADR-030 §3; D38, D44), DEPOIS do papel e do MFA.
 *
 * O dublê global de `tests/setup/vitest.setup.ts` responde "sem assinatura";
 * aqui ele é redeclarado por caso: `blocked` nega POST com 402
 * `subscription_blocked` e permite GET; `pending_payment` nega até o GET fora
 * de `/api/v1/billing/*` e `/api/v1/auth/*` com 402 `subscription_required`;
 * erro de leitura é 503 (fail closed, G-27) — nunca `full` por suposição.
 * Cada negação audita `authz.denied` com o motivo enum e sem PII.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { acessoDaOrganizacao } from "@/lib/auth/acesso-da-assinatura";
import { requireRole } from "@/lib/auth/require-role";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import type { AuthUser } from "@/lib/auth/types";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";

vi.mock("@/lib/auth/server", () => ({
  mfaEmDivida: vi.fn(async () => false),
  loadAuthUser: vi.fn(),
  resolveActiveOrg: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/auth/acesso-da-assinatura", () => ({ acessoDaOrganizacao: vi.fn() }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

const usuario: AuthUser = {
  id: USER_ID,
  email: "admin@example.test",
  full_name: null,
  avatar_url: null,
  is_platform_admin: false,
  idioma: "pt-BR",
  organizations: [{ organization_id: ORG_ID, organization_name: "Org", role: "admin" }],
};

type Acesso = Awaited<ReturnType<typeof acessoDaOrganizacao>>;
const acesso = (mode: Acesso["mode"], status: Acesso["status"], reason: Acesso["reason"]): Acesso => ({
  mode, status, reason, plan_code: "PLAN_A", grace_until: null,
});

function requisicao(metodo: string, caminho: string) {
  vi.mocked(headers).mockResolvedValue(new Headers({ "x-request-method": metodo, "x-pathname": caminho }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadAuthUser).mockResolvedValue(usuario);
  vi.mocked(resolveActiveOrg).mockResolvedValue({ orgId: ORG_ID, name: "Org", role: "admin" });
  vi.mocked(createClient).mockResolvedValue({
    rpc: vi.fn(async (fn: string) => (fn === "fn_user_role_in_org" ? { data: "admin", error: null } : { data: null, error: null })),
  } as never);
});

describe("F12-T04 — requireRole × assinatura", () => {
  it("blocked (D44): POST em rota de negócio → 402 subscription_blocked com audit; GET passa; billing e auth passam", async () => {
    // Arrange
    vi.mocked(acessoDaOrganizacao).mockResolvedValue(acesso("read_only", "blocked", "subscription_blocked"));
    const casos: Array<[string, string, boolean]> = [
      ["POST", "/api/v1/contacts", false],
      ["PATCH", "/api/v1/crm/orders/1", false],
      ["DELETE", "/api/v1/settings/ai", false],
      ["GET", "/api/v1/contacts", true],
      ["POST", "/api/v1/billing/checkout", true],
      ["POST", "/api/v1/auth/logout", true],
    ];

    // Act + Assert
    let negadas = 0;
    let permitidas = 0;
    for (const [metodo, caminho, esperado] of casos) {
      requisicao(metodo, caminho);
      const r = await requireRole("admin", { requestId: "req-1", resource: "contacts" });
      expect(r.ok, `${metodo} ${caminho}`).toBe(esperado);
      if (!r.ok) {
        expect(r.response.status).toBe(402);
        expect((await r.response.json()).error.code).toBe("subscription_blocked");
        negadas += 1;
      } else permitidas += 1;
    }
    expect(negadas).toBe(3);
    expect(permitidas).toBe(3);
    const auditadas = vi.mocked(audit).mock.calls.filter(([e]) => e.action === "authz.denied");
    expect(auditadas).toHaveLength(3);
    expect(auditadas[0]![0].metadata).toMatchObject({ reason: "subscription_blocked", mode: "read_only", method: "POST" });
    expect(JSON.stringify(auditadas)).not.toContain("admin@example.test");
    console.info(`f12-t04-guarda: blocked_writes_denied=${negadas}/3 reads_and_billing_allowed=${permitidas}/3 audit=${auditadas.length}/3`);
  });

  it("pending_payment (D38): até o GET de negócio é 402 subscription_required; /api/v1/billing e /api/v1/auth passam", async () => {
    vi.mocked(acessoDaOrganizacao).mockResolvedValue(acesso("billing_only", "pending_payment", "subscription_pending_payment"));
    requisicao("GET", "/api/v1/inbox/conversations");
    const negado = await requireRole("agent", { requestId: "req-2" });
    expect(negado.ok).toBe(false);
    if (!negado.ok) {
      expect(negado.response.status).toBe(402);
      expect((await negado.response.json()).error.code).toBe("subscription_required");
    }
    requisicao("GET", "/api/v1/billing/subscription");
    expect((await requireRole("admin", { requestId: "req-3" })).ok).toBe(true);
    requisicao("GET", "/api/v1/auth/interface");
    expect((await requireRole("viewer", { requestId: "req-4" })).ok).toBe(true);
    console.info("f12-t04-guarda: pending_get_denied=1/1 billing_allowed=1/1 auth_allowed=1/1");
  });

  it("active e organização sem assinatura: nada muda no guarda", async () => {
    vi.mocked(acessoDaOrganizacao).mockResolvedValue(acesso("full", "active", "ok"));
    requisicao("POST", "/api/v1/contacts");
    expect((await requireRole("admin", { requestId: "req-5" })).ok).toBe(true);
    vi.mocked(acessoDaOrganizacao).mockResolvedValue(acesso("full", null, "legacy_without_subscription"));
    expect((await requireRole("admin", { requestId: "req-6" })).ok).toBe(true);
  });

  it("leitura da assinatura falhou → 503 upstream_unavailable (fail closed), nunca full por suposição", async () => {
    vi.mocked(acessoDaOrganizacao).mockRejectedValue(new Error("banco fora"));
    requisicao("GET", "/api/v1/contacts");
    const r = await requireRole("admin", { requestId: "req-7" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(503);
      expect((await r.response.json()).error.code).toBe("upstream_unavailable");
    }
  });

  it("o papel vem ANTES da assinatura: quem não tem papel leva 403 sem que a assinatura seja lida", async () => {
    vi.mocked(acessoDaOrganizacao).mockResolvedValue(acesso("read_only", "blocked", "subscription_blocked"));
    vi.mocked(createClient).mockResolvedValue({
      rpc: vi.fn(async () => ({ data: "viewer", error: null })),
    } as never);
    requisicao("POST", "/api/v1/contacts");
    const r = await requireRole("admin", { requestId: "req-8" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
    expect(vi.mocked(acessoDaOrganizacao)).not.toHaveBeenCalled();
  });
});
