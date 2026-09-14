import { can, papelD15DoHerdado } from "@/src/rbac/matrix";
import { PAPEIS_HUMANOS, roleAtLeast, type Role } from "@/lib/auth/types";
import type { ServicePool } from "@/src/tenant-context/db";
import {
  withTenant,
  type TenantCtx,
  type TenantDb,
} from "@/src/tenant-context";

import { marcaDaOrganizacaoDeSettings } from "@/lib/branding/organizacao";

import type {
  CommercialProfile,
  CommercialSettingSource,
  CommercialValues,
  Configured,
  LegacyAlias,
} from "./commercial-contract";
import {
  commercialPatchSchema,
  legacyBrandNameSchema,
  legacyLogoKind,
  legacyPrimaryColorSchema,
  legacyTimezoneSchema,
} from "./commercial-schema";
import { SCHEMA_VERSION } from "./schema";

const COMMERCIAL_KEYS = [
  "business.phone",
  "business.address",
  "business.hours",
  "business.delivery_days",
  "business.delivery_regions",
  "business.cancellation_policy",
] as const satisfies readonly (keyof CommercialValues)[];

const ALIAS_KEYS = [
  "business.timezone",
  "branding.name",
  "branding.primary_color",
  "branding.logo_url",
] as const;

type AliasKey = (typeof ALIAS_KEYS)[number];

export type CommercialAccess = {
  /** ID confiável retornado por loadAuthUser; nunca vem do body. */
  support_session_id?: string;
};

export class CommercialSettingsError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "CommercialSettingsError";
  }
}

type AccessFacts = {
  role: string | null;
  organization_active: boolean;
  is_platform_admin: boolean;
  support_mode: "full" | "support_readonly" | null;
};

type SettingRow = {
  key: string;
  value: unknown;
  source: CommercialSettingSource;
  updated_at: Date | string;
};

type ArchiveRow = {
  alias_key: AliasKey;
  source: CommercialSettingSource;
  legacy_updated_at: Date | string;
  destination:
    | "organizations.timezone"
    | "organizations.settings.branding.app_name"
    | "organizations.settings.branding.accent_hex"
    | "organizations.settings.branding.logo_path";
  resolved_at: Date | string;
};

type ProfileRow = {
  legal_name: string;
  display_name: string;
  cnpj: string | null;
  timezone: string;
  currency: string;
  organization_settings: unknown;
  setting_rows: SettingRow[];
  archive_rows: ArchiveRow[];
};

const iso = (value: Date | string): string => new Date(value).toISOString();

async function accessFacts(
  db: TenantDb,
  ctx: TenantCtx,
  access: CommercialAccess,
  lock: boolean,
): Promise<AccessFacts> {
  if (ctx.source !== "session" || !ctx.user_id) {
    throw new CommercialSettingsError("session_context_required", 403);
  }

  const org = await db.query<{ status: string }>(
    `select status from public.organizations where id=$1 ${lock ? "for share" : ""}`,
    [ctx.organization_id],
  );
  if (!org.rows[0] || org.rows[0].status !== "active") {
    throw new CommercialSettingsError("forbidden_tenant", 403);
  }

  const membership = await db.query<{ role: string }>(
    `select role from public.user_organizations
        where organization_id=$1 and user_id=$2
          and accepted_at is not null and revoked_at is null
        limit 1 ${lock ? "for share" : ""}`,
    [ctx.organization_id, ctx.user_id],
  );
  const platform = await db.query(
    `select 1 from public.platform_admins
        where user_id=$1 and revoked_at is null limit 1 ${lock ? "for share" : ""}`,
    [ctx.user_id],
  );
  const support = access.support_session_id
    ? await db.query<{ access_mode: "full" | "support_readonly" }>(
        `select access_mode from public.platform_support_sessions
            where id=$1 and organization_id=$2 and actor_user_id=$3
              and ended_at is null and expires_at>now()
            limit 1 ${lock ? "for share" : ""}`,
        [access.support_session_id, ctx.organization_id, ctx.user_id],
      )
    : { rows: [] };

  if (access.support_session_id && !support.rows[0]) {
    throw new CommercialSettingsError("forbidden_tenant", 403);
  }

  const platformActive = (platform.rowCount ?? 0) > 0;
  if (support.rows[0] && !platformActive) {
    throw new CommercialSettingsError("forbidden_tenant", 403);
  }

  const rawRole = membership.rows[0]?.role;
  const role =
    rawRole && PAPEIS_HUMANOS.includes(rawRole as Role) ? rawRole : null;

  return {
    role,
    organization_active: true,
    is_platform_admin: platformActive,
    support_mode: support.rows[0]?.access_mode ?? null,
  };
}

