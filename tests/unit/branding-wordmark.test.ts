import { describe, expect, it } from "vitest";

import { dividirWordmark } from "@/lib/branding/wordmark";

/**
 * F23: o sufixo "OS" da fachada é uma REGRA sobre um nome que o revendedor
 * controla, e a regra tem de errar para o lado de não pintar nada. Cada caso
 * negativo aqui é um nome real possível de instalação.
 */
describe("dividirWordmark", () => {
  it("separa o sufixo OS quando ele é maiúsculo e vem depois de espaço", () => {
    expect(dividirWordmark("CRM OS")).toEqual({ corpo: "CRM", sufixo: "OS" });
    expect(dividirWordmark("PDV OS")).toEqual({ corpo: "PDV", sufixo: "OS" });
    expect(dividirWordmark("Transportes OS")).toEqual({ corpo: "Transportes", sufixo: "OS" });
  });

  it("ignora espaços nas pontas e mantém o miolo como veio", () => {
    expect(dividirWordmark("  Oferta   OS ")).toEqual({ corpo: "Oferta", sufixo: "OS" });
  });

  it("não pinta a metade de um nome próprio que termina em 'os'", () => {
    // Arrange: nomes que um revendedor pode gravar de verdade.
    const nomes = ["Kairos", "Carlos Móveis", "Atendimentos", "crm os", "CRM Os"];
    // Act
    const resultados = nomes.map(dividirWordmark);
    // Assert: nenhum sufixo, corpo inteiro.
    expect(resultados).toEqual(nomes.map((n) => ({ corpo: n, sufixo: null })));
  });

  it("nome colado ('CRMOS') e 'OS' sozinho ficam inteiros", () => {
    expect(dividirWordmark("CRMOS")).toEqual({ corpo: "CRMOS", sufixo: null });
    expect(dividirWordmark("OS")).toEqual({ corpo: "OS", sufixo: null });
    expect(dividirWordmark("Deskcomm")).toEqual({ corpo: "Deskcomm", sufixo: null });
  });
});
