/** Contrato serializavel de GET/PATCH /api/v1/settings/commercial. */

export type CommercialValues = {
  "business.phone": string | null;
  "business.address": string | null;
  "business.hours": string | null;
  "business.delivery_days": number[];
  "business.delivery_regions": string[];
  "business.cancellation_policy": string | null;
};

export type CommercialPatch = {
  settings: Partial<CommercialValues>;
};

export type CommercialSettingSource = "seed" | "tenant_admin" | "template";

/**
 * `present` fala da existencia da linha, sem fundir ausencia com null ou [].
 * A uniao impede combinacoes impossiveis como source=seed com present=false.
 */
export type Configured<T> =
  | {
      present: false;
      value: T;
      source: "default";
      updated_at: null;
    }
  | {
      present: true;
      value: T;
      source: CommercialSettingSource;
      updated_at: string;
    };

export type LegacyAliasDestination =
  | "organizations.timezone"
  | "organizations.settings.branding.app_name"
  | "organizations.settings.branding.accent_hex"
  | "organizations.settings.branding.logo_path";

export type LegacyAlias<T> =
  | { status: "absent" }
  | {
      status: "invalid";
      source: CommercialSettingSource;
      updated_at: string;
    }
  | {
      status: "matches" | "conflicts";
      value: T;
      source: CommercialSettingSource;
      updated_at: string;
    }
  | {
      status: "superseded";
      source: CommercialSettingSource;
      updated_at: string;
      superseded_at: string;
      destination: LegacyAliasDestination;
    };

/** A URL antiga nunca atravessa o contrato e nunca vira src/href. */
export type LegacyLogoUrlDiagnostic =
  | { status: "absent" }
  | {
      status: "empty" | "invalid" | "unsupported_url";
      source: CommercialSettingSource;
      updated_at: string;
    }
  | {
      status: "superseded";
      source: CommercialSettingSource;
      updated_at: string;
      superseded_at: string;
      destination: "organizations.settings.branding.logo_path";
    };

export type CommercialProfile = {
  settings: {
    [K in keyof CommercialValues]: Configured<CommercialValues[K]>;
  };
  organization: {
    legal_name: string;
    display_name: string;
    cnpj: string | null;
    timezone: string;
    currency: string;
    legacy_timezone: LegacyAlias<string>;
  };
  branding: {
    app_name: string | null;
    accent_hex: string | null;
    logo_path: string | null;
    legacy_name: LegacyAlias<string | null>;
    legacy_primary_color: LegacyAlias<string | null>;
  };
  legacy_logo_url: LegacyLogoUrlDiagnostic;
  capabilities: {
    can_write_commercial: boolean;
    can_edit_organization: boolean;
    can_edit_branding: boolean;
  };
};
