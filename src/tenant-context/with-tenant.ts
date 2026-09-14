/**
 * withTenant — o ÚNICO caminho para o Postgres com service role (§5.1, D20).
 *
 * Abre uma transação, injeta `set_config('app.organization_id', …, true)` —
 * o `true` a torna transaction-local: quando a conexão volta ao pool, o GUC
 * morreu junto com a transação e o próximo checkout não herda tenant nenhum.
 * As policies novas leem esse GUC via `current_organization_id()` (F01-T03);
 * até lá o valor já viaja para triggers e para o `pg_stat_activity` de quem
 * depura.
 *
 * O pool é o MESMO seam do worker (`lib/agent-engine/db/pool.ts`) sobre
 * `SUPABASE_DB_URL` — criar um segundo jeito de conectar seria a segunda fila
 * do agent-engine de novo. `deps.pool` existe para teste unitário; produção
 * nunca o passa.
 */
import type pg from "pg";

import { getServicePool, type ServicePool } from "./db";
import { TenantResolutionError, type TenantCtx } from "./types";

/** Aceita qualquer versão de UUID; rejeita todo o resto (inclui injeção). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O que o fn recebe: o client transacional, sem release nem connect. */
export type TenantDb = Pick<pg.PoolClient, "query">;

interface WithTenantDeps {
  pool?: ServicePool;
}

export async function withTenant<T>(
  ctx: TenantCtx,
  fn: (db: TenantDb) => Promise<T>,
  deps: WithTenantDeps = {},
): Promise<T> {
  if (!ctx?.organization_id || !UUID_RE.test(ctx.organization_id)) {
    throw new TenantResolutionError(ctx?.source ?? "session", "invalid_organization_id");
  }

  const pool = deps.pool ?? (await getServicePool());
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.organization_id', $1, true)", [
      ctx.organization_id,
    ]);
    const resultado = await fn(client);
    await client.query("commit");
    return resultado;
  } catch (erro) {
    // Rollback de melhor esforço: se a conexão morreu, o erro que importa é o
    // original — o pool descarta o client quebrado sozinho.
    try {
      await client.query("rollback");
    } catch {
      /* conexão já perdida; o release abaixo devolve o client ao descarte */
    }
    throw erro;
  } finally {
    client.release();
  }
}
