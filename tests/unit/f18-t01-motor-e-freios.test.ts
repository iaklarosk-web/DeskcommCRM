/**
 * F18 — as três decisões PURAS da fase (ADR-040), cada uma alvo de um mutante.
 *
 * Elas vivem em funções próprias por causa disto: o que decide quem responde
 * ao cliente, o que decide se uma ferramenta que falta vira silêncio, e o que
 * impede a IA de desmarcar o passado precisam poder ser sabotados de propósito
 * e ficar vermelhos. Regra sem mutante é regra que ninguém sabe se está viva.
 */
import { describe, expect, it } from "vitest";

import { declaradasForaDoCatalogo, motorDeclarado } from "@/src/ai";
import { podeCancelar } from "@/src/agenda";

describe("F18-T01 — o motor declarado pela organização", () => {
  it("roteamento pela chave: só `legacy` volta ao motor herdado", () => {
    // Arrange + Act + Assert
    expect(motorDeclarado("legacy")).toBe("legacy");
    expect(motorDeclarado("saas")).toBe("saas");
  });

  it("valor que ninguém reconhece cai no motor NOVO, nunca no herdado", () => {
    // "Não entendi o que está escrito" não pode significar "então responda sem
    // política por ação, sem teto diário e sem auditoria".
    for (const estranho of [null, undefined, "", "vendaval", 7, {}, ["legacy"]]) {
      expect(
        motorDeclarado(estranho),
        `o roteamento caiu no herdado com valor estranho: ${JSON.stringify(estranho)}`,
      ).toBe("saas");
    }
  });
});

describe("F18-T00 — ferramenta declarada e não migrada", () => {
  const heranca = {
    version_id: "00000000-0000-4000-8000-000000000001",
    system_prompt: null,
    fontes: [],
    tools_declaradas: ["crm_search_products", "crm_add_case_note", "crm_close_demand"],
  };

  it("fila de espera: o que a versão declara e o catálogo não cobre aparece", () => {
    // Arrange
    const cobertas = new Set(["crm_search_products"]);

    // Act
    const faltando = declaradasForaDoCatalogo(heranca, cobertas);

    // Assert
    expect([...faltando].sort(), "a ferramenta que falta sumiu em silêncio").toEqual([
      "crm_add_case_note",
      "crm_close_demand",
    ]);
  });

  it("sem agente publicado não há fila: nada foi declarado", () => {
    expect(declaradasForaDoCatalogo(null, new Set())).toEqual([]);
  });
});

describe("F18-T03 — desmarcar o passado", () => {
  const agora = new Date("2026-10-20T12:00:00.000Z");

  it("compromisso passado NÃO é cancelável", () => {
    expect(
      podeCancelar(new Date("2026-10-19T12:00:00.000Z"), agora),
      "o passado foi desmarcado",
    ).toBe(false);
  });

  it("o que começa AGORA também não: já tem gente na sala", () => {
    expect(podeCancelar(new Date(agora), agora)).toBe(false);
  });

  it("o que ainda vai acontecer é cancelável", () => {
    expect(podeCancelar(new Date("2026-10-21T12:00:00.000Z"), agora)).toBe(true);
  });
});
