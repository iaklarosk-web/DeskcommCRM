/**
 * F13-T01 (ADR-034 §2) — o ÚNICO validador de VALOR de campo configurável.
 *
 * Contrato:
 * - cada definição é conferida contra o valor gravado sob a sua `key`: tipo,
 *   obrigatório (`required`), opções (`select`/`multiselect`);
 * - chave sem definição é PRESERVADA como está — "evolução preserva dados"
 *   (§7.9): apagar uma definição não apaga o valor que a organização já
 *   gravou, e um PATCH que reenvia o objeto inteiro não é recusado por causa
 *   de um campo que deixou de existir;
 * - `null`/`undefined`/`""` contam como "sem valor" (recusado só se `required`).
 *
 * Puro: quem tem o banco na mão (rota) lê as definições em `tenant_settings`
 * e chama aqui. Sabotar esta função é o mutante 67 (ADR-035 §4).
 */
import type { CustomFieldDef } from "@/lib/schemas/settings";

export interface ErroDeCampo {
  key: string;
  motivo: "required" | "type" | "option";
}

export type ResultadoDaValidacao =
  | { ok: true; valores: Record<string, unknown> }
  | { ok: false; erros: readonly ErroDeCampo[] };

function semValor(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEFONE = /^\+?[0-9()\s-]{8,20}$/;

function tipoConfere(def: CustomFieldDef, v: unknown): boolean {
  switch (def.type) {
    case "text":
    case "textarea":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
    case "date":
      return typeof v === "string" && DATA_ISO.test(v);
    case "email":
      return typeof v === "string" && EMAIL.test(v);
    case "phone":
      return typeof v === "string" && TELEFONE.test(v);
    case "url":
      try {
        return typeof v === "string" && Boolean(new URL(v));
      } catch {
        return false;
      }
    case "select":
      return typeof v === "string";
    case "multiselect":
      return Array.isArray(v) && v.every((item) => typeof item === "string");
  }
}

function opcaoConfere(def: CustomFieldDef, v: unknown): boolean {
  const aceitas = new Set((def.options ?? []).map((o) => o.value));
  if (def.type === "select") return typeof v === "string" && aceitas.has(v);
  if (def.type === "multiselect") return Array.isArray(v) && v.every((item) => aceitas.has(String(item)));
  return true;
}

export function validarValores(
  definicoes: readonly CustomFieldDef[],
  valores: Record<string, unknown> | null | undefined,
): ResultadoDaValidacao {
  const entrada = valores ?? {};
  const erros: ErroDeCampo[] = [];
  for (const def of definicoes) {
    const v = entrada[def.key];
    if (semValor(v)) {
      if (def.required === true) erros.push({ key: def.key, motivo: "required" });
      continue;
    }
    if (!tipoConfere(def, v)) {
      erros.push({ key: def.key, motivo: "type" });
      continue;
    }
    if (!opcaoConfere(def, v)) erros.push({ key: def.key, motivo: "option" });
  }
  if (erros.length > 0) return { ok: false, erros };
  // Chaves sem definição seguem intactas: preservação de dados por contrato.
  return { ok: true, valores: { ...entrada } };
}
