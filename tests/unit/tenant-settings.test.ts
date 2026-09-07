/**
 * F01-T05 — tenant-settings (§5.2, D21), contra o módulo REAL com pool fake.
 *
 * Os números do DoD são DERIVADOS do schema na hora (nunca digitados): N =
 * uma entrada inválida por chave (tipo errado ou fora do enum, gerada do
 * `tipo` da entrada), D = chaves com default. Prova também: chave desconhecida
 * = UnknownSettingError + settings_rejected, a regra de merge (template não
 * sobrescreve tenant_admin) no SQL do upsert, e a sentinela TODO-DEKA do
 * validateSeed (aceita, sem checagem de tipo, contada em seed_todos).
 */
import { describe, expect, it } from "vitest";

import { counterTotal, resetCounters } from "@/src/obs/counters";
import {
  getSetting,
  InvalidSettingError,
  listSchema,
  REMINDER_DEFAULT,
  SCHEMA_VERSION,
  setSetting,
  UnknownSettingError,
  validateSeed,
  type TipoDeSetting,
} from "@/src/tenant-config";
import type { TenantCtx } from "@/src/tenant-context";

const ORG = "22222222-2222-4222-8222-222222222222";
const ctx: TenantCtx = { organization_id: ORG, source: "session" };

/** Pool fake transacional: devolve `rows` para o SELECT do getSetting. */
function fakePool(rows: Array<{ value: unknown }> = []) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const client = {
    query: vi_query(queries, rows),
    release: () => undefined,
  };
  return { pool: { connect: async () => client } as never, queries };
}

function vi_query(
  registro: Array<{ text: string; values?: unknown[] }>,
  rows: Array<{ value: unknown }>,
) {
  return async (text: string, values?: unknown[]) => {
    registro.push({ text, values });
    return /select value from public\.tenant_settings/.test(text) ? { rows } : { rows: [] };
  };
}

/** Um valor INVÁLIDO por tipo — o gêmeo errado do validador. */
function invalidoPara(tipo: TipoDeSetting): unknown {
  switch (tipo) {
    case "string":
      return 123;
    case "string_nullable":
      return 123;
    case "boolean":
      return "sim";
    case "int":
      return "muitos";
    case "number01":
      return 2;
    case "int_array":
      return [1, "dois"];
    case "string_array":
      return "não-é-lista";
    case "enum":
      return "__fora_do_vocabulario__";
    case "reminder":
      return { weekday: 9 };
  }
}

