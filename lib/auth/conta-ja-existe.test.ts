import { describe, expect, it } from "vitest";

import { contaJaExiste } from "./conta-ja-existe";

describe("reconhecer 'a conta já existe' — para a tela parar de mandar tentar de novo", () => {
  it("reconhece a mensagem EXATA que a produção devolveu em 24/09", () => {
    // Copiada do api_audit_log: auth.signup_failed, via=convite, 00:45 e 00:46.
    expect(contaJaExiste({ message: "A user with this email address has already been registered" })).toBe(true);
  });

  it("reconhece pelo código, sem depender do texto", () => {
    // O texto do provedor muda de versão; o código é o contrato estável.
    expect(contaJaExiste({ code: "email_exists", message: "qualquer coisa" })).toBe(true);
  });

  it("CONTROLE — outro erro NÃO vira 'já existe'", () => {
    // Sem este caso, qualquer falha viraria "faça login", e quem tem um
    // problema real (banco fora, senha fraca) seria mandado para uma porta que
    // não abre — o mesmo defeito, com outra roupa.
    expect(contaJaExiste({ message: "Database error creating new user", status: 500 })).toBe(false);
    expect(contaJaExiste({ message: "Password should be at least 6 characters" })).toBe(false);
    expect(contaJaExiste(null)).toBe(false);
  });
});
