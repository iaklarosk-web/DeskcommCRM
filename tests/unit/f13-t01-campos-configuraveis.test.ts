/**
 * F13-T01 (ADR-034 §2) — campos configuráveis por organização: a DEFINIÇÃO
 * (validada pela Setting) e o VALOR (validador único). A prova de banco e a
 * linha `crm:` ficam na integração; aqui o contrato puro, com o mutante 67
 * apontado para "obrigatório sem valor é recusado".
 */
import { describe, expect, it } from "vitest";

import { entradaDoSchema } from "@/src/tenant-config/schema";
import { validar } from "@/src/tenant-config/validators";
import { definicoesDe, MAXIMO_DE_CAMPOS, validarDefinicoes, validarValores } from "@/src/crm/campos";

const DEFS = [
  { key: "segmento", label: "Segmento", type: "select", required: true, options: [{ value: "varejo", label: "Varejo" }, { value: "atacado", label: "Atacado" }] },
  { key: "limite_credito", label: "Limite de crédito", type: "number" },
  { key: "aniversario", label: "Aniversário", type: "date" },
  { key: "site", label: "Site", type: "url" },
  { key: "vip", label: "VIP", type: "boolean" },
] as const;

describe("F13-T01 — definições (tenant_settings crm.fields.*)", () => {
  it("as quatro chaves novas existem no schema com os defaults declarados", () => {
    expect(entradaDoSchema("crm.fields.contacts")).toMatchObject({ tipo: "custom_fields", default: [] });
    expect(entradaDoSchema("crm.fields.companies")).toMatchObject({ tipo: "custom_fields", default: [] });
    expect(entradaDoSchema("crm.distribution")).toMatchObject({ tipo: "enum", default: "manual", valores: ["manual", "round_robin"] });
    expect(entradaDoSchema("crm.queue_roles")).toMatchObject({ tipo: "string_array", default: ["attendant"] });
  });

  it("lista válida passa pela Setting; lista inválida é recusada com motivo", () => {
    const entrada = entradaDoSchema("crm.fields.companies")!;
    expect(validar(entrada, [...DEFS])).toBeNull();
    expect(validar(entrada, "não é lista")).toMatch(/lista/);
    expect(validar(entrada, [{ key: "1abc", label: "x", type: "text" }])).toMatch(/campo 0/);
    expect(validar(entrada, [DEFS[1], { ...DEFS[1], key: "LIMITE_CREDITO" }])).toMatch(/repetida/);
    expect(validar(entrada, [{ key: "uf", label: "UF", type: "select" }])).toMatch(/exige options/);
    expect(validarDefinicoes(Array.from({ length: MAXIMO_DE_CAMPOS + 1 }, (_, i) => ({ key: `c${i}`, label: `c${i}`, type: "text" })))).toMatch(/no máximo 50/);
  });

  it("definição gravada com lixo é descartada na leitura, nunca aplicada", () => {
    expect(definicoesDe([DEFS[0], { key: "", label: "x", type: "text" }, 7])).toHaveLength(1);
    expect(definicoesDe(null)).toEqual([]);
  });
});

describe("F13-T01 — valores (validador único)", () => {
  it("obrigatório sem valor é recusado", () => {
    const r = validarValores([...DEFS], { limite_credito: 10 });
    const motivos = r.ok ? [] : r.erros.map((e) => `${e.key}:${e.motivo}`);
    // A mensagem de falha é o que o mutante 67 lê: motivo por extenso.
    expect(motivos.join(","), `esperava exatamente segmento:required, veio ${motivos.join(",") || "ok"}`).toBe("segmento:required");
  });

  it("tipo e opção fora do contrato são recusados, cada um com o motivo", () => {
    const r = validarValores([...DEFS], { segmento: "outro", limite_credito: "dez", aniversario: "14/09", site: "sem-esquema", vip: "sim" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erros).toEqual([
        { key: "segmento", motivo: "option" },
        { key: "limite_credito", motivo: "type" },
        { key: "aniversario", motivo: "type" },
        { key: "site", motivo: "type" },
        { key: "vip", motivo: "type" },
      ]);
    }
  });

  it("valor válido passa e chave SEM definição é preservada (apagar definição não apaga valor)", () => {
    const valores = { segmento: "varejo", limite_credito: 5000, aniversario: "2026-09-14", site: "https://exemplo.test", vip: true, campo_antigo: "ficou" };
    const r = validarValores([...DEFS], valores);
    expect(r).toEqual({ ok: true, valores });
    const semDefinicao = validarValores([], valores);
    expect(semDefinicao).toEqual({ ok: true, valores });
  });

  it("multiselect confere cada item contra as opções", () => {
    const def = [{ key: "canais", label: "Canais", type: "multiselect", options: [{ value: "wa", label: "WhatsApp" }, { value: "site", label: "Site" }] }] as const;
    expect(validarValores([...def], { canais: ["wa", "site"] }).ok).toBe(true);
    expect(validarValores([...def], { canais: ["wa", "ig"] })).toEqual({ ok: false, erros: [{ key: "canais", motivo: "option" }] });
  });
});
