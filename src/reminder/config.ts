/**
 * A configuração do lembrete, lida do TenantConfiguration (§5.2, D21:
 * `orders.recurring_reminder`) — e conferida contra a forma que `validators.ts`
 * garante na escrita. Ler sem conferir seria confiar que ninguém escreveu na
 * tabela por fora; o custo de conferir é uma função.
 */
import { REMINDER_DEFAULT } from "@/src/tenant-config/schema";
import { getSetting } from "@/src/tenant-config/settings";
import type { ServicePool } from "@/src/tenant-context/db";
import type { TenantCtx } from "@/src/tenant-context";

export interface ConfigDoLembrete {
  readonly enabled: boolean;
  readonly weekday: number;
  readonly hour: number;
  readonly cutoff_hours: number;
  readonly message_template: string;
  readonly period: "weekly";
}

/** Setting fora da forma — falha FECHADA: lembrete com configuração torta não sai. */
export class ConfigDoLembreteInvalida extends Error {
  constructor(public readonly campo: string) {
    super(`orders.recurring_reminder inválida: ${campo}`);
    this.name = "ConfigDoLembreteInvalida";
  }
}

const inteiroEntre = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export function lerConfigDoLembrete(valor: unknown): ConfigDoLembrete {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    throw new ConfigDoLembreteInvalida("objeto");
  }
  const v = { ...REMINDER_DEFAULT, ...(valor as Record<string, unknown>) };
  if (typeof v.enabled !== "boolean") throw new ConfigDoLembreteInvalida("enabled");
  if (!inteiroEntre(v.weekday, 0, 6)) throw new ConfigDoLembreteInvalida("weekday");
  if (!inteiroEntre(v.hour, 0, 23)) throw new ConfigDoLembreteInvalida("hour");
  if (!inteiroEntre(v.cutoff_hours, 1, 24 * 366)) throw new ConfigDoLembreteInvalida("cutoff_hours");
  if (typeof v.message_template !== "string" || v.message_template.trim().length === 0) {
    throw new ConfigDoLembreteInvalida("message_template");
  }
  if (v.period !== "weekly") throw new ConfigDoLembreteInvalida("period");
  return {
    enabled: v.enabled,
    weekday: v.weekday,
    hour: v.hour,
    cutoff_hours: v.cutoff_hours,
    message_template: v.message_template,
    period: "weekly",
  };
}

export async function configDoLembrete(
  ctx: TenantCtx,
  deps: { pool?: ServicePool } = {},
): Promise<ConfigDoLembrete> {
  return lerConfigDoLembrete(await getSetting(ctx, "orders.recurring_reminder", deps));
}

/** `business.timezone` — alias canônico de `organizations.timezone` (§5.2). */
export async function fusoDoTenant(
  ctx: TenantCtx,
  deps: { pool?: ServicePool } = {},
): Promise<string> {
  const valor = await getSetting(ctx, "business.timezone", deps);
  return typeof valor === "string" && valor.length > 0 ? valor : "America/Sao_Paulo";
}
