/**
 * Conexão service-role do TenantContext — o único lugar de src/ que sabe de
 * onde ela vem (§5.1: "é o único módulo que toca a service-role key").
 *
 * Reusa o createPool do agent-engine sobre SUPABASE_DB_URL. Lazy e por import
 * dinâmico de propósito: importar `lib/env` valida o ambiente inteiro no load,
 * e teste com pool injetado não deve pagar (nem depender de) um `.env`
 * completo.
 */
import type pg from "pg";

/** O recorte de pg.Pool que o módulo usa — teste injeta um fake deste tipo. */
export type ServicePool = Pick<pg.Pool, "connect" | "query">;

let poolSingleton: pg.Pool | undefined;

export async function getServicePool(): Promise<ServicePool> {
  if (!poolSingleton) {
    const [{ createPool }, { env }] = await Promise.all([
      import("@/lib/agent-engine/db/pool"),
      import("@/lib/env"),
    ]);
    poolSingleton = createPool(env.SUPABASE_DB_URL);
  }
  return poolSingleton;
}
