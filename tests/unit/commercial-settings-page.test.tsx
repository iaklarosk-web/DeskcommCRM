import { beforeEach, describe, expect, it, vi } from "vitest";
import CommercialSettingsPage from "@/app/app/settings/commercial/page";
import { canSee, hubSections } from "@/lib/navigation/registry";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  resolveActiveOrg: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => mocks);
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("@/app/app/settings/commercial/_client", () => ({
  CommercialSettingsClient: () => null,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAuth.mockResolvedValue({
    is_platform_admin: false,
    support: null,
  });
  mocks.resolveActiveOrg.mockResolvedValue({
    orgId: "tenant-a",
    role: "viewer",
  });
});
describe("porta de leitura comercial e navegação", () => {
  it.each(["viewer", "agent", "manager", "admin"])(
    "permite leitura de %s sem confundi-la com permissão de escrever",
    async (role) => {
      mocks.resolveActiveOrg.mockResolvedValue({ orgId: "tenant-a", role });
      expect((await CommercialSettingsPage()).type).toBeDefined();
      expect(mocks.resolveActiveOrg).toHaveBeenCalledWith(
        await mocks.requireAuth.mock.results[0]?.value,
      );
    },
  );

  it("nega plataforma direta na página e no cartão mesmo com papel admin", async () => {
    mocks.requireAuth.mockResolvedValue({
      is_platform_admin: true,
      support: null,
    });
    mocks.resolveActiveOrg.mockResolvedValue({
      orgId: "tenant-a",
      role: "admin",
    });
    await expect(CommercialSettingsPage()).rejects.toThrow("redirect:/403");
    const destination = NAV_CATALOG.find((row) => row.href === "/app/settings/commercial");
    expect(destination).toBeDefined();
    expect(canSee(destination!, true, "admin")).toBe(false);
  });

  it.each(["full", "support_readonly"])(
    "mantém leitura no escopo acompanhado %s, sem usar a flag de plataforma bruta",
    async (access_mode) => {
      const user = {
        is_platform_admin: true,
        support: { status: "active", organization_id: "tenant-b", access_mode },
      };
      mocks.requireAuth.mockResolvedValue(user);
      const effectiveRole = access_mode === "full" ? "admin" : "viewer";
      mocks.resolveActiveOrg.mockResolvedValue({
        orgId: "tenant-b",
        role: effectiveRole,
      });
      expect((await CommercialSettingsPage()).type).toBeDefined();
      expect(mocks.resolveActiveOrg).toHaveBeenCalledWith(user);
      // Mesmo contexto efetivo já usado pelo hub real, Sidebar e CommandPalette.
      const platformDirect = user.is_platform_admin && !user.support;
      const hrefs = hubSections("organizacao", platformDirect, effectiveRole).flatMap((section) =>
        section.items.map((item) => item.href),
      );
      expect(hrefs).toContain("/app/settings/commercial");
    },
  );

  it("propaga o encerramento de suporte do resolvedor e não renderiza a página", async () => {
    mocks.requireAuth.mockResolvedValue({
      is_platform_admin: true,
      support: { status: "ended" },
    });
    mocks.resolveActiveOrg.mockRejectedValue(new Error("redirect:/support-ended"));
    await expect(CommercialSettingsPage()).rejects.toThrow("redirect:/support-ended");
  });

  it("sem organização ativa retorna à entrada do app", async () => {
    mocks.resolveActiveOrg.mockResolvedValue(null);
    await expect(CommercialSettingsPage()).rejects.toThrow("redirect:/app");
  });
});