describe("tenant-settings", () => {
  it(`schema_version=${SCHEMA_VERSION} e toda chave tem default e validador (invariante 1)`, () => {
    // Arrange + Act
    const schema = listSchema();

    // Assert — D/D: todas as chaves declaram default (null é default legítimo)
    expect(SCHEMA_VERSION).toBe(1);
    expect(schema.length).toBeGreaterThanOrEqual(24);
    const semDefault = schema.filter((e) => e.default === undefined);
    expect(semDefault.map((e) => e.key), "chave sem default").toEqual([]);
    const enumSemValores = schema.filter((e) => e.tipo === "enum" && !e.valores?.length);
    expect(enumSemValores.map((e) => e.key), "enum sem vocabulário").toEqual([]);
  });

  it("defaults_applied D/D: getSetting sem linha no banco devolve o default de CADA chave", async () => {
    // Arrange
    const { pool } = fakePool([]);

    // Act + Assert — derivado do schema, uma chave por vez
    for (const entrada of listSchema()) {
      const valor = await getSetting(ctx, entrada.key, { pool });
      expect(valor, entrada.key).toEqual(entrada.default);
    }
  });

  it("o default de objeto sai por CÓPIA — mutar o que se leu não envenena o schema", async () => {
    // Arrange
    const { pool } = fakePool([]);

    // Act
    const lido = (await getSetting(ctx, "orders.recurring_reminder", { pool })) as {
      enabled: boolean;
    };
    lido.enabled = true;
    const relido = (await getSetting(ctx, "orders.recurring_reminder", { pool })) as {
      enabled: boolean;
    };

    // Assert
    expect(relido.enabled).toBe(false);
    expect(REMINDER_DEFAULT.enabled).toBe(false);
  });

  it("invalid_rejected N/N: uma entrada inválida por chave é recusada SEM tocar o banco", async () => {
    // Arrange
    const schema = listSchema();
    let rejeitadas = 0;

    // Act
    for (const entrada of schema) {
      const { pool, queries } = fakePool();
      const promessa = setSetting(ctx, entrada.key, invalidoPara(entrada.tipo), "tenant_admin", {
        pool,
      });
      await expect(promessa, entrada.key).rejects.toBeInstanceOf(InvalidSettingError);
      expect(queries, `${entrada.key}: escreveu apesar de inválido`).toEqual([]);
      rejeitadas += 1;
    }

    // Assert — N/N
    expect(rejeitadas).toBe(schema.length);
  });

  it("setSetting válido grava com a regra de merge no upsert (template não sobrescreve tenant_admin)", async () => {
    // Arrange
    const { pool, queries } = fakePool();

    // Act
    await setSetting(ctx, "ai.enabled", false, "template", { pool });

    // Assert — o WHERE do upsert É a regra
    const upsert = queries.find((q) => q.text.includes("insert into public.tenant_settings"));
    expect(upsert).toBeDefined();
    expect(upsert?.text).toContain("on conflict (organization_id, key) do update");
    expect(upsert?.text.replaceAll(/\s+/g, " ")).toContain(
      "where not (tenant_settings.source = 'tenant_admin' and excluded.source = 'template')",
    );
    expect(upsert?.values?.[4]).toBe("template");
  });

  it("chave desconhecida = UnknownSettingError + settings_rejected (invariante 2)", async () => {
    // Arrange
    resetCounters();
    const { pool } = fakePool();

    // Act + Assert
    await expect(getSetting(ctx, "grupo.que_nao_existe", { pool })).rejects.toBeInstanceOf(
      UnknownSettingError,
    );
    await expect(
      setSetting(ctx, "outra.fantasma", true, "seed", { pool }),
    ).rejects.toBeInstanceOf(UnknownSettingError);
    expect(counterTotal("settings_rejected")).toBe(2);
  });

  it("validateSeed: TODO-DEKA é aceito sem checagem de tipo e contado em seed_todos (invariante 3)", () => {
    // Arrange — weekday como sentinela teria tipo errado se fosse validado
    const seed = {
      settings: {
        branding: { name: "TODO-DEKA", primary_color: "TODO-DEKA (perguntado em 2026-09-05, não sabe)" },
        business: { timezone: "America/Sao_Paulo" },
        "orders.recurring_reminder": {
          enabled: true,
          weekday: "TODO-DEKA",
          hour: 15,
          cutoff_hours: 20,
          message_template: "Oi {{customer.name}} — {{last_order.summary}}",
          period: "weekly",
        },
      },
    };

    // Act
    const resultado = validateSeed(seed);

    // Assert
    expect(resultado.errors).toEqual([]);
    expect(resultado.seed_todos).toBe(3);
  });

  it("validateSeed: chave fora do schema vira erro nomeado, valor errado vira frase de gente", () => {
    // Arrange
    const seed = {
      settings: {
        branding: { cor_favorita: "azul" },
        ai: { confidence_threshold: 7 },
      },
    };

    // Act
    const resultado = validateSeed(seed);

    // Assert
    expect(resultado.errors).toHaveLength(2);
    expect(resultado.errors[0]).toContain("branding.cor_favorita");
    expect(resultado.errors[1]).toContain("ai.confidence_threshold");
    expect(resultado.errors[1]).toContain("entre 0 e 1");
  });

  it("validateSeed aceita o settings completo do demo2 (forma da §5.21) com 0 erros", () => {
    // Arrange — a MESMA forma do docs/tenants/demo2.seed.yaml, transcrita
    const seed = {
      settings: {
        branding: { name: "Demo Manutenção", logo_url: "", primary_color: "#2A6F4E" },
        business: {
          timezone: "America/Sao_Paulo",
          phone: "+5500000000002",
          address: "Rua Demo, 1",
          hours: "08-18",
          delivery_days: [1, 3, 5],
          delivery_regions: ["centro"],
          cancellation_policy: "até 24h antes",
        },
        "orders.recurring_reminder": {
          enabled: true,
          weekday: 4,
          hour: 15,
          cutoff_hours: 20,
          period: "weekly",
          message_template: "Olá {{customer.name}}, qual a quantidade desta semana?",
        },
        ai: {
          enabled: true,
          system_prompt: "Você atende a Demo Manutenção...",
          unknown_answer: "Não tenho essa informação; vou chamar alguém da equipe.",
          confidence_threshold: 0.6,
        },
      },
    };

    // Act
    const resultado = validateSeed(seed);

    // Assert
    expect(resultado.errors).toEqual([]);
    expect(resultado.seed_todos).toBe(0);
  });
});
