import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ActiveOrg, AuthUser } from "@/lib/auth/types";

const { get, auth } = vi.hoisted(() => ({
  get: vi.fn(),
  auth: { user: {} as AuthUser, activeOrg: null as ActiveOrg | null },
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/lib/api/client", () => ({ apiClient: { get } }));
import { useCrmAuthorNames } from "@/hooks/crm/useCrmAuthorNames";

let client: QueryClient;
const USER = "40000000-0000-4000-8000-000000000001";
const AUTHOR = "40000000-0000-4000-8000-000000000002";
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  vi.clearAllMocks();
  auth.user = {
    id: USER,
    full_name: "Nome próprio",
    is_platform_admin: false,
    support: null,
  } as AuthUser;
  auth.activeOrg = { orgId: "org-a", role: "agent" } as ActiveOrg;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});

describe("autoria das notas com fonte autorizada", () => {
  it("usa nomes reais da API existente e o perfil próprio, sem email/UUID substitutos", async () => {
    get.mockResolvedValue({
      data: [
        { user_id: AUTHOR, full_name: " Autora da equipe " },
        { user_id: "sem-nome", full_name: "   ", email: "ignorar@example.invalid" },
        { user_id: "valor-invalido", full_name: 42 },
      ],
    });
    const { result } = renderHook(useCrmAuthorNames, { wrapper: Wrapper });
    await waitFor(() =>
      expect(result.current).toEqual({ [USER]: "Nome próprio", [AUTHOR]: "Autora da equipe" }),
    );
    expect(get).toHaveBeenCalledWith("/api/v1/team/assignable", {
      signal: expect.any(AbortSignal),
    });
  });

  it.each(["viewer", "support_readonly", "support_full", "platform"])(
    "%s não busca equipe nem herda cache autorizado",
    (mode) => {
      client.setQueryData(["crm", "author-names", "org-a", USER], {
        data: [{ user_id: AUTHOR, full_name: "Nome em cache" }],
      });
      if (mode === "viewer") auth.activeOrg!.role = "viewer";
      else if (mode === "platform") auth.user.is_platform_admin = true;
      else auth.user.support = { access_mode: mode } as AuthUser["support"];
      const { result } = renderHook(useCrmAuthorNames, { wrapper: Wrapper });
      expect(result.current).toEqual({ [USER]: "Nome próprio" });
      expect(get).not.toHaveBeenCalled();
    },
  );

  it("erro de leitura mantém só a autoria própria, sem nome inventado", async () => {
    get.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(useCrmAuthorNames, { wrapper: Wrapper });
    await waitFor(() =>
      expect(client.getQueryState(["crm", "author-names", "org-a", USER])?.status).toBe("error"),
    );
    expect(result.current).toEqual({ [USER]: "Nome próprio" });
  });

  it("trocar organização não mostra os nomes armazenados para a anterior", async () => {
    get
      .mockResolvedValueOnce({ data: [{ user_id: AUTHOR, full_name: "Equipe A" }] })
      .mockResolvedValueOnce({ data: [] });
    const { result, rerender } = renderHook(useCrmAuthorNames, { wrapper: Wrapper });
    await waitFor(() => expect(result.current[AUTHOR]).toBe("Equipe A"));
    auth.activeOrg = { orgId: "org-b", role: "agent" } as ActiveOrg;
    rerender();
    expect(result.current).toEqual({ [USER]: "Nome próprio" });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(result.current).toEqual({ [USER]: "Nome próprio" });
  });
});
