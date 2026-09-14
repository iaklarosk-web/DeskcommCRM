/**
 * F05-T06 — o calendário do lembrete é PURO e mede o que §5.12 pede: hora
 * LOCAL do tenant (Manaus uma hora atrás de São Paulo), janela por
 * `weekday`+`hour`, e `period_key` como semana ISO da data local — inclusive
 * nas viradas de ano, onde a semana ISO discorda do calendário civil.
 */
import { describe, expect, it } from "vitest";

import { bateAJanela, chaveDoPeriodo, FusoInvalido, horaLocal } from "@/src/reminder/periodo";
import { corpoDoLembrete } from "@/src/reminder/envio";
import { ConfigDoLembreteInvalida, lerConfigDoLembrete } from "@/src/reminder/config";

describe("F05-T06 — horaLocal e a janela", () => {
  it("18:00Z de quinta é 15h em São Paulo e 14h em Manaus — uma hora de diferença, contada", () => {
    const instante = new Date("2026-09-10T18:00:00.000Z");
    const sp = horaLocal(instante, "America/Sao_Paulo");
    const manaus = horaLocal(instante, "America/Manaus");

    expect(sp).toMatchObject({ weekday: 4, hour: 15, year: 2026, month: 9, day: 10 });
    expect(manaus).toMatchObject({ weekday: 4, hour: 14 });
    expect(bateAJanela(sp, { weekday: 4, hour: 15 })).toBe(true);
    expect(bateAJanela(manaus, { weekday: 4, hour: 15 })).toBe(false);
    expect(bateAJanela(horaLocal(new Date("2026-09-10T19:00:00.000Z"), "America/Manaus"), { weekday: 4, hour: 15 })).toBe(true);
    console.info("f05-t06-janela: sp=15h manaus=14h diferenca=1h casos=3/3");
  });

  it("a data local decide o dia: 02:00Z de sexta ainda é quinta 23h em São Paulo", () => {
    const local = horaLocal(new Date("2026-09-11T02:00:00.000Z"), "America/Sao_Paulo");
    expect(local).toMatchObject({ weekday: 4, hour: 23, day: 10 });
  });

  it("fuso inválido é defeito, não UTC em silêncio", () => {
    expect(() => horaLocal(new Date(), "Marte/Olympus")).toThrow(FusoInvalido);
  });
});

describe("F05-T06 — chaveDoPeriodo é a semana ISO da data local", () => {
  const casos: readonly [string, string][] = [
    ["2026-09-10", "2026-W37"],
    ["2026-01-01", "2026-W01"],
    ["2027-01-01", "2026-W53"],
    ["2024-12-30", "2025-W01"],
    ["2021-01-03", "2020-W53"],
    ["2026-12-31", "2026-W53"],
  ];
  it(`${casos.length} datas conhecidas, inclusive as viradas de ano`, () => {
    let ok = 0;
    for (const [data, esperado] of casos) {
      const [y, m, d] = data.split("-").map(Number) as [number, number, number];
      expect(chaveDoPeriodo({ year: y, month: m, day: d, weekday: 0, hour: 0 }), data).toBe(esperado);
      ok += 1;
    }
    console.info(`f05-t06-semana-iso: casos=${ok}/${casos.length}`);
  });
});

describe("F05-T06 — a configuração e o template", () => {
  it("lerConfigDoLembrete aplica o default de §5.2 e recusa fora da faixa", () => {
    const parcial = lerConfigDoLembrete({ enabled: true, weekday: 2 });
    expect(parcial).toMatchObject({ enabled: true, weekday: 2, hour: 15, cutoff_hours: 20, period: "weekly" });
    expect(() => lerConfigDoLembrete({ weekday: 7 })).toThrow(ConfigDoLembreteInvalida);
    expect(() => lerConfigDoLembrete({ hour: 24 })).toThrow(ConfigDoLembreteInvalida);
    expect(() => lerConfigDoLembrete({ cutoff_hours: 0 })).toThrow(ConfigDoLembreteInvalida);
    expect(() => lerConfigDoLembrete("x")).toThrow(ConfigDoLembreteInvalida);
  });

  it("corpoDoLembrete preenche os campos do template e denuncia o ausente com `?`", () => {
    const corpo = corpoDoLembrete("Olá {{customer.name}}! Semana {{period}}: {{last_order.summary}}", {
      nome: "Padaria Fictícia",
      resumoDoUltimoPedido: null,
      period: "2026-W37",
    });
    expect(corpo).toBe("Olá Padaria Fictícia! Semana 2026-W37: ?");
  });
});