function capabilities(facts: AccessFacts): CommercialProfile["capabilities"] {
  const supportFull = facts.is_platform_admin && facts.support_mode === "full";
  const supportReadonly = facts.support_mode === "support_readonly";
  const inSupport = facts.support_mode !== null;
  const papel = papelD15DoHerdado(
    facts.role ?? undefined,
    facts.is_platform_admin,
  );
  const adminMember =
    !facts.is_platform_admin && roleAtLeast(facts.role, "admin");
  return {
    can_write_commercial:
      facts.organization_active &&
      (supportFull ||
        (!supportReadonly &&
          !facts.is_platform_admin &&
          can(papel, "settings.manage"))),
    can_edit_organization:
      facts.organization_active &&
      (supportFull || (!inSupport && (facts.is_platform_admin || adminMember))),
    can_edit_branding:
      facts.organization_active &&
      (supportFull || (!inSupport && (facts.is_platform_admin || adminMember))),
  };
}

function storedCommercial<K extends keyof CommercialValues>(
  key: K,
  row: SettingRow | undefined,
): Configured<CommercialValues[K]> {
  const fallback = (
    key === "business.delivery_days" || key === "business.delivery_regions"
      ? []
      : null
  ) as CommercialValues[K];
  if (!row)
    return {
      present: false,
      value: fallback,
      source: "default",
      updated_at: null,
    };

  const parsed = commercialPatchSchema.safeParse({
    settings: { [key]: row.value },
  });
  if (!parsed.success)
    throw new CommercialSettingsError(`invalid_persisted_setting:${key}`, 500);
  return {
    present: true,
    value: parsed.data.settings[key] as CommercialValues[K],
    source: row.source,
    updated_at: iso(row.updated_at),
  };
}

function activeAlias<T>(
  row: SettingRow | undefined,
  archive: ArchiveRow | undefined,
  parser: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
  canonical: T,
): LegacyAlias<T> {
  if (row) {
    const parsed = parser.safeParse(row.value);
    if (!parsed.success)
      return {
        status: "invalid",
        source: row.source,
        updated_at: iso(row.updated_at),
      };
    return {
      status: Object.is(parsed.data, canonical) ? "matches" : "conflicts",
      value: parsed.data,
      source: row.source,
      updated_at: iso(row.updated_at),
    };
  }
  if (!archive) return { status: "absent" };
  return {
    status: "superseded",
    source: archive.source,
    updated_at: iso(archive.legacy_updated_at),
    superseded_at: iso(archive.resolved_at),
    destination: archive.destination,
  };
}

