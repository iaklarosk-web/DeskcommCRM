/**
 * QUEM FOI CONVIDADO PRECISA CONSEGUIR CRIAR A CONTA — MESMO COM O CADASTRO
 * PÚBLICO DESLIGADO.
 *
 * ─── O defeito, medido na produção ──────────────────────────────────────────
 *
 * 23/09/2026: convidado real do tenant `deka-sucos` abriu o link, chegou em
 * "Criar conta", preencheu e leu *"Não foi possível criar a conta. Tente
 * novamente."* — quatro vezes. O GoTrue da produção respondeu **422
 * `signup_disabled`** (`docker logs crm-prod-auth`, 21:09:07Z…21:10:10Z):
 * `GOTRUE_DISABLE_SIGNUP=true` lá, `false` no staging. A F20 encurtou o link e
 * não tocou nisso: o convidado continuaria batendo na mesma parede.
 *
 * ─── O que este arquivo guarda ──────────────────────────────────────────────
 *
 * Que o convite VIVO abra a porta pelo service role (que não passa pelo
 * `DISABLE_SIGNUP`), e que a ausência de convite continue batendo na porta
 * pública — senão o conserto vira um buraco de cadastro aberto ao mundo, com o
 * Stripe LIVE do outro lado (D13/D58).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolverConvite } from "@/lib/auth/resolver-de-convite";
import { aceitarConvitePorToken } from "@/src/convites/repositorio";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/auth/resolver-de-convite", () => ({ resolverConvite: vi.fn() }));
vi.mock("@/src/convites/repositorio", () => ({ aceitarConvitePorToken: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  audit: vi.fn(async () => undefined),
}));

const signUpPublico = vi.fn();
const criarPeloServico = vi.fn();

let n = 0;
const EMAIL = () => `convidado-${++n}-${Date.now()}@exemplo.test`;

const entrada = (email: string) => ({
  email,
  password: "SenhaForte!2026",
  password_confirm: "SenhaForte!2026",
});

describe("signUp com convite — a porta do convidado não é a porta pública", () => {
  beforeEach(() => {
    vi.resetModules();
    signUpPublico.mockReset();
    criarPeloServico.mockReset();
    vi.mocked(resolverConvite).mockReset();
    vi.mocked(aceitarConvitePorToken).mockReset();
    vi.mocked(aceitarConvitePorToken).mockResolvedValue({ ok: true, organization_id: "org-1", invite_id: "inv-1" });
    vi.mocked(headers).mockResolvedValue({
      get: (k: string) => (k === "x-forwarded-for" ? `203.0.113.${n % 250}` : null),
    } as never);
    vi.mocked(createClient).mockResolvedValue({
      auth: { signUp: signUpPublico },
    } as never);
    vi.mocked(createAdminClient).mockReturnValue({
      auth: { admin: { createUser: criarPeloServico } },
    } as never);
  });

  it("convite vivo cria a conta pelo service role, NÃO pela porta pública", async () => {
    const email = EMAIL();
    vi.mocked(resolverConvite).mockResolvedValue({ token: "n5JU3XOM6R13i87o", email, origem: "team_invites" });
    criarPeloServico.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });

    const { signUp } = await import("./signUp");
    const res = await signUp(entrada(email), "n5JU3XOM6R13i87o");

    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(criarPeloServico).toHaveBeenCalledTimes(1);
    // A porta pública nem é tentada: é ela que devolve 422 na produção.
    expect(signUpPublico).not.toHaveBeenCalled();
  });

  it("o e-mail do convidado nasce confirmado — não há remetente para o link", async () => {
    const email = EMAIL();
    vi.mocked(resolverConvite).mockResolvedValue({ token: "tok", email, origem: "team_invites" });
    criarPeloServico.mockResolvedValue({ data: { user: { id: "u-2" } }, error: null });

    const { signUp } = await import("./signUp");
    await signUp(entrada(email), "tok");

    expect(criarPeloServico.mock.calls[0]![0]).toMatchObject({ email, email_confirm: true });
  });

  it("CONTROLE — SEM convite continua na porta pública (D13 segue valendo)", async () => {
    // Sem este caso, o conserto viraria cadastro aberto ao mundo.
    signUpPublico.mockResolvedValue({ data: { user: null, session: null }, error: { message: "signup disabled", status: 422 } });

    const { signUp } = await import("./signUp");
    const res = await signUp({ ...entrada(EMAIL()), org_name: "Empresa Nova" });

    expect(res).toEqual({ ok: false, error: "signup_failed" });
    expect(criarPeloServico).not.toHaveBeenCalled();
  });

  it("CONTROLE — convite que não resolve não abre o service role", async () => {
    vi.mocked(resolverConvite).mockResolvedValue(null);

    const { signUp } = await import("./signUp");
    const res = await signUp(entrada(EMAIL()), "token-inventado");

    expect(res.ok).toBe(false);
    expect(criarPeloServico).not.toHaveBeenCalled();
    expect(signUpPublico).not.toHaveBeenCalled();
  });

  it("CONTROLE — e-mail diferente do convite não entra na organização alheia", async () => {
    vi.mocked(resolverConvite).mockResolvedValue({ token: "tok", email: "dono@exemplo.test", origem: "team_invites" });

    const { signUp } = await import("./signUp");
    const res = await signUp(entrada("intruso@exemplo.test"), "tok");

    expect(res.ok).toBe(false);
    expect(criarPeloServico).not.toHaveBeenCalled();
  });

  it("a conta criada JÁ entra na organização — sem isso sobra conta sem empresa", async () => {
    const email = EMAIL();
    vi.mocked(resolverConvite).mockResolvedValue({ token: "tok", email, origem: "team_invites" });
    criarPeloServico.mockResolvedValue({ data: { user: { id: "u-3" } }, error: null });

    const { signUp } = await import("./signUp");
    await signUp(entrada(email), "tok");

    expect(aceitarConvitePorToken).toHaveBeenCalledWith({ token: "tok", user_id: "u-3" });
  });

  it("CONTROLE — se o vínculo falhar, o cadastro NÃO se declara bem-sucedido", async () => {
    const email = EMAIL();
    vi.mocked(resolverConvite).mockResolvedValue({ token: "tok", email, origem: "team_invites" });
    criarPeloServico.mockResolvedValue({ data: { user: { id: "u-4" } }, error: null });
    vi.mocked(aceitarConvitePorToken).mockResolvedValue({ ok: false, recusa: "invite_revoked" });

    const { signUp } = await import("./signUp");
    const res = await signUp(entrada(email), "tok");

    expect(res.ok).toBe(false);
  });

  it("conta que JÁ existe devolve conta_ja_existe — não 'tente novamente'", () => {
    // 24/09, produção: o convidado leu "Não foi possível criar a conta. Tente
    // novamente." duas vezes. Nenhuma tentativa ia funcionar — ele já tinha
    // conta desde as 22:33, com o vínculo de admin já aceito.
    return (async () => {
      const email = EMAIL();
      vi.mocked(resolverConvite).mockResolvedValue({ token: "tok", email, origem: "team_invites" });
      criarPeloServico.mockResolvedValue({
        data: { user: null },
        error: { message: "A user with this email address has already been registered" },
      });

      const { signUp } = await import("./signUp");
      const res = await signUp(entrada(email), "tok");

      expect(res).toEqual({ ok: false, error: "conta_ja_existe" });
    })();
  });

  it("CONTROLE — outro erro do provedor continua sendo signup_failed", async () => {
    const email = EMAIL();
    vi.mocked(resolverConvite).mockResolvedValue({ token: "tok", email, origem: "team_invites" });
    criarPeloServico.mockResolvedValue({ data: { user: null }, error: { message: "Database error creating new user" } });

    const { signUp } = await import("./signUp");
    const res = await signUp(entrada(email), "tok");

    expect(res).toEqual({ ok: false, error: "signup_failed" });
  });
});
