import { afterEach, describe, expect, it, vi } from "vitest";

import { esquecerEmail, lembrarEmail, lerEmailLembrado } from "@/lib/auth/lembrar-email";

/**
 * F23: "Lembrar meu e-mail neste aparelho". Guarda o e-mail, nunca a senha, e
 * nunca quebra a tela de entrar quando o storage não coopera.
 */
describe("lembrar e-mail na tela de entrar", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("guarda o e-mail e o devolve na próxima visita, sem espaços nas pontas", () => {
    // Arrange
    lembrarEmail("  ana@exemplo.test ");
    // Act
    const lido = lerEmailLembrado();
    // Assert
    expect(lido).toBe("ana@exemplo.test");
    expect(window.localStorage.getItem("deskcomm-lembrar-email")).toBe("ana@exemplo.test");
  });

  it("esquecer apaga, e ler depois devolve null", () => {
    lembrarEmail("ana@exemplo.test");
    esquecerEmail();
    expect(lerEmailLembrado()).toBeNull();
    expect(window.localStorage.getItem("deskcomm-lembrar-email")).toBeNull();
  });

  it("não guarda vazio nem valor maior que um endereço pode ter", () => {
    lembrarEmail("   ");
    expect(window.localStorage.getItem("deskcomm-lembrar-email")).toBeNull();
    lembrarEmail(`${"a".repeat(250)}@exemplo.test`);
    expect(window.localStorage.getItem("deskcomm-lembrar-email")).toBeNull();
  });

  it("valor corrompido no storage (sem @) não preenche o campo", () => {
    window.localStorage.setItem("deskcomm-lembrar-email", "<script>alert(1)</script>");
    expect(lerEmailLembrado()).toBeNull();
  });

  it("storage bloqueado (janela privada, cota) não lança: a tela segue sem lembrar", () => {
    // Arrange: getItem e setItem explodem como num navegador com storage negado (G-07).
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    // Act + Assert
    expect(() => lembrarEmail("ana@exemplo.test")).not.toThrow();
    expect(lerEmailLembrado()).toBeNull();
    expect(() => esquecerEmail()).not.toThrow();
  });

  it("a chave nunca guarda senha: só existe UMA chave, e ela é o e-mail", () => {
    lembrarEmail("ana@exemplo.test");
    const chaves = Object.keys(window.localStorage).filter((k) => k.includes("lembrar"));
    expect(chaves).toEqual(["deskcomm-lembrar-email"]);
    expect(chaves.some((k) => /senha|password/i.test(k))).toBe(false);
  });
});
