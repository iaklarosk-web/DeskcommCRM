/**
 * F13-T01 (ADR-034 §2) — a DEFINIÇÃO dos campos configuráveis por organização.
 *
 * O formato de uma definição é o `customFieldSchema` herdado (o mesmo que o
 * funil usa em `crm_pipelines.settings.fields`): um tipo só para dois lugares
 * de definição, para que a tela e o validador de valor não precisem saber de
 * onde a lista veio. Aqui mora só o que a Setting exige a mais: lista, teto de
 * 50 e chave única — o `tenant_settings` grava jsonb e não tem CHECK de forma.
 *
 * Puro de propósito: é chamado pelo validador de Settings (`validar()` em
 * src/tenant-config/validators.ts) a cada `setSetting`, sem banco.
 */
import { customFieldSchema, type CustomFieldDef } from "@/lib/schemas/settings";

export const MAXIMO_DE_CAMPOS = 50;

/** As entidades cuja definição mora em `tenant_settings` (`crm.fields.<entidade>`). */
export const ENTIDADES_COM_CAMPOS = ["contacts", "companies"] as const;
export type EntidadeComCampos = (typeof ENTIDADES_COM_CAMPOS)[number];

export function chaveDaSetting(entidade: EntidadeComCampos): `crm.fields.${EntidadeComCampos}` {
  return `crm.fields.${entidade}`;
}

/** `null` = lista válida; texto = o motivo, no vocabulário de `InvalidSettingError`. */
export function validarDefinicoes(valor: unknown): string | null {
  if (!Array.isArray(valor)) return "esperava lista de definições de campo";
  if (valor.length > MAXIMO_DE_CAMPOS) return `esperava no máximo ${MAXIMO_DE_CAMPOS} campos`;
  const chaves = new Set<string>();
  for (const [indice, item] of valor.entries()) {
    const parsed = customFieldSchema.safeParse(item);
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      return `campo ${indice}: ${primeiro?.path.join(".") || "definição"} ${primeiro?.message ?? "inválida"}`;
    }
    const chave = parsed.data.key.toLowerCase();
    if (chaves.has(chave)) return `campo ${indice}: chave repetida (${parsed.data.key})`;
    chaves.add(chave);
    if ((parsed.data.type === "select" || parsed.data.type === "multiselect") && !(parsed.data.options?.length)) {
      return `campo ${indice}: ${parsed.data.type} exige options`;
    }
  }
  return null;
}

/** Lê uma lista já gravada sem explodir: definição inválida é descartada, nunca aplicada. */
export function definicoesDe(valor: unknown): CustomFieldDef[] {
  if (!Array.isArray(valor)) return [];
  const saida: CustomFieldDef[] = [];
  for (const item of valor) {
    const parsed = customFieldSchema.safeParse(item);
    if (parsed.success) saida.push(parsed.data);
  }
  return saida;
}
