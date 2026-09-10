import { describe, expect, it } from "vitest";

import { prepareCanonicalSeed } from "../../src/tenant-config/canonical-seed";
import { commercialPatchSchema } from "../../src/tenant-config/commercial-schema";

describe("contrato comercial T08", () => {
  it("normaliza somente campos enviados", () => {
    expect(
      commercialPatchSchema.parse({
        settings: {
          "business.phone": "  (11) 99999-0000  ",
          "business.address": "  ",
          "business.delivery_days": [6, 0, 3],
          "business.delivery_regions": [" Centro ", "Zona Sul"],
        },
      }),
    ).toEqual({
      settings: {
        "business.phone": "(11) 99999-0000",
        "business.address": null,
        "business.delivery_days": [0, 3, 6],
        "business.delivery_regions": ["Centro", "Zona Sul"],
      },
    });
  });

  it("recusa patch vazio e chave desconhecida", () => {
    expect(commercialPatchSchema.safeParse({ settings: {} }).success).toBe(
      false,
    );
    expect(
      commercialPatchSchema.safeParse({
        settings: { "business.cutoff": "08:00" },
      }).success,
    ).toBe(false);
  });

  it("recusa duplicatas e limites técnicos", () => {
    expect(
      commercialPatchSchema.safeParse({
        settings: { "business.delivery_days": [0, 0] },
      }).success,
    ).toBe(false);
    expect(
      commercialPatchSchema.safeParse({
        settings: { "business.delivery_regions": ["Centro", " Centro "] },
      }).success,
    ).toBe(false);
    expect(
      commercialPatchSchema.safeParse({
        settings: { "business.phone": "x".repeat(81) },
      }).success,
    ).toBe(false);
    expect(
      commercialPatchSchema.safeParse({
        settings: { "business.cancellation_policy": "x".repeat(2_001) },
      }).success,
    ).toBe(false);
  });

  it("mantém semântica neutra dos campos", () => {
    expect(
      commercialPatchSchema.parse({
        settings: {
          "business.phone": "ramal 7",
          "business.hours": "A combinar",
          "business.delivery_days": [],
          "business.delivery_regions": [],
        },
      }),
    ).toEqual({
      settings: {
        "business.phone": "ramal 7",
        "business.hours": "A combinar",
        "business.delivery_days": [],
        "business.delivery_regions": [],
      },
    });
  });
});

describe("seed canônico T08", () => {
  it("mapeia aliases somente para a forma canônica e normaliza comerciais", () => {
    expect(
      prepareCanonicalSeed({
        business: {
          timezone: "America/Sao_Paulo",
          phone: "  11 3333-4444 ",
          delivery_days: [5, 1],
        },
        branding: {
          name: " Minha marca ",
          primary_color: "#FFF",
          logo_url: "",
        },
      }),
    ).toEqual({
      organization: {
        timezone: "America/Sao_Paulo",
        branding: { app_name: "Minha marca", accent_hex: "#ffffff" },
      },
      settings: {
        business: {
          timezone: "America/Sao_Paulo",
          phone: "11 3333-4444",
          delivery_days: [1, 5],
        },
        branding: {
          name: " Minha marca ",
          primary_color: "#FFF",
          logo_url: "",
        },
      },
    });
  });

  it("preserva TODO sem transformá-lo em dado", () => {
    expect(
      prepareCanonicalSeed({
        business: { timezone: "TODO-DEKA", delivery_days: "TODO-DEKA" },
        branding: { name: "TODO-DEKA", logo_url: "TODO-DEKA" },
      }),
    ).toEqual({
      organization: {},
      settings: {
        business: { timezone: "TODO-DEKA", delivery_days: "TODO-DEKA" },
        branding: { name: "TODO-DEKA", logo_url: "TODO-DEKA" },
      },
    });
  });

  it("recusa URL de logo e configuração comercial fora do contrato", () => {
    expect(() =>
      prepareCanonicalSeed({
        branding: { logo_url: "https://example.invalid/logo.png" },
      }),
    ).toThrow("URL legada não é logo_path");
    expect(() =>
      prepareCanonicalSeed({ business: { delivery_regions: [""] } }),
    ).toThrow("seed.business");
  });
});