async function readProfile(
  db: TenantDb,
  organizationId: string,
  facts: AccessFacts,
): Promise<CommercialProfile> {
  const result = await db.query<ProfileRow>(
    `select o.legal_name,o.display_name,o.cnpj,o.timezone,o.currency,
            o.settings as organization_settings,
            coalesce((select jsonb_agg(jsonb_build_object(
              'key',s.key,'value',s.value,'source',s.source,'updated_at',s.updated_at))
              from public.tenant_settings s
              where s.organization_id=o.id and s.key=any($2::text[])), '[]'::jsonb) setting_rows,
            coalesce((select jsonb_agg(to_jsonb(a))
                        from public.fn_commercial_alias_resolutions(o.id) a
                       where a.alias_key=any($3::text[])), '[]'::jsonb) archive_rows
       from public.organizations o where o.id=$1`,
    [organizationId, [...COMMERCIAL_KEYS, ...ALIAS_KEYS], ALIAS_KEYS],
  );
  const row = result.rows[0];
  if (!row) throw new CommercialSettingsError("forbidden_tenant", 403);
  const settings = new Map(row.setting_rows.map((item) => [item.key, item]));
  const archives = new Map(
    row.archive_rows.map((item) => [item.alias_key, item]),
  );
  const branding = marcaDaOrganizacaoDeSettings(row.organization_settings);

  const legacyLogo = settings.get("branding.logo_url");
  const archivedLogo = archives.get("branding.logo_url");
  const legacy_logo_url: CommercialProfile["legacy_logo_url"] = legacyLogo
    ? {
        status: legacyLogoKind(legacyLogo.value),
        source: legacyLogo.source,
        updated_at: iso(legacyLogo.updated_at),
      }
    : archivedLogo
      ? {
          status: "superseded",
          source: archivedLogo.source,
          updated_at: iso(archivedLogo.legacy_updated_at),
          superseded_at: iso(archivedLogo.resolved_at),
          destination: "organizations.settings.branding.logo_path",
        }
      : { status: "absent" };

  return {
    settings: Object.fromEntries(
      COMMERCIAL_KEYS.map((key) => [
        key,
        storedCommercial(key, settings.get(key)),
      ]),
    ) as CommercialProfile["settings"],
    organization: {
      legal_name: row.legal_name,
      display_name: row.display_name,
      cnpj: row.cnpj,
      timezone: row.timezone,
      currency: row.currency,
      legacy_timezone: activeAlias(
        settings.get("business.timezone"),
        archives.get("business.timezone"),
        legacyTimezoneSchema,
        row.timezone,
      ),
    },
    branding: {
      app_name: branding?.app_name ?? null,
      accent_hex: branding?.accent_hex ?? null,
      logo_path: branding?.logo_path ?? null,
      legacy_name: activeAlias(
        settings.get("branding.name"),
        archives.get("branding.name"),
        legacyBrandNameSchema,
        branding?.app_name ?? null,
      ),
      legacy_primary_color: activeAlias(
        settings.get("branding.primary_color"),
        archives.get("branding.primary_color"),
        legacyPrimaryColorSchema,
        branding?.accent_hex ?? null,
      ),
    },
    legacy_logo_url,
    capabilities: capabilities(facts),
  };
}

export async function getCommercialProfile(
  ctx: TenantCtx,
  access: CommercialAccess = {},
  options: { pool?: ServicePool } = {},
): Promise<CommercialProfile> {
  return withTenant(
    ctx,
    async (db) => {
      const facts = await accessFacts(db, ctx, access, false);
      if (
        (!facts.role && !facts.support_mode) ||
        (facts.is_platform_admin && !facts.support_mode)
      ) {
        throw new CommercialSettingsError("forbidden_tenant", 403);
      }
      return readProfile(db, ctx.organization_id, facts);
    },
    options,
  );
}

export async function patchCommercialProfile(
  ctx: TenantCtx,
  access: CommercialAccess,
  raw: unknown,
  options: { pool?: ServicePool; requestId?: string } = {},
): Promise<CommercialProfile> {
  const patch = commercialPatchSchema.parse(raw);
  return withTenant(
    ctx,
    async (db) => {
      const facts = await accessFacts(db, ctx, access, true);
      if (!capabilities(facts).can_write_commercial) {
        throw new CommercialSettingsError("forbidden_role", 403);
      }
      const keys = Object.keys(patch.settings) as (keyof CommercialValues)[];
      for (const key of keys) {
        await db.query(
          `insert into public.tenant_settings
             (organization_id,key,value,schema_version,source,updated_by)
           values ($1,$2,$3::jsonb,$5,'tenant_admin',$4)
           on conflict (organization_id,key) do update set
             value=excluded.value,schema_version=excluded.schema_version,
             source=excluded.source,updated_by=excluded.updated_by,updated_at=now()`,
          [
            ctx.organization_id,
            key,
            JSON.stringify(patch.settings[key]),
            ctx.user_id,
            SCHEMA_VERSION,
          ],
        );
      }
      await db.query(
        `insert into public.api_audit_log
          (organization_id,actor_user_id,action,resource_type,resource_id,request_id,bypassed_rls,metadata)
         values ($1,$2,'org.updated','organization',$1,$3,true,$4::jsonb)`,
        [
          ctx.organization_id,
          ctx.user_id,
          options.requestId ?? null,
          JSON.stringify({
            fields_changed: keys,
            source: "commercial_settings",
          }),
        ],
      );
      return readProfile(db, ctx.organization_id, facts);
    },
    options,
  );
}
