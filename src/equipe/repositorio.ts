import { getServicePool, type ServicePool } from "@/src/tenant-context/db";

import { podeRemover, podeMudarPapel, type MembroDaOrganizacao, type Papel, type RecusaDaEquipe } from "./politica";

/**
 * Leitura e escrita de `user_organizations` pelo painel do dono da plataforma
 * (ADR-048). A regra do último admin é aplicada DENTRO da mesma transação que
 * escreve, com `for update`: conferir antes e escrever depois, em duas
 * chamadas soltas, deixa uma janela para duas remoções simultâneas lerem
 * "2 admins" cada uma e esvaziarem a organização.
 */
export interface MembroListado {
  user_id: string;
  email: string;
  role: Papel;
  accepted_at: string | null;
}

interface Deps {
  readonly pool?: ServicePool;
}

export async function listarMembros(organization_id: string, deps: Deps = {}): Promise<MembroListado[]> {
  const pool = deps.pool ?? (await getServicePool());
  const { rows } = await pool.query<MembroListado>(
    `select uo.user_id::text, u.email, uo.role, uo.accepted_at::text
       from public.user_organizations uo
       join auth.users u on u.id = uo.user_id
      where uo.organization_id = $1
      order by (uo.role = 'admin') desc, u.email`,
    [organization_id],
  );
  return rows;
}

type Escrita<T> = { ok: true } & T;
type Veredito<T> = Escrita<T> | { ok: false; recusa: RecusaDaEquipe };

async function emTransacao<T>(
  pool: ServicePool,
  organization_id: string,
  corpo: (
    cliente: { query: ServicePool["query"] },
    membros: MembroDaOrganizacao[],
  ) => Promise<Veredito<T>>,
): Promise<Veredito<T>> {
  const cliente = await pool.connect();
  try {
    await cliente.query("begin");
    const { rows } = await cliente.query<{ user_id: string; role: Papel }>(
      `select uo.user_id::text, uo.role from public.user_organizations uo
        where uo.organization_id = $1 for update`,
      [organization_id],
    );
    const resultado = await corpo(cliente, rows);
    if (!resultado.ok) {
      await cliente.query("rollback");
      return resultado;
    }
    await cliente.query("commit");
    return resultado;
  } catch (erro) {
    await cliente.query("rollback").catch(() => undefined);
    throw erro;
  } finally {
    cliente.release();
  }
}

export async function removerMembro(
  entrada: { organization_id: string; user_id: string },
  deps: Deps = {},
): Promise<Veredito<{ papel_removido: Papel }>> {
  const pool = deps.pool ?? (await getServicePool());
  return emTransacao(pool, entrada.organization_id, async (cliente, membros) => {
    const veredito = podeRemover(membros, entrada.user_id);
    if (!veredito.ok) return veredito;
    const papel = membros.find((m) => m.user_id === entrada.user_id)!.role;
    await cliente.query(`delete from public.user_organizations where organization_id = $1 and user_id = $2`, [
      entrada.organization_id,
      entrada.user_id,
    ]);
    return { ok: true, papel_removido: papel };
  });
}

export async function mudarPapel(
  entrada: { organization_id: string; user_id: string; novo: Papel },
  deps: Deps = {},
): Promise<Veredito<{ papel_anterior: Papel }>> {
  const pool = deps.pool ?? (await getServicePool());
  return emTransacao(pool, entrada.organization_id, async (cliente, membros) => {
    const veredito = podeMudarPapel(membros, entrada.user_id, entrada.novo);
    if (!veredito.ok) return veredito;
    const anterior = membros.find((m) => m.user_id === entrada.user_id)!.role;
    await cliente.query(`update public.user_organizations set role = $3 where organization_id = $1 and user_id = $2`, [
      entrada.organization_id,
      entrada.user_id,
      entrada.novo,
    ]);
    return { ok: true, papel_anterior: anterior };
  });
}
