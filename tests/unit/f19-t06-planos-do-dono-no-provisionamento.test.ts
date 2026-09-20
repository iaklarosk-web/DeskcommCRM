/**
 * F19-T06 (ADR-044 §3; D58 b): o provisionamento no Stripe lê os planos do
 * DONO quando os três são `source='owner'` — nome real, preço real em centavos
 * — e só cai nos placeholders de D57 d quando falta decisão; e um preço
 * antigo de um Product entra em `STRIPE_PRICE_IDS` DEPOIS do vigente
 * (objeção 2 do contraponto): o webhook aceita quem assinou no preço antigo,
 * o Checkout continua oferecendo só o vigente.
 */
import { describe, expect, it } from "vitest";

import { lerListaDePrecos, precoDoPlano } from "@/src/billing/gateway/stripe";
import { montarListaDePrecos, PLANOS_PLACEHOLDER, planosAProvisionar, type LinhaDePlano } from "@/src/billing/provisionar";

const DONO: readonly LinhaDePlano[] = [
  { code: "PLAN_A", name: "Essencial", price_cents: 19700, currency: "BRL", source: "owner", active: true },
  { code: "PLAN_B", name: "Profissional", price_cents: 59700, currency: "BRL", source: "owner", active: true },
  { code: "PLAN_C", name: "Empresarial", price_cents: 149700, currency: "BRL", source: "owner", active: true },
];

describe("F19-T06 — planos do dono no provisionamento", () => {
  it("planos do dono viram os Products com nome e preço reais — nunca placeholder", () => {
    const r = planosAProvisionar(DONO);
    expect(r.origem).toBe("owner");
    expect(r.planos).toEqual([
      { plan_code: "PLAN_A", nome: "Essencial", unit_amount: 19700, currency: "brl", interval: "month" },
      { plan_code: "PLAN_B", nome: "Profissional", unit_amount: 59700, currency: "brl", interval: "month" },
      { plan_code: "PLAN_C", nome: "Empresarial", unit_amount: 149700, currency: "brl", interval: "month" },
    ]);
    expect(r.planos.some((p) => p.nome.includes("placeholder"))).toBe(false);
    console.info(`f19-t06-provision: planos_owner=${r.planos.length}/3 placeholder_no_nome=0/3`);
  });

  it("um placeholder entre os três devolve a lista placeholder INTEIRA — nunca mistura", () => {
    const misto = [DONO[0]!, DONO[1]!, { ...DONO[2]!, source: "placeholder" as const, price_cents: 0, name: "PLAN_C" }];
    const r = planosAProvisionar(misto);
    expect(r.origem).toBe("placeholder");
    expect(r.planos).toEqual(PLANOS_PLACEHOLDER);
    const vazio = planosAProvisionar([]);
    expect(vazio.origem).toBe("placeholder");
    console.info("f19-t06-provision: misto_vira_placeholder=1/1 vazio_vira_placeholder=1/1");
  });

  it("preço do dono com valor zero ou inativo não é provisionado como owner", () => {
    const zero = planosAProvisionar(DONO.map((p) => (p.code === "PLAN_B" ? { ...p, price_cents: 0 } : p)));
    const inativo = planosAProvisionar(DONO.map((p) => (p.code === "PLAN_A" ? { ...p, active: false } : p)));
    expect(zero.origem).toBe("placeholder");
    expect(inativo.origem).toBe("placeholder");
    console.info("f19-t06-provision: zero_recusado=1/1 inativo_recusado=1/1");
  });

  it("preço antigo entra depois do vigente na lista e o Checkout continua oferecendo o vigente (legado_aceito=1/1 vigente_no_checkout=1/1)", () => {
    const lista = montarListaDePrecos([
      { plan_code: "PLAN_A", price: "price_1Anovo", precos_legado: ["price_1Avelho"] },
      { plan_code: "PLAN_B", price: "price_1B", precos_legado: [] },
      { plan_code: "PLAN_C", price: "price_1C", precos_legado: ["price_1Cv1", "price_1Cv2"] },
    ]);
    expect(lista).toBe("price_1Anovo:PLAN_A,price_1B:PLAN_B,price_1C:PLAN_C,price_1Avelho:PLAN_A,price_1Cv1:PLAN_C,price_1Cv2:PLAN_C");
    const mapa = lerListaDePrecos(lista);
    expect(mapa.get("price_1Avelho")).toBe("PLAN_A"); // o webhook aceita o preço antigo
    expect(precoDoPlano(mapa, "PLAN_A")).toBe("price_1Anovo"); // o Checkout oferece o vigente
    expect(precoDoPlano(mapa, "PLAN_C")).toBe("price_1C");
    console.info("f19-t06-legado: legado_aceito=1/1 vigente_no_checkout=1/1 ordem=1/1");
  });
});
