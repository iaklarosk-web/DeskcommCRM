/**
 * F20-T02 — a emissão do convite pelo banco (ADR-045 §2; D59, D61 b).
 *
 * Três propriedades puras, sem rede nem banco:
 *   1. o TOKEN tem 16 chars base64url (96 bits) e é sorteado por CSPRNG — é a
 *      credencial de uma rota pública, e `Math.random` não serve;
 *   2. o LINK cabe onde o de 559 chars não cabia: `<app>/i/<token>` ≤ 64 chars
 *      no domínio de produção, que é o que faz o WhatsApp linkificar (§B27);
 *   3. o e-mail é normalizado antes de virar linha — é `lower(email)` que o
 *      índice único do "um vivo por pessoa" usa (D61 b).
 */
import { describe, expect, it } from "vitest";

import { linkDoConvite, normalizarEmailDeConvite, sortearTokenDeConvite, TAMANHO_DO_TOKEN } from "@/src/convites/token";

describe("F20-T02 — token e link do convite", () => {
  it("o token tem 16 chars base64url e não se repete em 500 sorteios (entropia=500/500)", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const t = sortearTokenDeConvite();
      expect(t).toMatch(/^[A-Za-z0-9_-]{16}$/);
      vistos.add(t);
    }
    expect(vistos.size, "dois sorteios iguais em 500 — a fonte não é aleatória").toBe(500);
    expect(TAMANHO_DO_TOKEN).toBe(16);
  });

  it("o link do convite cabe em 64 chars no domínio de produção (link_len<=64=1/1)", () => {
    const link = linkDoConvite("https://crm.kntecnologia.app", "aBcD1234_-efGhIj");
    expect(link).toBe("https://crm.kntecnologia.app/i/aBcD1234_-efGhIj");
    expect(link.length, `o link tem ${link.length} chars`).toBeLessThanOrEqual(64);
    // Barra final no APP_URL não vira barra dupla no link.
    expect(linkDoConvite("https://crm.kntecnologia.app/", "aBcD1234_-efGhIj")).toBe(link);
  });

  it("o e-mail é normalizado (minúsculas e sem espaços) antes de virar linha", () => {
    expect(normalizarEmailDeConvite("  Pessoa@Exemplo.COM.BR ")).toBe("pessoa@exemplo.com.br");
    expect(() => normalizarEmailDeConvite("   ")).toThrow(/vazio/i);
  });
});

/**
 * O caminho de quem recebe o link curto e AINDA NÃO TEM CONTA.
 *
 * `decidirConviteDoSignup` é pura de propósito (a propriedade é de segurança e
 * precisa ser testável sem banco). O token curto não pode ser validado ali — ele
 * não carrega nada, quem sabe é a linha. Então a função passa a CLASSIFICAR o
 * formato, e a comparação "e-mail do convite = e-mail que o provedor confirmou"
 * continua existindo, só que contra a linha, no `auth/confirm`. Sem isso, quem é
 * convidado por link curto e cria conta cairia no provisionamento comum e
 * ganharia uma organização fantasma — o defeito que este módulo existe para
 * impedir.
 */
describe("F20-T02 — o signup reconhece o link curto", () => {
  it("token curto (sem ponto) vira convite_curto; token HMAC continua sendo convite; sem convite, provisiona", async () => {
    const { decidirConviteDoSignup } = await import("@/lib/auth/convite-no-signup");
    const { signInviteToken } = await import("@/lib/auth/invite-token");

    const curto = decidirConviteDoSignup({ email: "p@x.test", user_metadata: { invite_token: "aBcD1234_-efGhIj" } });
    expect(curto).toEqual({ tipo: "convite_curto", token: "aBcD1234_-efGhIj" });

    const hmac = signInviteToken({
      invite_id: "11111111-1111-4111-8111-111111111111",
      email: "p@x.test",
      organization_id: "22222222-2222-4222-8222-222222222222",
      role: "agent",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(decidirConviteDoSignup({ email: "p@x.test", user_metadata: { invite_token: hmac } })).toMatchObject({ tipo: "convite" });
    expect(decidirConviteDoSignup({ email: "p@x.test", user_metadata: {} })).toEqual({ tipo: "provisionar" });
    // Lixo que não é nem HMAC nem formato de token curto continua recusado.
    expect(decidirConviteDoSignup({ email: "p@x.test", user_metadata: { invite_token: "não é token" } })).toMatchObject({ tipo: "recusar" });
  });
});
