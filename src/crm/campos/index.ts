/**
 * F13-T01 — campos configuráveis por organização (ADR-034 §2 T01).
 *
 * Definição em `tenant_settings` (`crm.fields.contacts`, `crm.fields.companies`;
 * D21), valor em `contacts.custom_fields` / `crm_companies.custom_fields`,
 * validador único em `validar.ts`. A rota que escreve contato ou empresa
 * chama `validarCamposDa()` antes de gravar.
 */
import { InvalidSettingError, getSetting, setSetting, type SettingSource } from "@/src/tenant-config/settings";
import type { TenantCtx } from "@/src/tenant-context";
import type { ServicePool } from "@/src/tenant-context/db";
import type { CustomFieldDef } from "@/lib/schemas/settings";

import { chaveDaSetting, definicoesDe, type EntidadeComCampos } from "./definicoes";
import { validarValores, type ResultadoDaValidacao } from "./validar";

export { ENTIDADES_COM_CAMPOS, MAXIMO_DE_CAMPOS, chaveDaSetting, definicoesDe, validarDefinicoes, type EntidadeComCampos } from "./definicoes";
export { validarValores, type ErroDeCampo, type ResultadoDaValidacao } from "./validar";

export interface DepsDosCampos {
  pool?: ServicePool;
}

/** As definições vigentes da organização para a entidade. */
export async function definicoesDa(
  ctx: TenantCtx,
  entidade: EntidadeComCampos,
  deps: DepsDosCampos = {},
): Promise<CustomFieldDef[]> {
  return definicoesDe(await getSetting(ctx, chaveDaSetting(entidade), deps));
}

/** Grava as definições; `InvalidSettingError` quando a lista não passa em `validarDefinicoes`. */
export async function gravarDefinicoes(
  ctx: TenantCtx,
  entidade: EntidadeComCampos,
  definicoes: unknown,
  source: SettingSource = "tenant_admin",
  deps: DepsDosCampos = {},
): Promise<void> {
  await setSetting(ctx, chaveDaSetting(entidade), definicoes, source, deps);
}

/** Lê as definições e valida o valor — o passo único das rotas de escrita. */
export async function validarCamposDa(
  ctx: TenantCtx,
  entidade: EntidadeComCampos,
  valores: Record<string, unknown> | null | undefined,
  deps: DepsDosCampos = {},
): Promise<ResultadoDaValidacao> {
  return validarValores(await definicoesDa(ctx, entidade, deps), valores);
}

export { InvalidSettingError };
