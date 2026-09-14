/**
 * F15-T01 — política por ação (ADR-036 §1/§4, D54 b), sem banco.
 *
 * O que se mede aqui: o validador do tipo `action_policy` (chave fora do
 * catálogo e modo fora do enum recusados), o modo EFETIVO por ação com a
 * política vazia (é o D33 de hoje, ação por ação — os defaults declarados da
 * ADR-036 §4), a sobrescrita da organização, e o que a política NÃO abre
 * (ação só humana continua `block` mesmo com entrada `allow`).
 *
 * Alvo do mutante 70 (`block` tratado como `allow` em `modoEfetivo`): o caso
 * "block nega e audita" abaixo.
 */
import { describe, expect, it } from "vitest";

import { ACTION_CATALOG } from "@/src/actions/catalog";
import { modoDeD33, modoEfetivo, POLITICA_PADRAO, tabelaDaPolitica, validarPolitica } from "@/src/actions/politica";

/** ADR-036 §4: o modo efetivo de cada ação para a IA, sem entrada da organização, com `confirm_from_risk=medium`. */
const DEFAULTS_DECLARADOS: Record<string, "allow" | "approve" | "block" | "transfer"> = {
  get_customer: "allow",
  search_products: "allow",
  get_orders: "allow",
  create_order: "approve",
  update_order_quantity: "approve",
  create_task: "allow",
  transfer_to_human: "allow",
  request_confirmation: "allow",
  send_message: "allow",
  resume_ai: "block", // só humana (D34): a IA não devolve a conversa a si mesma
  export_customer_data: "block",
  assign_owner: "block", // automação e humano (F15-T04): a IA não escolhe quem vende
  delete_customer_data: "block",
};

describe("F15-T01 — validador do tipo action_policy", () => {
  it("aceita objeto vazio e entradas do catálogo; recusa lista, ação fora do catálogo e modo fora do enum", () => {
    // Arrange + Act
    const casos: Array<[unknown, boolean]> = [
      [{}, true],
      [{ create_task: "allow", create_order: "transfer" }, true],
      [[], false],
      [null, false],
      [{ drop_database: "allow" }, false],
      [{ create_task: "maybe" }, false],
      [{ create_task: 1 }, false],
    ];
    const resultados = casos.map(([valor, esperado]) => (validarPolitica(valor) === null) === esperado);
    // Assert
    expect(resultados.every(Boolean), casos.map(([v]) => JSON.stringify(v)).join(" | ")).toBe(true);
    expect(validarPolitica({ drop_database: "allow" })).toMatch(/fora do catálogo/);
    expect(validarPolitica({ create_task: "maybe" })).toMatch(/allow, approve, block, transfer/);
    console.info(`f15-t01-validador: casos=${resultados.length}/${casos.length}`);
  });
});

describe("F15-T01 — o modo efetivo por ação", () => {
  it("com a política vazia, cada ação do catálogo tem o default declarado da ADR-036 §4 (o D33 de hoje)", () => {
    // Arrange
    const tabela = tabelaDaPolitica("ai", POLITICA_PADRAO, "medium");
    // Act
    const efetivos = Object.fromEntries(tabela.map((l) => [l.action, l.mode]));
    // Assert — contagem, não amostra: as 13 do catálogo, uma a uma.
    expect(tabela).toHaveLength(ACTION_CATALOG.length);
    expect(efetivos).toEqual(DEFAULTS_DECLARADOS);
    expect(tabela.every((l) => l.source === "padrão")).toBe(true);
    console.info(`f15-t01-defaults: actions=${tabela.length}/${ACTION_CATALOG.length} matched=${Object.keys(DEFAULTS_DECLARADOS).length}/${ACTION_CATALOG.length}`);
  });

  it("relaxar actions.confirm_from_risk para high (D33) faz create_order virar allow sem entrada na política", () => {
    expect(modoEfetivo("create_order", "ai", POLITICA_PADRAO, "high")?.mode).toBe("allow");
    expect(modoEfetivo("create_order", "ai", POLITICA_PADRAO, "medium")?.mode).toBe("approve");
    expect(modoEfetivo("create_order", "ai", POLITICA_PADRAO, "lixo")?.mode).toBe("approve");
  });

  // Título curto DE PROPÓSITO: é o alvo do mutante 70 (`-t` exato).
  it("block nega e audita", () => {
    // Arrange
    const politica = { create_task: "block", create_order: "transfer", send_message: "approve" } as const;
    // Act
    const tarefa = modoEfetivo("create_task", "ai", politica, "medium");
    const pedido = modoEfetivo("create_order", "ai", politica, "medium");
    const mensagem = modoEfetivo("send_message", "ai", politica, "medium");
    // Assert
    expect(tarefa).toMatchObject({ mode: "block", source: "organização", configurable: true });
    expect(pedido).toMatchObject({ mode: "transfer", source: "organização" });
    expect(mensagem).toMatchObject({ mode: "approve", source: "organização" });
    console.info(`f15-t01-sobrescrita: overridden=3/3 block=${tarefa?.mode === "block" ? 1 : 0}/1`);
  });

  it("a política não abre o que o catálogo fecha: allow em ação só humana continua block e não é configurável", () => {
    const soHumana = modoEfetivo("delete_customer_data", "ai", { delete_customer_data: "allow" }, "medium");
    expect(soHumana).toMatchObject({ mode: "block", source: "padrão", configurable: false });
    const resumo = modoEfetivo("resume_ai", "automation", { resume_ai: "allow" }, "medium");
    expect(resumo).toMatchObject({ mode: "block", configurable: false });
    expect(modoEfetivo("drop_database", "ai", POLITICA_PADRAO, "medium")).toBeNull();
  });

  it("modoDeD33 cobre os quatro casos do catálogo: só humana, none, always e by_risk", () => {
    const entrada = (patch: Partial<(typeof ACTION_CATALOG)[number]>) => ({ ...ACTION_CATALOG[0]!, ...patch });
    expect(modoDeD33(entrada({ executors: ["human"] }), "ai", "medium")).toBe("block");
    expect(modoDeD33(entrada({ confirmation: "none" }), "ai", "medium")).toBe("allow");
    expect(modoDeD33(entrada({ confirmation: "always" }), "ai", "medium")).toBe("approve");
    expect(modoDeD33(entrada({ confirmation: "by_risk", risk: "medium" }), "ai", "medium")).toBe("approve");
    expect(modoDeD33(entrada({ confirmation: "by_risk", risk: "low" }), "ai", "medium")).toBe("allow");
  });
});
