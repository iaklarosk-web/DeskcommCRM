import { describe, expect, it } from "vitest";

import {
  CanonicalSettingAliasError,
  CanonicalSettingUnavailableError,
  getSetting,
  listSchema,
  setSetting,
} from "../../src/tenant-config";
import type { TenantCtx } from "@/src/tenant-context";

const ctx: TenantCtx = {
  organization_id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  source: "session",
};

function poolForCanonical(
  settings: unknown = {
    branding: {
      app_name: "Canônica",
      accent_hex: "#112233",
      logo_path:
        "11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.png",
    },
  },
) {
  const queries: string[] = [];
  const client = {
    query: async (text: string) => {
      queries.push(text);
      if (text.includes("select timezone,settings")) {
        return {
          rows: [
            {
              timezone: "America/Manaus",
              settings,
            },
          ],
        };
      }
      return { rows: [] };
    },
    release: () => undefined,
  };
  return { pool: { connect: async () => client } as never, queries };
}

describe("fachada de aliases canônicos", () => {
  it("getSetting lê timezone/nome/cor da fonte canônica", async () => {
    const { pool, queries } = poolForCanonical();
    await expect(getSetting(ctx, "business.timezone", { pool })).resolves.toBe(
      "America/Manaus",
    );
    await expect(getSetting(ctx, "branding.name", { pool })).resolves.toBe(
      "Canônica",
    );
    await expect(
      getSetting(ctx, "branding.primary_color", { pool }),
    ).resolves.toBe("#112233");
    expect(
      queries.some((sql) => sql.includes("from public.tenant_settings")),
    ).toBe(false);
  });

  it("deriva branding.logo_url somente de path canônico próprio e base runtime", async () => {
    const { pool } = poolForCanonical();
    await expect(
      getSetting(ctx, "branding.logo_url", {
        pool,
        storageBase: "https://project.test/",
      }),
    ).resolves.toBe(
      "https://project.test/storage/v1/object/public/brand-logos/11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.png",
    );
  });

  it.each([
    "99999999-9999-4999-8999-999999999999/33333333-3333-4333-8333-333333333333.png",
    "11111111-1111-4111-8111-111111111111/invalido.png",
  ])("recusa logo_path estrangeiro ou inválido: %s", async (logoPath) => {
    const { pool } = poolForCanonical({ branding: { logo_path: logoPath } });
    await expect(
      getSetting(ctx, "branding.logo_url", {
        pool,
        storageBase: "https://project.test",
      }),
    ).rejects.toMatchObject({
      code: "canonical_setting_unavailable",
      reason: "invalid_logo_path",
    });
  });

  it("sem base runtime retorna null e não recorre à URL legada", async () => {
    const { pool } = poolForCanonical();
    await expect(
      getSetting(ctx, "branding.logo_url", { pool, storageBase: "" }),
    ).resolves.toBeNull();
  });

  it("não converte organização ausente no default do alias", async () => {
    const client = {
      query: async () => ({ rows: [] }),
      release: () => undefined,
    };
    const pool = { connect: async () => client } as never;
    await expect(
      getSetting(ctx, "business.timezone", { pool }),
    ).rejects.toBeInstanceOf(CanonicalSettingUnavailableError);
  });

  it("setSetting recusa alias antes de abrir conexão e informa destino", async () => {
    const pool = {
      connect: async () => Promise.reject(new Error("não deveria conectar")),
    } as never;
    const error = await setSetting(
      ctx,
      "branding.name",
      "Outra",
      "tenant_admin",
      { pool },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CanonicalSettingAliasError);
    expect(error).toMatchObject({
      code: "canonical_setting_alias",
      key: "branding.name",
      destination: "organizations.settings.branding.app_name",
    });
  });

  it("listSchema declara os quatro destinos sem settings JSON livre", () => {
    expect(
      listSchema()
        .filter((entry) => entry.canonical)
        .map((entry) => [entry.key, entry.canonical]),
    ).toEqual([
      [
        "branding.name",
        {
          destination: "organizations.settings.branding.app_name",
          read: "canonical_value",
        },
      ],
      [
        "branding.logo_url",
        {
          destination: "organizations.settings.branding.logo_path",
          read: "diagnostic_only",
        },
      ],
      [
        "branding.primary_color",
        {
          destination: "organizations.settings.branding.accent_hex",
          read: "canonical_value",
        },
      ],
      [
        "business.timezone",
        { destination: "organizations.timezone", read: "canonical_value" },
      ],
    ]);
  });
});
