/**
 * TenantConfiguration (§5.2, D21) — quem sabe quais Settings existem.
 * Ninguém mais lê tenant_settings (invariante 4).
 */
export {
  REMINDER_DEFAULT,
  SCHEMA_VERSION,
  SETTINGS_SCHEMA,
  type SettingEntry,
  type TipoDeSetting,
} from "./schema";
export {
  CanonicalSettingAliasError,
  getSetting,
  getSettingIn,
  getStoredSetting,
  CanonicalSettingUnavailableError,
  InvalidSettingError,
  listSchema,
  setSetting,
  UnknownSettingError,
  type SettingSource,
} from "./settings";
export { validateSeed, type ResultadoDoSeed } from "./validate-seed";
