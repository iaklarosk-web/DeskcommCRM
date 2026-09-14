import { z } from "zod";

import { normalizarHex } from "@/lib/branding/rampa";
import { fusoValido } from "@/lib/tempo/fusos";

import type { CommercialPatch, CommercialValues } from "./commercial-contract";

export const COMMERCIAL_LIMITS = {
  phone: 80,
  address: 500,
  hours: 500,
  cancellation_policy: 2_000,
  delivery_days: 7,
  delivery_regions: 50,
  delivery_region: 120,
} as const;

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable();

const deliveryDaysSchema = z
  .array(z.number().int().min(0).max(6))
  .max(COMMERCIAL_LIMITS.delivery_days)
  .superRefine((days, ctx) => {
    if (new Set(days).size !== days.length) {
      ctx.addIssue({
        code: "custom",
        message: "dias de entrega não podem se repetir",
      });
    }
  })
  .transform((days) => [...days].sort((a, b) => a - b));

const deliveryRegionsSchema = z
  .array(z.string().trim().min(1).max(COMMERCIAL_LIMITS.delivery_region))
  .max(COMMERCIAL_LIMITS.delivery_regions)
  .superRefine((regions, ctx) => {
    if (new Set(regions).size !== regions.length) {
      ctx.addIssue({
        code: "custom",
        message: "regiões de entrega não podem se repetir",
      });
    }
  });

export const commercialValuesSchema = z.strictObject({
  "business.phone": nullableText(COMMERCIAL_LIMITS.phone),
  "business.address": nullableText(COMMERCIAL_LIMITS.address),
  "business.hours": nullableText(COMMERCIAL_LIMITS.hours),
  "business.delivery_days": deliveryDaysSchema,
  "business.delivery_regions": deliveryRegionsSchema,
  "business.cancellation_policy": nullableText(
    COMMERCIAL_LIMITS.cancellation_policy,
  ),
}) satisfies z.ZodType<CommercialValues>;

export const commercialPatchSchema = z
  .strictObject({ settings: commercialValuesSchema.partial() })
  .refine((value) => Object.keys(value.settings).length > 0, {
    path: ["settings"],
    message: "envie ao menos um campo alterado",
  }) satisfies z.ZodType<CommercialPatch>;

export const legacyTimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(fusoValido, "fuso IANA inválido");

export const legacyBrandNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .nullable();

export const legacyPrimaryColorSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    try {
      return normalizarHex(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "cor inválida" });
      return z.NEVER;
    }
  })
  .nullable();

/**
 * Classifica o logo sem devolver nem consumir a URL. `empty` preserva a
 * diferença entre linha explícita nula/vazia e ausência da linha.
 */
export function legacyLogoKind(
  value: unknown,
): "empty" | "invalid" | "unsupported_url" {
  if (value === null || value === "") return "empty";
  if (typeof value !== "string" || value.length > 2_048) return "invalid";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? "unsupported_url"
      : "invalid";
  } catch {
    return "invalid";
  }
}
