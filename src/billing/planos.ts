/**
 * O catálogo de PLANOS (D14, ADR-030 §3) — leitura de `plans`.
 *
 * `plans` é tabela GLOBAL e `service_only` (D35): quem a lê é o servidor, com
 * o pool de serviço. Placeholder é dado, não fato: `source === "placeholder"`
 * viaja até a tela do dono, que o mostra como tal. Nenhum preço é inventado
 * aqui — `price_cents` vem do banco e o banco nasce com 0.
 */
import type { ServicePool } from "@/src/tenant-context/db";
import { getServicePool } from "@/src/tenant-context/db";

import type { Capability } from "@/src/entitlement/capability";

export interface Plano {
  readonly code: string;
  readonly name: string;
  readonly price_cents: number;
  readonly currency: string;
  readonly period_days: number;
  /** Limite por capability no período; ausente = sem limite. */
  readonly limits: Readonly<Partial<Record<Capability, number>>>;
  readonly active: boolean;
  readonly source: "placeholder" | "owner";
}

export class PlanoDesconhecido extends Error {
  constructor(public readonly code: string) {
    super(`plano desconhecido ou inativo: ${code}`);
    this.name = "PlanoDesconhecido";
  }
}

interface Deps {
  pool?: ServicePool;
}

const CODIGO = /^[A-Z][A-Z0-9_]{1,31}$/;

interface LinhaDePlano {
  code: string;
  name: string;
  price_cents: number;
  currency: string;
  period_days: number;
  limits: Record<string, unknown> | null;
  active: boolean;
  source: "placeholder" | "owner";
}

function limitesDe(bruto: Record<string, unknown> | null): Plano["limits"] {
  const limites: Partial<Record<Capability, number>> = {};
  for (const [chave, valor] of Object.entries(bruto ?? {})) {
    if (typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0) {
      limites[chave as Capability] = valor;
    }
  }
  return limites;
}

function planoDe(linha: LinhaDePlano): Plano {
  return {
    code: linha.code,
    name: linha.name,
    price_cents: Number(linha.price_cents),
    currency: linha.currency,
    period_days: Number(linha.period_days),
    limits: limitesDe(linha.limits),
    active: linha.active,
    source: linha.source,
  };
}

export async function listarPlanos(deps: Deps = {}): Promise<readonly Plano[]> {
  const pool = deps.pool ?? (await getServicePool());
  const { rows } = await pool.query<LinhaDePlano>(
    `select code, name, price_cents, currency, period_days, limits, active, source
       from public.plans where active order by code`,
  );
  return rows.map(planoDe);
}

/** Um plano ATIVO pelo código; código fora do formato ou inexistente lança. */
export async function obterPlano(code: string, deps: Deps = {}): Promise<Plano> {
  if (!CODIGO.test(code)) throw new PlanoDesconhecido(code);
  const pool = deps.pool ?? (await getServicePool());
  const { rows } = await pool.query<LinhaDePlano>(
    `select code, name, price_cents, currency, period_days, limits, active, source
       from public.plans where code = $1 and active`,
    [code],
  );
  const linha = rows[0];
  if (!linha) throw new PlanoDesconhecido(code);
  return planoDe(linha);
}
