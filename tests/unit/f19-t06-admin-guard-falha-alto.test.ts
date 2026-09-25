import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A guarda do /admin FALHA ALTO, não baixo — o mesmo princípio de
 * `tests/unit/auth-falha-alto.test.ts`, no caminho que ficou de fora daquela
 * correção (2026-07-30).
 *
 * INCIDENTE que este arquivo trava (produção, 21–22/09/2026): o pool do
 * PostgREST travou (`PGRST003: Timed out acquiring connection from connection
 * pool`) e ficou 36 h sem servir. `requirePlatformAdmin` lia `platform_admins`
 * DESCARTANDO o erro: `data` nulo virava "não tem linha", e o proprietário —
 * platform_admin ativo — recebeu a tela **"Acesso negado — esta área é restrita
 * a administradores da plataforma com MFA ativo"**. A tela acusava permissão e
 * MFA; a causa era um container. O dono passou a acreditar que tinha perdido o
 * acesso.
 *
 * `data: null` é AMBÍGUO nesta consulta: é o que a RLS devolve para quem não é
 * admin E o que sobra quando a query quebra. Só o `error` distingue os dois.
 */

const consulta: { platformAdmins: { data: unknown; error: unknown } } = {
  platformAdmins: { data: null, error: null },
};
let aal: string = "aal2";

const redirecionos: string[] = [];

vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    redirecionos.push(destino);
    throw new Error(`NEXT_REDIRECT:${destino}`);
  },
}));
vi.mock("@/src/obs/log", () => ({ registrarRequisicao: () => {} }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "u1", email: "dono@kn.test", user_metadata: {} } }, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: aal } }) },
    },
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => ({ maybeSingle: async () => consulta.platformAdmins }),
        maybeSingle: async () => consulta.platformAdmins,
      };
      return chain;
    },
  }),
}));

const { requirePlatformAdmin } = await import("@/lib/auth/requirePlatformAdmin");

beforeEach(() => {
  consulta.platformAdmins = { data: null, error: null };
  aal = "aal2";
  redirecionos.length = 0;
});

describe("requirePlatformAdmin — pool do banco fora do ar não vira 'Acesso negado'", () => {
  it("consulta que FALHA estoura com auth_permissions_unavailable e NÃO manda para /admin/forbidden", async () => {
    consulta.platformAdmins = {
      data: null,
      error: { code: "PGRST003", message: "Timed out acquiring connection from connection pool." },
    };
    await expect(requirePlatformAdmin()).rejects.toThrow(/auth_permissions_unavailable/);
    expect(redirecionos, "infraestrutura fora do ar virou decisão de autorização").toEqual([]);
  });

  it("a mensagem cita o código e o texto do provedor e diz que NÃO foi decisão de autorização", async () => {
    consulta.platformAdmins = {
      data: null,
      error: { code: "PGRST003", message: "Timed out acquiring connection from connection pool." },
    };
    await expect(requirePlatformAdmin()).rejects.toThrow(/PGRST003/);
    await expect(requirePlatformAdmin()).rejects.toThrow(/NÃO foi rebaixada por decisão de autorização/);
  });

  it("sem erro e sem linha continua sendo /admin/forbidden — quem não é admin não passa (2/2)", async () => {
    consulta.platformAdmins = { data: null, error: null };
    await expect(requirePlatformAdmin()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirecionos).toEqual(["/admin/forbidden"]);
  });

  it("admin com linha e aal2 passa; com mfa_required e aal1 vai para /login/mfa (2/2)", async () => {
    consulta.platformAdmins = { data: { user_id: "u1", scope: "full", mfa_required: false, revoked_at: null }, error: null };
    const ctx = await requirePlatformAdmin();
    expect(ctx.platformAdmin).toMatchObject({ user_id: "u1", scope: "full", mfa_required: false });
    expect(redirecionos).toEqual([]);

    consulta.platformAdmins = { data: { user_id: "u1", scope: "full", mfa_required: true, revoked_at: null }, error: null };
    aal = "aal1";
    await expect(requirePlatformAdmin()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirecionos).toEqual(["/login/mfa?next=/admin"]);
  });
});
