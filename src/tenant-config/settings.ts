/**
 * getSetting / setSetting / listSchema (§5.2) — o único caminho até
 * `tenant_settings` (invariante 4). O acesso ao banco passa por withTenant
 * (§5.1): a leitura sai escopada pela transação com o GUC do tenant, e um
 * esquecimento de filtro aqui não vira vazamento — vira linha nenhuma.
 */
import { incrementCounter } from "@/src/obs/counters";
import type { ServicePool } from "@/src/tenant-context/db";
import { withTenant, type TenantCtx } from "@/src/tenant-context";
import { marcaDaOrganizacaoDeSettings } from "@/lib/branding/organizacao";
import {
  baseDoStorage,
  caminhoBateComPrefixo,
  prefixoDaOrganizacao,
  urlPublicaDoLogo,
} from "@/lib/branding/logo";

import {
  entradaDoSchema,
  SCHEMA_VERSION,
  SETTINGS_SCHEMA,
  type SettingEntry,
} from "./schema";
import { validar } from "./validators";

export class UnknownSettingError extends Error {
  constructor(public readonly key: string) {
    super(
      `setting desconhecida: ${key} (a lista única é src/tenant-config/schema.ts)`,
    );
    this.name = "UnknownSettingError";
  }
}

export class InvalidSettingError extends Error {
  constructor(
    public readonly key: string,
    public readonly motivo: string,
  ) {
    super(`valor inválido para ${key}: ${motivo}`);
    this.name = "InvalidSettingError";
  }
}

export class CanonicalSettingAliasError extends Error {
  public readonly code = "canonical_setting_alias";

  constructor(
    public readonly key: string,
    public readonly destination: NonNullable<
      SettingEntry["canonical"]
    >["destination"],
  ) {
    super(`setting ${key} é alias somente leitura; grave em ${destination}`);
    this.name = "CanonicalSettingAliasError";
  }
}

export class CanonicalSettingUnavailableError extends Error {
  public readonly code = "canonical_setting_unavailable";

  constructor(
    public readonly key: string,
    public readonly reason: "organization_not_found" | "invalid_logo_path",
  ) {
    super(`fonte canônica indisponível para ${key}: ${reason}`);
    this.name = "CanonicalSettingUnavailableError";
  }
}

export type SettingSource = "seed" | "tenant_admin" | "template";

interface Deps {
  /** Repassado ao withTenant; teste injeta o pool fake por aqui. */
  pool?: ServicePool;
  /** Base explícita só na fronteira de teste; runtime usa baseDoStorage(). */
  storageBase?: string;
}

function rawLogoPath(settings: unknown): unknown {
  if (
    typeof settings !== "object" ||
    settings === null ||
    Array.isArray(settings)
  ) {
    return undefined;
  }
  const branding = (settings as Record<string, unknown>).branding;
  if (
    typeof branding !== "object" ||
    branding === null ||
    Array.isArray(branding)
  ) {
    return undefined;
  }
  return (branding as Record<string, unknown>).logo_path;
}

function exigirEntrada(key: string): SettingEntry {
  const entrada = entradaDoSchema(key);
  if (!entrada) {
    incrementCounter("settings_rejected", { reason: "unknown_key" });
    throw new UnknownSettingError(key);
  }
  return entrada;
}

export async function getSetting(
  ctx: TenantCtx,
  key: string,
  deps: Deps = {},
): Promise<unknown> {
  const entrada = exigirEntrada(key);
  const valor = await withTenant(
    ctx,
    async (db) => {
      if (entrada.canonical) {
        const r = await db.query<{ timezone: string; settings: unknown }>(
          `select timezone,settings from public.organizations where id=$1`,
          [ctx.organization_id],
        );
        const org = r.rows[0];
        if (!org) {
          throw new CanonicalSettingUnavailableError(
            key,
            "organization_not_found",
          );
        }
        if (key === "business.timezone") return org.timezone;
        const branding = marcaDaOrganizacaoDeSettings(org.settings);
        if (key === "branding.name") return branding?.app_name ?? null;
        if (key === "branding.primary_color")
          return branding?.accent_hex ?? null;
        if (key === "branding.logo_url") {
          const path = rawLogoPath(org.settings);
          if (path === undefined || path === null || path === "") return null;
          const prefix = prefixoDaOrganizacao(ctx.organization_id);
          if (
            typeof path !== "string" ||
            !caminhoBateComPrefixo(path, prefix)
          ) {
            throw new CanonicalSettingUnavailableError(
              key,
              "invalid_logo_path",
            );
          }
          // Mesma semântica do resolvedor: sem base runtime não se fabrica URL
          // relativa. O alias retorna ausência e nunca consulta a URL legada.
          const base = deps.storageBase ?? baseDoStorage();
          return base.length > 0 ? urlPublicaDoLogo(path, base) : null;
        }
      }
      const r = await db.query<{ value: unknown }>(
        `select value from public.tenant_settings
          where organization_id = $1 and key = $2`,
        [ctx.organization_id, key],
      );
      return r.rows[0]?.value;
    },
    deps,
  );
  if (valor === undefined) {
    // Default por CÓPIA: objeto default mutado por quem leu não pode virar o
    // default de todo mundo (imutabilidade).
    return structuredClone(entrada.default);
  }
  return valor;
}

export async function setSetting(
  ctx: TenantCtx,
  key: string,
  value: unknown,
  source: SettingSource,
  deps: Deps = {},
): Promise<void> {
  const entrada = exigirEntrada(key);
  if (entrada.canonical) {
    incrementCounter("settings_rejected", { reason: "canonical_alias" });
    throw new CanonicalSettingAliasError(key, entrada.canonical.destination);
  }
  const motivo = validar(entrada, value);
  if (motivo !== null) {
    incrementCounter("settings_rejected", { reason: "invalid_value" });
    throw new InvalidSettingError(key, motivo);
  }
  await withTenant(
    ctx,
    async (db) => {
      // Regra de merge fixada (§5.2): template NÃO sobrescreve o que o
      // tenant_admin gravou — o WHERE do upsert é a regra inteira.
      await db.query(
        `insert into public.tenant_settings
           (organization_id, key, value, schema_version, source, updated_by)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (organization_id, key) do update
           set value = excluded.value,
               schema_version = excluded.schema_version,
               source = excluded.source,
               updated_by = excluded.updated_by,
               updated_at = now()
         where not (tenant_settings.source = 'tenant_admin'
                    and excluded.source = 'template')`,
        [
          ctx.organization_id,
          key,
          JSON.stringify(value),
          SCHEMA_VERSION,
          source,
          ctx.user_id ?? null,
        ],
      );
    },
    deps,
  );
}

/** Alimenta a UI de configuração do tenant_admin e os testes derivados. */
export function listSchema(): readonly SettingEntry[] {
  return SETTINGS_SCHEMA;
}
