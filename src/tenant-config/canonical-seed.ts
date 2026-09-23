import {
  commercialPatchSchema,
  legacyBrandNameSchema,
  legacyPrimaryColorSchema,
  legacyTimezoneSchema,
} from "./commercial-schema";

export const LEGACY_SETTING_KEYS = new Set([
  "business.timezone",
  "branding.name",
  "branding.primary_color",
  "branding.logo_url",
]);

export type CanonicalOrganizationSeed = {
  timezone?: string;
  branding?: {
    app_name?: string;
    accent_hex?: string;
  };
};

function pending(value: unknown): boolean {
  if (typeof value === "string") return value.startsWith("TODO-");
  if (Array.isArray(value)) return value.some(pending);
  const record = object(value);
  return record ? Object.values(record).some(pending) : false;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Converte apenas configuração de uma organização NOVA. O chamador continua
 * responsável por não aplicar `organization` quando o slug já existe.
 */
export function prepareCanonicalSeed(
  settingsRaw: Record<string, unknown> | undefined,
): {
  settings: Record<string, unknown>;
  organization: CanonicalOrganizationSeed;
} {
  const settings = structuredClone(settingsRaw ?? {});
  const organization: CanonicalOrganizationSeed = {};
  const business = object(settings["business"]);
  const branding = object(settings["branding"]);

  if (business && "timezone" in business && !pending(business["timezone"])) {
    const parsed = legacyTimezoneSchema.safeParse(business["timezone"]);
    if (!parsed.success)
      throw new Error("seed.business.timezone: fuso IANA inválido");
    organization.timezone = parsed.data;
  }

  const canonicalBranding: NonNullable<CanonicalOrganizationSeed["branding"]> =
    {};
  if (branding && "name" in branding && !pending(branding["name"])) {
    const parsed = legacyBrandNameSchema.safeParse(branding["name"]);
    if (!parsed.success) throw new Error("seed.branding.name: nome inválido");
    if (parsed.data !== null) canonicalBranding.app_name = parsed.data;
  }
  if (
    branding &&
    "primary_color" in branding &&
    !pending(branding["primary_color"])
  ) {
    const parsed = legacyPrimaryColorSchema.safeParse(
      branding["primary_color"],
    );
    if (!parsed.success)
      throw new Error("seed.branding.primary_color: cor inválida");
    if (parsed.data !== null) canonicalBranding.accent_hex = parsed.data;
  }
  if (branding && "logo_url" in branding && !pending(branding["logo_url"])) {
    const value = branding["logo_url"];
    if (value !== null && value !== "") {
      throw new Error(
        "seed.branding.logo_url: URL legada não é logo_path; use o upload administrativo depois da criação",
      );
    }
  }
  if (Object.keys(canonicalBranding).length > 0)
    organization.branding = canonicalBranding;

  const commercial: Record<string, unknown> = {};
  for (const key of [
    "phone",
    "address",
    "hours",
    "delivery_days",
    "delivery_regions",
    "cancellation_policy",
  ]) {
    if (!business || !(key in business) || pending(business[key])) continue;
    commercial[`business.${key}`] = business[key];
  }
  if (Object.keys(commercial).length > 0) {
    const parsed = commercialPatchSchema.safeParse({ settings: commercial });
    if (!parsed.success) {
      throw new Error(
        `seed.business: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
      );
    }
    for (const [dotted, value] of Object.entries(parsed.data.settings)) {
      const key = dotted.slice("business.".length);
      if (business) business[key] = value;
    }
  }

  return { settings, organization };
}
