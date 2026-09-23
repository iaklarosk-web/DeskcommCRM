import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A guarda de admin das rotas de API distingue NEGAÇÃO de INDISPONIBILIDADE.
 *
 * O incidente de 21–22/09 (VARREDURA §B25) mostrou o custo de não distinguir:
 * com o banco fora, o produto dizia ao dono que ele não tinha permissão. A
 * página foi consertada; este é o mesmo conserto para as rotas.
 */
const estado: { erro: Error | null } = { erro: null };

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: async () => {
    if (estado.erro) throw estado.erro;
    return { user: { id: "u1" }, platformAdmin: { user_id: "u1", scope: "full", mfa_required: false } };
  },
}));

const { requirePlatformAdminApi } = await import("@/lib/auth/requirePlatformAdminApi");

beforeEach(() => {
  estado.erro = null;
});

describe("F20-T03 — guarda de platform_admin em rota de API", () => {
  it("admin legítimo passa com o contexto", async () => {
    const r = await requirePlatformAdminApi("req-1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.platformAdmin.user_id).toBe("u1");
  });

  it("quem não é admin recebe 403 (negação continua negação)", async () => {
    estado.erro = new Error("NEXT_REDIRECT:/admin/forbidden");
    const r = await requirePlatformAdminApi("req-2");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
  });

  it("banco fora do ar vira 503, não 403 — infraestrutura não é decisão de autorização", async () => {
    estado.erro = new Error("auth_permissions_unavailable: PGRST003: Timed out acquiring connection from connection pool.");
    const r = await requirePlatformAdminApi("req-3");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status, "falha de infraestrutura respondeu como falta de permissão").toBe(503);
      const corpo = (await r.response.json()) as { error?: { code?: string } };
      expect(corpo.error?.code).toBe("upstream_unavailable");
    }
  });
});
