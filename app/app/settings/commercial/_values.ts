import type { CommercialValues } from "@/src/tenant-config/commercial-contract";
export type { CommercialValues } from "@/src/tenant-config/commercial-contract";

export const COMMERCIAL_KEYS = [
  "business.phone",
  "business.address",
  "business.hours",
  "business.delivery_days",
  "business.delivery_regions",
  "business.cancellation_policy",
] as const satisfies readonly (keyof CommercialValues)[];

/** Não normaliza legado não editado nem envia ausência como default escolhido. */
export function commercialPatch(baseline: CommercialValues, draft: CommercialValues) {
  const entries = COMMERCIAL_KEYS.filter(
    (key) => JSON.stringify(baseline[key]) !== JSON.stringify(draft[key]),
  ).map((key) => [key, draft[key]]);
  return Object.fromEntries(entries) as Partial<CommercialValues>;
}
